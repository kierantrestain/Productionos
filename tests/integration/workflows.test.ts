/** Acceptance 13, 14, 20 — gated contracts and messages, outbox retry/dead-letter, protected attachments. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { contracts, engagements, outboundMessages, outboxEvents, workflowDefinitions } from "@/db/schema";
import { createEntity } from "@/server/entities/crud";
import { decideApproval, requestApproval } from "@/server/services/approvals";
import { confirmMessages, draftCastDetails, generateContract, markContractSigned, requestContractSignature } from "@/server/services/post-legal";
import { readAttachment, uploadAttachment } from "@/server/services/attachments";
import { processOutbox, retryEvent } from "@/server/workflows/engine";
import { testSink } from "@/server/integrations/providers";
import { makeOrg, makeUser } from "../support/factory";
import type { Ctx } from "@/server/auth/context";

let producer: Ctx, legal: Ctx, cast: Ctx, prodId: string, engagementId: string, personId: string;

beforeAll(async () => {
  const org = await makeOrg("Workflows");
  const admin = await makeUser(org.id, "org_admin");
  prodId = (await createEntity(admin, "productions", { title: "WF show", kind: "series" })).id;
  producer = await makeUser(org.id, "producer", { productionIds: [prodId] });
  legal = await makeUser(org.id, "finance_legal");
  personId = (await createEntity(admin, "people", { fullName: "Fixture Actor", email: "actor@example.test" })).id;
  cast = await makeUser(org.id, "cast", { productionIds: [prodId], personId });
  engagementId = (await createEntity(producer, "engagements", { productionId: prodId, personId, kind: "cast", roleTitle: "Lead" })).id;
});
afterEach(() => { process.env.MAIL_PROVIDER = ""; testSink.sent.length = 0; testSink.failNext = 0; });
afterAll(async () => { await closeDb(); });

describe("contracts never reach sent/signed without a provider or evidence (acceptance 13)", () => {
  it("generate → approve → signature request is BLOCKED with no provider; signed requires evidence", async () => {
    const c = await createEntity(producer, "contracts", { title: "Lead cast agreement", kind: "cast", productionId: prodId, engagementId, counterpartyPersonId: personId });
    await generateContract(producer, c.id);
    await expect(requestContractSignature(producer, c.id, true)).rejects.toThrow(/approved/);
    const req = await requestApproval(producer, "contracts", c.id);
    expect(req.requiredRole).toBe("finance_legal");
    await expect(decideApproval(producer, req.id, "approved")).rejects.toThrow();
    await decideApproval(legal, req.id, "approved");
    await expect(requestContractSignature(producer, c.id, false)).rejects.toThrow(/confirmation/);
    const r = await requestContractSignature(producer, c.id, true);
    expect(r.status).toBe("blocked");
    const [row] = await db.select().from(contracts).where(eq(contracts.id, c.id));
    expect(row.status).toBe("blocked");
    expect(row.signedAt).toBeNull();

    // Signed only with an attached signature document belonging to this contract.
    const fake = "00000000-0000-0000-0000-000000000000";
    await expect(markContractSigned(producer, c.id, fake)).rejects.toThrow(/Upload the signed document/);
    const att = await uploadAttachment(producer, "contracts", c.id, { name: "signed.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.4 fixture signed copy") });
    const signed = await markContractSigned(producer, c.id, att.id);
    expect(signed.status).toBe("signed");
    const [eng] = await db.select().from(engagements).where(eq(engagements.id, engagementId));
    expect(eng.contractStatus).toBe("signed");
  });
});

describe("outbound email is draft → confirm → dispatch, idempotent and audited (acceptance 13, 14)", () => {
  it("is blocked, never sent, when no mail provider is configured", async () => {
    const m = await draftCastDetails(producer, engagementId);
    expect(m.status).toBe("awaiting_confirmation");
    await expect(draftCastDetails(producer, engagementId)).rejects.toThrow(/already drafted/);
    await expect(confirmMessages(cast, [m.id])).rejects.toThrow();
    const r = await confirmMessages(producer, [m.id]);
    expect(r.blocked).toBe(1);
    const [row] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, m.id));
    expect(row.status).toBe("blocked_no_provider");
    expect(row.sentAt).toBeNull();
  });

  it("with a provider: sends exactly once, retries transient failure, dead-letters persistent failure", async () => {
    process.env.MAIL_PROVIDER = "test-sink"; // test-only provider; refuses to run outside NODE_ENV=test
    const [blockedMsg] = await db.select().from(outboundMessages).where(and(eq(outboundMessages.subjectId, engagementId), eq(outboundMessages.status, "blocked_no_provider")));
    testSink.failNext = 1; // first attempt hits a simulated network failure
    expect((await confirmMessages(producer, [blockedMsg.id])).queued).toBe(1);
    const s1 = await processOutbox({ orgId: producer.orgId });
    expect(s1.retried).toBe(1);
    expect(testSink.sent).toHaveLength(0);
    // Make the retry due now and process again.
    await db.update(outboxEvents).set({ nextAttemptAt: new Date() }).where(eq(outboxEvents.idempotencyKey, `message.dispatch:${blockedMsg.id}`));
    await processOutbox({ orgId: producer.orgId });
    await processOutbox({ orgId: producer.orgId }); // replay is a no-op
    expect(testSink.sent).toHaveLength(1);
    const [sent] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, blockedMsg.id));
    expect(sent.status).toBe("sent");
    const [eng] = await db.select().from(engagements).where(eq(engagements.id, engagementId));
    expect(eng.detailsEmailSentAt).not.toBeNull();

    // Persistent failure → dead letter after max attempts, then operator retry re-queues it.
    await db.update(workflowDefinitions).set({ maxAttempts: 2 }).where(and(eq(workflowDefinitions.orgId, producer.orgId), eq(workflowDefinitions.key, "SYS-MESSAGE-DISPATCH")));
    const m2 = await createEntity(producer, "engagements", { productionId: prodId, personId, kind: "crew", roleTitle: "Runner" });
    const d2 = await draftCastDetails(producer, m2.id);
    testSink.failNext = 99;
    await confirmMessages(producer, [d2.id]);
    const key = `message.dispatch:${d2.id}`;
    for (let i = 0; i < 3; i++) {
      await db.update(outboxEvents).set({ nextAttemptAt: new Date() }).where(eq(outboxEvents.idempotencyKey, key));
      await processOutbox({ orgId: producer.orgId });
    }
    const [ev] = await db.select().from(outboxEvents).where(eq(outboxEvents.idempotencyKey, key));
    expect(ev.status).toBe("dead");
    testSink.failNext = 0;
    expect(await retryEvent(producer.orgId, ev.id)).toBe(true);
    await processOutbox({ orgId: producer.orgId });
    expect(testSink.sent.some((s) => s.idempotencyKey.startsWith("cast_details:" + m2.id))).toBe(true);
  });
});

describe("protected attachments (acceptance 20, 25)", () => {
  it("stores bytes outside the DB with SHA-256, verifies on read, and enforces per-file access", async () => {
    const scene = await createEntity(producer, "scenes", { productionId: prodId, number: "1", title: "Attach test" });
    const a = await uploadAttachment(producer, "scenes", scene.id, { name: "storyboard.png", type: "image/png", bytes: Buffer.from("fixture-bytes") });
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    const read = await readAttachment(producer, a.id);
    expect(read.bytes.toString()).toBe("fixture-bytes");
    await expect(readAttachment(cast, a.id)).rejects.toThrow(/permission/);
    await expect(uploadAttachment(producer, "scenes", scene.id, { name: "evil.exe", type: "application/octet-stream", bytes: Buffer.from("MZ") })).rejects.toThrow(/not allowed/);
  });
});
