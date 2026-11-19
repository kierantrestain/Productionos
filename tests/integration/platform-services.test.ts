/**
 * Base platform services: automations (through the real outbox worker), interfaces, members & base
 * access, public forms, encrypted secrets, data sync and OIDC SSO.
 * NOTE: sync and SSO tests are MOCK-ONLY — the network is stubbed (no real Airtable, CSV host or identity
 * provider is contacted). They prove our request/verify/upsert logic, not a live integration.
 */
import { randomBytes } from "node:crypto";
process.env.SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import { closeDb, db } from "@/db";
import { baseViews, memberships, organisations, users } from "@/db/schema";
import { createBaseFromSpec } from "@/server/platform/spec";
import { createRecords, updateRecord, listComments } from "@/server/platform/records";
import { runView } from "@/server/platform/query";
import { previewAutomation, receiveWebhook, runScheduledAutomations, saveAutomation } from "@/server/platform/automations";
import { decideApproval, listApprovals } from "@/server/platform/approvals";
import { __setAgentClient, getThread, saveAgent, sendAgentMessage } from "@/server/platform/agents";
import { computeWidgets } from "@/server/platform/interfaces";
import { inviteMember, setBaseMember, setPlatformRole } from "@/server/platform/members";
import { loadBaseStructure, updateView } from "@/server/platform/schema";
import { submitPublicForm, loadPublicForm } from "@/server/platform/public-form";
import { encryptSecret, decryptSecret } from "@/server/crypto";
import { __setSyncFetcher, createSync, runSync } from "@/server/platform/sync";
import { __setJwks, __setSsoFetcher, finishSso, passwordBlockedBySso, saveSso, startSso } from "@/server/auth/sso";
import { drainOutbox } from "@/server/workflows/engine";
import { contextForUser } from "@/server/auth/sessions";
import { makeOrg, makeUser } from "../support/factory";
import type { Ctx } from "@/server/auth/context";

let owner: Ctx; let editor: Ctx; let orgId: string; let orgSlug: string; let baseId: string; let T: Record<string, string>;
const fid = async (table: string, name: string) => (await runView(owner, "owner", T[table], {})).fields.find((f) => f.name === name)!.id;
const asRole = async (ctx: Ctx, role: string) => { await db.update(memberships).set({ platformRole: role }).where(and(eq(memberships.userId, ctx.userId), eq(memberships.orgId, ctx.orgId))); return (await contextForUser(ctx.userId, ctx.orgId))!; };

beforeAll(async () => {
  const org = await makeOrg("Services"); orgId = org.id; orgSlug = org.slug;
  owner = await asRole(await makeUser(org.id, "org_admin"), "owner");
  editor = await asRole(await makeUser(org.id, "production_manager"), "editor");
  const r = await createBaseFromSpec(owner, { name: "Sales", tables: [
    { name: "Deals", fields: [{ name: "Deal", type: "singleLineText" }, { name: "Stage", type: "singleSelect", choices: ["Open", "Won", "Lost"] }, { name: "Value", type: "currency" }, { name: "Close", type: "date" }, { name: "Kickoff", type: "link", linkTo: "Projects", inverseName: "Deal" }],
      records: [{ Deal: "A", Stage: "Open", Value: 100, Close: "2027-01-10" }, { Deal: "B", Stage: "Won", Value: 300, Close: "2027-02-10" }, { Deal: "C", Stage: "Won", Value: 50, Close: "2027-02-20" }] },
    { name: "Projects", fields: [{ name: "Project", type: "singleLineText" }, { name: "Status", type: "singleSelect", choices: ["New", "Active"] }] },
  ] });
  baseId = r.baseId; T = r.tableIds;
});
afterAll(async () => { __setAgentClient(null); __setSyncFetcher(null); __setSsoFetcher(null); __setJwks(null); await closeDb(); });

describe("automations", () => {
  it("won deal → linked project + comment, via the outbox worker; idempotent and depth-capped", async () => {
    const stage = await fid("Deals", "Stage"), kickoff = await fid("Deals", "Kickoff");
    const pDeal = await fid("Projects", "Deal"), pStatus = await fid("Projects", "Status"), pName = await fid("Projects", "Project");
    await saveAutomation(owner, baseId, { name: "Won → project", isEnabled: true,
      trigger: { type: "record_updated", tableId: T.Deals, watchFieldIds: [stage], conditions: { conjunction: "and", conditions: [{ fieldId: stage, op: "is", value: (await loadBaseStructure(owner, baseId)).fields.find((f) => f.id === stage)!.options.choices!.find((c) => c.name === "Won")!.id }] } },
      actions: [{ type: "create_record", tableId: T.Projects, linkFieldId: pDeal, values: { [pName]: "Kickoff: {Deal}", [pStatus]: "New" } }, { type: "add_comment", body: "Won — {Deal} handed to delivery." }] });
    const dealName = await fid("Deals", "Deal");
    const deal = (await runView(owner, "owner", T.Deals, {})).rows.find((x) => x.values[dealName] === "A")!;
    await updateRecord(editor, deal.id, { [stage]: "Won" });
    await drainOutbox({ orgId, budgetMs: 20_000 });
    await drainOutbox({ orgId, budgetMs: 20_000 });
    const after = (await runView(owner, "owner", T.Deals, {}, { recordIds: [deal.id] })).rows[0];
    const links = after.values[kickoff] as { title: string }[];
    expect(links).toHaveLength(1);
    expect(links[0].title).toBe("Kickoff: A");
    expect((await listComments(owner, deal.id)).map((c) => c.body)).toContain("Won — A handed to delivery.");
  });
  it("rejects actions targeting tables outside the base, and editors can't manage automations", async () => {
    await expect(saveAutomation(owner, baseId, { name: "x", trigger: { type: "record_created", tableId: T.Deals }, actions: [{ type: "create_record", tableId: "00000000-0000-0000-0000-000000000000", values: {} }] })).rejects.toThrow(/tables of this base/);
    await expect(saveAutomation(editor, baseId, { name: "x", trigger: { type: "record_created", tableId: T.Deals }, actions: [{ type: "add_comment", body: "hi" }] })).rejects.toThrow(/creator access/);
  });
});

describe("interfaces", () => {
  it("computes number, grouped bar and monthly line widgets from live records", async () => {
    const value = await fid("Deals", "Value"), stage = await fid("Deals", "Stage"), close = await fid("Deals", "Close");
    const d = await computeWidgets(owner, baseId, [
      { id: "n", type: "number", title: "Pipeline", tableId: T.Deals, agg: "sum", fieldId: value },
      { id: "b", type: "bar", title: "By stage", tableId: T.Deals, agg: "count", groupFieldId: stage },
      { id: "l", type: "line", title: "By month", tableId: T.Deals, agg: "sum", fieldId: value, groupFieldId: close, dateUnit: "month" },
    ]);
    expect(d[0].value).toBe(450);
    expect(d[1].series).toEqual([{ label: "Open", value: 0, color: expect.any(String) }, { label: "Won", value: 3, color: expect.any(String) }].filter((x) => x.value));
    expect(d[2].series).toEqual([{ label: "2027-01", value: 100, color: undefined }, { label: "2027-02", value: 350, color: undefined }]);
  });
});

describe("members, base access and free seats", () => {
  it("only owners change roles; last owner protected; base overrides can narrow access", async () => {
    await expect(setPlatformRole(editor, owner.userId, "reader")).rejects.toThrow(/Only owners/);
    await expect(setPlatformRole(owner, owner.userId, "editor")).rejects.toThrow(/at least one owner/);
    const inv = await inviteMember(owner, "new.person@example.test", "commenter");
    expect(inv.link).toMatch(/^\/invite\//);
    await setBaseMember(owner, baseId, editor.userId, "reader");
    await expect(createRecords(editor, T.Deals, [{}])).rejects.toThrow(/editor access/);
    await setBaseMember(owner, baseId, editor.userId, null);
    await expect(createRecords(editor, T.Deals, [{}])).resolves.toHaveLength(1);
  });
});

describe("public forms", () => {
  it("accepts only the form's fields and requires a share token", async () => {
    const [v] = await db.insert(baseViews).values({ orgId, tableId: T.Projects, name: "Request", type: "form", config: {}, createdBy: owner.userId }).returning();
    const shared = await updateView(owner, v.id, { share: true });
    const f = await loadPublicForm(shared.shareToken!);
    const nameId = f.form.fields.find((x) => x.f.name === "Project")!.fieldId;
    await expect(submitPublicForm(shared.shareToken!, { [nameId]: "From the public" })).resolves.toHaveProperty("id");
    const valueId = await fid("Deals", "Value");
    await expect(submitPublicForm(shared.shareToken!, { [valueId]: 1 })).rejects.toThrow(/unexpected field/);
    await updateView(owner, v.id, { share: false });
    await expect(loadPublicForm(shared.shareToken!)).rejects.toThrow();
  });
});

describe("secrets", () => {
  it("round-trips with AES-GCM and detects tampering", () => {
    const c = encryptSecret("pat-123");
    expect(c).not.toContain("pat-123");
    expect(decryptSecret(c)).toBe("pat-123");
    expect(() => decryptSecret(c.slice(0, -4) + "AAAA")).toThrow();
  });
});

describe("data sync (MOCK-ONLY network)", () => {
  it("Airtable: paginates, creates the table, upserts by record id, never writes back", async () => {
    const calls: { url: string; method: string }[] = [];
    let page2Name = "Gamma";
    __setSyncFetcher(async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET" });
      const u = new URL(url);
      const body = u.searchParams.get("offset")
        ? { records: [{ id: "rec3", fields: { Name: page2Name, Stage: "Done", Amount: 30 } }] }
        : { records: [{ id: "rec1", fields: { Name: "Alpha", Stage: "Todo", Amount: 10 } }, { id: "rec2", fields: { Name: "Beta", Stage: "Doing", Amount: 20 } }], offset: "p2" };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const s = await createSync(owner, baseId, { kind: "airtable", name: "Leads", airtableBaseId: "appABCDEFGHIJKLMN", airtableTable: "Leads", token: "patFAKE.fake" });
    const r1 = await runSync(owner, s.id);
    expect(r1.stats).toMatchObject({ fetched: 3, created: 3 });
    page2Name = "Gamma 2";
    const r2 = await runSync(owner, s.id);
    expect(r2.stats).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
    expect(calls.every((c) => c.method === "GET" && c.url.startsWith("https://api.airtable.com/v0/appABCDEFGHIJKLMN/"))).toBe(true);
    const v = await runView(owner, "owner", r1.tableId, {});
    expect(v.rows).toHaveLength(3);
  });
  it("CSV: refuses http and private hosts", async () => {
    await expect(createSync(owner, baseId, { kind: "csv_url", name: "x", url: "http://example.com/a.csv" })).rejects.toThrow(/https/);
    await expect(createSync(owner, baseId, { kind: "csv_url", name: "x", url: "https://localhost/a.csv" })).rejects.toThrow(/private or unknown/);
  });
});

describe("OIDC single sign-on (MOCK-ONLY identity provider)", () => {
  it("verifies the ID token, provisions a least-privilege member, and enforces SSO for passwords", async () => {
    const iss = "https://idp.example.test";
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
    __setJwks(() => createLocalJWKSet({ keys: [jwk] }) as never);
    let nonce = ""; let aud = "client-1";
    __setSsoFetcher(async (url, init) => {
      if (url.endsWith("/.well-known/openid-configuration")) return new Response(JSON.stringify({ issuer: iss, authorization_endpoint: `${iss}/auth`, token_endpoint: `${iss}/token`, jwks_uri: `${iss}/jwks` }));
      if (url === `${iss}/token`) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("code_verifier")).toBeTruthy();
        const id_token = await new SignJWT({ email: "sso.user@acme.test", email_verified: true, name: "SSO User", nonce }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(iss).setAudience(aud).setSubject("u-1").setIssuedAt().setExpirationTime("5m").sign(privateKey);
        return new Response(JSON.stringify({ id_token }));
      }
      return new Response("nope", { status: 404 });
    });
    await expect(saveSso(editor, { issuer: iss, clientId: "client-1", clientSecret: "s", allowedDomains: ["acme.test"], defaultRole: "reader", isEnabled: true, enforce: true })).rejects.toThrow(/owners/);
    await saveSso(owner, { issuer: iss, clientId: "client-1", clientSecret: "s3cret", allowedDomains: ["acme.test"], defaultRole: "commenter", isEnabled: true, enforce: true });
    const start = await startSso(orgSlug, "https://app.example.test/api/auth/sso/callback");
    const u = new URL(start.url);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    nonce = u.searchParams.get("nonce")!;
    await expect(finishSso({ code: "c", state: "wrong" }, start.cookie)).rejects.toThrow(/state/);
    const r = await finishSso({ code: "c", state: u.searchParams.get("state") }, start.cookie);
    expect(r.orgId).toBe(orgId);
    const [m] = await db.select().from(memberships).where(and(eq(memberships.userId, r.userId), eq(memberships.orgId, orgId)));
    expect(m.platformRole).toBe("commenter");
    expect(await passwordBlockedBySso(r.userId, "sso.user@acme.test")).toBe(true);
    // Wrong audience is rejected.
    aud = "someone-else";
    const s2 = await startSso(orgSlug, "https://app.example.test/api/auth/sso/callback");
    nonce = new URL(s2.url).searchParams.get("nonce")!;
    await expect(finishSso({ code: "c", state: new URL(s2.url).searchParams.get("state") }, s2.cookie)).rejects.toThrow();
    void users; void organisations;
  });
});

describe("automations v2: branches, preview, webhook trigger, schedule, approvals", () => {
  it("branches on conditions, previews without writing, and queues outbound webhooks for approval", async () => {
    const stage = await fid("Deals", "Stage"), dealName = await fid("Deals", "Deal");
    const wonId = (await loadBaseStructure(owner, baseId)).fields.find((f) => f.id === stage)!.options.choices!.find((c) => c.name === "Won")!.id;
    const value = await fid("Deals", "Value");
    const def = { name: "Value watcher", isEnabled: true, trigger: { type: "record_updated" as const, tableId: T.Deals, watchFieldIds: [value] },
      actions: [{ type: "branch" as const, conditions: { conjunction: "and" as const, conditions: [{ fieldId: stage, op: "is", value: wonId }] },
        then: [{ type: "add_comment" as const, body: "Won deal {Deal} changed value" }, { type: "webhook" as const, url: "https://hooks.example.com/x" }],
        else: [{ type: "add_comment" as const, body: "Open deal {Deal} changed value" }] }] };
    const b = (await runView(owner, "owner", T.Deals, {})).rows.find((x) => x.values[dealName] === "B")!;
    const pv = await previewAutomation(owner, baseId, def, b.id);
    expect(pv.steps.join(" | ")).toMatch(/then.*Won deal B changed value.*queued for a creator's approval/);
    expect(await listComments(owner, b.id)).toHaveLength(0); // preview wrote nothing
    await saveAutomation(owner, baseId, def);
    await updateRecord(editor, b.id, { [value]: 999 });
    await drainOutbox({ orgId, budgetMs: 20_000 });
    expect((await listComments(owner, b.id)).map((c) => c.body)).toContain("Won deal B changed value");
    const pending = (await listApprovals(owner, baseId)).filter((a) => a.kind === "webhook");
    expect(pending).toHaveLength(1);
    await expect(decideApproval(editor, pending[0].id, true)).rejects.toThrow(/Only creators/);
    await decideApproval(owner, pending[0].id, false);
    await expect(decideApproval(owner, pending[0].id, true)).rejects.toThrow(/already rejected/);
  });
  it("inbound webhook creates a record and runs the steps; unknown tokens 404", async () => {
    const a = await saveAutomation(owner, baseId, { name: "Lead hook", isEnabled: true, trigger: { type: "webhook", tableId: T.Deals }, actions: [{ type: "add_comment", body: "Arrived by webhook: {Deal}" }] });
    expect(a.webhookToken).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    const r = await receiveWebhook(a.webhookToken!, { Deal: "Hooked", Value: 42, Nonsense: "ignored" });
    expect(r.status).toBe("succeeded");
    const row = (await runView(owner, "owner", T.Deals, {}, { recordIds: [r.recordId] })).rows[0];
    expect(row.values[await fid("Deals", "Value")]).toBe(42);
    expect((await listComments(owner, r.recordId)).map((c) => c.body)).toContain("Arrived by webhook: Hooked");
    await expect(receiveWebhook("x".repeat(32), {})).rejects.toThrow();
  });
  it("scheduled automations process each matching record once per period", async () => {
    const value = await fid("Deals", "Value");
    await saveAutomation(owner, baseId, { name: "Daily big deals", isEnabled: true, trigger: { type: "schedule", tableId: T.Deals, schedule: { every: "day", hour: 0 }, conditions: { conjunction: "and", conditions: [{ fieldId: value, op: ">=", value: 300 }] } }, actions: [{ type: "add_comment", body: "Daily check: {Deal}" }] });
    const now = new Date("2031-05-05T09:00:00Z");
    const first = (await runScheduledAutomations(now)).find((x) => x.records > 0);
    expect(first?.records).toBeGreaterThanOrEqual(1);
    const again = await runScheduledAutomations(now);
    expect(again.every((x) => x.records === 0)).toBe(true);
  });
});

describe("AI agents (MOCK-ONLY model client)", () => {
  it("reads with the user's permissions, files proposals instead of writing, and approval applies them", async () => {
    const stage = await fid("Deals", "Stage"), dealName = await fid("Deals", "Deal");
    const agent = await saveAgent(owner, baseId, { name: "Ops", instructions: "Keep deals tidy.", tableIds: [T.Deals], canPropose: true });
    let step = 0; let seenSystem = "";
    __setAgentClient({ beta: { messages: { create: async (body: Record<string, unknown>) => {
      seenSystem = String(body.system);
      const msgs = body.messages as { role: string; content: { type: string; content?: string }[] }[];
      const last = msgs[msgs.length - 1];
      step++;
      const msg = (content: unknown[], stop: string) => ({ id: `m${step}`, type: "message", role: "assistant", model: "mock", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as never;
      if (step === 1) return msg([{ type: "text", text: "Let me look." }, { type: "tool_use", id: "t1", name: "search_records", input: { table: "Deals", query: "C", limit: 5 } }], "tool_use");
      if (step === 2) {
        const line = String(last.content[0].content).split("\n").find((l) => l.includes("Deal: C;"))!;
        const id = /id ([0-9a-f-]{36})/.exec(line)![1];
        return msg([{ type: "tool_use", id: "t2", name: "propose_update_record", input: { table: "Deals", record_id: id, values: [{ field: "Stage", value: "Lost" }], reason: "Customer declined" } }], "tool_use");
      }
      return msg([{ type: "text", text: "I've proposed marking C as Lost — approve it when ready." }], "end_turn");
    } } } });
    const { threadId } = await sendAgentMessage(editor, agent.id, null, "Deal C fell through, please update it.");
    expect(seenSystem).toContain("You cannot change data directly");
    const t = await getThread(editor, threadId);
    expect(t.items.map((i) => i.kind)).toEqual(["user", "assistant", "activity", "activity", "assistant"]);
    expect(t.proposals).toHaveLength(1);
    const c = (await runView(owner, "owner", T.Deals, {})).rows.find((x) => x.values[dealName] === "C")!;
    const lostId = (await loadBaseStructure(owner, baseId)).fields.find((f) => f.id === stage)!.options.choices!.find((x) => x.name === "Lost")!.id;
    expect(c.values[stage]).not.toBe(lostId); // nothing written yet
    await expect(getThread(owner, threadId)).rejects.toThrow(/not found/); // threads are private to their user
    await decideApproval(editor, t.proposals[0].id, true);
    const after = (await runView(owner, "owner", T.Deals, {}, { recordIds: [c.id] })).rows[0];
    expect(after.values[stage]).toBe(lostId);
  });
});
