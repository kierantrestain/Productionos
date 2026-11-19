/**
 * Post-production review, deliverable gating, contract lifecycle and gated outbound communications.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments, contracts, deliverables, editVersions, engagements, outboundMessages, people, productions, rightsEntries,
} from "@/db/schema";
import type { Ctx } from "../auth/context";
import { audit, emit, emitChanged } from "../audit";
import { productionAllowed } from "../entities/crud";
import { blocked, forbidden, invalid, notFound } from "../errors";
import { mailStatus, signingStatus } from "../integrations/providers";
import { requireWrite } from "./guards";
import { sha256 } from "../auth/password";

const REVIEW_APPROVERS = ["org_admin", "executive", "producer", "external_reviewer"];

// ───────────── Edit review ─────────────

export async function decideEditVersion(ctx: Ctx, editVersionId: string, decision: "approved" | "changes_requested") {
  if (!REVIEW_APPROVERS.includes(ctx.role)) throw forbidden("Only producers, executives or nominated external reviewers can sign off cuts.");
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(editVersions).where(and(eq(editVersions.id, editVersionId), eq(editVersions.orgId, ctx.orgId))).limit(1);
    if (!v || !productionAllowed(ctx, v.productionId)) throw notFound();
    const [row] = await tx.update(editVersions).set({ status: decision, approvedBy: decision === "approved" ? ctx.userId : null, approvedAt: decision === "approved" ? new Date() : null, updatedAt: new Date(), version: sql`${editVersions.version} + 1` }).where(eq(editVersions.id, v.id)).returning();
    await audit(tx, ctx, `edit_${decision}`, "edit_versions", v.id, { productionId: v.productionId, before: v, after: row });
    await emitChanged(tx, ctx, "edit_versions", row, ["status"]);
    return row;
  });
}

// ───────────── Deliverables ─────────────

/** Rights blockers for a production (and its show/IP): anything not cleared, or expired by date. */
export async function rightsBlockers(ctx: Ctx, productionId: string) {
  const [p] = await db.select().from(productions).where(and(eq(productions.id, productionId), eq(productions.orgId, ctx.orgId))).limit(1);
  if (!p) throw notFound();
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.select().from(rightsEntries).where(and(eq(rightsEntries.orgId, ctx.orgId), isNull(rightsEntries.archivedAt),
    p.ipProjectId ? or(eq(rightsEntries.productionId, productionId), eq(rightsEntries.ipProjectId, p.ipProjectId)) : eq(rightsEntries.productionId, productionId)));
  return rows.filter((r) => r.status !== "cleared" || (r.endDate != null && r.endDate < today))
    .map((r) => ({ id: r.id, title: r.title, status: r.endDate && r.endDate < today && r.status === "cleared" ? "expired" : r.status }));
}

const DELIVERABLE_FLOW: Record<string, string[]> = {
  pending: ["in_progress"], in_progress: ["qc", "ready_for_approval"], qc: ["ready_for_approval", "in_progress"],
  ready_for_approval: ["in_progress"], rejected: ["in_progress"], approved: [], delivered: [],
};

export async function advanceDeliverable(ctx: Ctx, id: string, to: string) {
  requireWrite(ctx, "post");
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(deliverables).where(and(eq(deliverables.id, id), eq(deliverables.orgId, ctx.orgId))).limit(1);
    if (!d || !productionAllowed(ctx, d.productionId)) throw notFound();
    if (!DELIVERABLE_FLOW[d.status]?.includes(to)) throw invalid(`Cannot move a deliverable from ${d.status} to ${to}.`);
    const [row] = await tx.update(deliverables).set({ status: to, updatedAt: new Date(), version: sql`${deliverables.version} + 1` }).where(eq(deliverables.id, id)).returning();
    await audit(tx, ctx, "deliverable_status", "deliverables", id, { productionId: d.productionId, before: d, after: row });
    await emitChanged(tx, ctx, "deliverables", row, ["status"]);
    return row;
  });
}

/** Final approval: role-checked and blocked by uncleared rights when the deliverable requires clearance. */
export async function approveDeliverable(ctx: Ctx, id: string, decision: "approved" | "rejected", note?: string) {
  if (!["org_admin", "executive", "producer"].includes(ctx.role)) throw forbidden("Only producers or executives can approve final deliverables.");
  const [d] = await db.select().from(deliverables).where(and(eq(deliverables.id, id), eq(deliverables.orgId, ctx.orgId))).limit(1);
  if (!d || !productionAllowed(ctx, d.productionId)) throw notFound();
  if (!["ready_for_approval", "qc"].includes(d.status)) throw invalid("Deliverable must be ready for approval first.");
  if (decision === "approved" && d.requiresRightsClearance) {
    const b = await rightsBlockers(ctx, d.productionId);
    if (b.length) throw blocked(`Rights not cleared: ${b.map((x) => `${x.title} (${x.status})`).join("; ")}.`);
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.update(deliverables).set({ status: decision, approvedBy: decision === "approved" ? ctx.userId : null, approvedAt: decision === "approved" ? new Date() : null, notes: note ? `${d.notes ? d.notes + "\n" : ""}${decision}: ${note}` : d.notes, updatedAt: new Date(), version: sql`${deliverables.version} + 1` }).where(eq(deliverables.id, id)).returning();
    await audit(tx, ctx, `deliverable_${decision}`, "deliverables", id, { productionId: d.productionId, before: d, after: row, meta: { note } });
    await emitChanged(tx, ctx, "deliverables", row, ["status"]);
    await emit(tx, { orgId: ctx.orgId, type: `deliverable.${decision}`, entityType: "deliverables", entityId: id, productionId: d.productionId, idempotencyKey: `deliverable.${decision}:${id}:v${row.version}`, actorUserId: ctx.userId });
    return row;
  });
}

export async function markDelivered(ctx: Ctx, id: string) {
  requireWrite(ctx, "post");
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(deliverables).where(and(eq(deliverables.id, id), eq(deliverables.orgId, ctx.orgId))).limit(1);
    if (!d || !productionAllowed(ctx, d.productionId)) throw notFound();
    if (d.status !== "approved") throw invalid("Only approved deliverables can be marked delivered.");
    const [row] = await tx.update(deliverables).set({ status: "delivered", deliveredAt: new Date(), updatedAt: new Date(), version: sql`${deliverables.version} + 1` }).where(eq(deliverables.id, id)).returning();
    await audit(tx, ctx, "deliverable_delivered", "deliverables", id, { productionId: d.productionId, before: d, after: row });
    await emitChanged(tx, ctx, "deliverables", row, ["status"]);
    return row;
  });
}

// ───────────── Contracts ─────────────

/** Generate the contract document internally (no external call). Status draft → generated. */
export async function generateContract(ctx: Ctx, contractId: string) {
  requireWrite(ctx, "legal");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contracts).where(and(eq(contracts.id, contractId), eq(contracts.orgId, ctx.orgId))).limit(1);
    if (!c || (c.productionId && !productionAllowed(ctx, c.productionId))) throw notFound();
    if (!["draft", "blocked"].includes(c.status)) throw invalid(`Contract is already ${c.status}.`);
    const [row] = await tx.update(contracts).set({ status: "generated", updatedAt: new Date(), version: sql`${contracts.version} + 1` }).where(eq(contracts.id, c.id)).returning();
    if (c.engagementId) await tx.update(engagements).set({ contractStatus: "generated", updatedAt: new Date() }).where(eq(engagements.id, c.engagementId));
    await audit(tx, ctx, "contract_generated", "contracts", c.id, { productionId: c.productionId, before: c, after: row });
    await emitChanged(tx, ctx, "contracts", row, ["status"]);
    return row;
  });
}

/**
 * Request signature. Requires an approved contract, explicit confirmation and a configured signing
 * provider. Without a provider the contract is marked BLOCKED (never "sent" or "signed").
 */
export async function requestContractSignature(ctx: Ctx, contractId: string, confirm: boolean) {
  requireWrite(ctx, "legal");
  if (!confirm) throw invalid("Explicit confirmation is required to send a contract for signature.");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contracts).where(and(eq(contracts.id, contractId), eq(contracts.orgId, ctx.orgId))).limit(1);
    if (!c || (c.productionId && !productionAllowed(ctx, c.productionId))) throw notFound();
    if (!["approved", "blocked"].includes(c.status)) throw invalid("The contract must be approved before it is sent for signature.");
    const s = signingStatus();
    if (!s.enabled) {
      const [row] = await tx.update(contracts).set({ status: "blocked", notes: `${c.notes ? c.notes + "\n" : ""}Signature request blocked: ${s.reason}`, updatedAt: new Date() }).where(eq(contracts.id, c.id)).returning();
      if (c.engagementId) await tx.update(engagements).set({ contractStatus: "blocked" }).where(eq(engagements.id, c.engagementId));
      await audit(tx, ctx, "contract_send_blocked", "contracts", c.id, { productionId: c.productionId, meta: { reason: s.reason } });
      await emitChanged(tx, ctx, "contracts", row, ["status"], "blocked");
      return { status: "blocked" as const, reason: s.reason, contract: row };
    }
    await emit(tx, { orgId: ctx.orgId, type: "contract.send_requested", entityType: "contracts", entityId: c.id, productionId: c.productionId, idempotencyKey: `contract.send:${c.id}:v${c.version}`, actorUserId: ctx.userId, payload: { contractId: c.id } });
    await audit(tx, ctx, "contract_send_requested", "contracts", c.id, { productionId: c.productionId });
    return { status: "queued" as const };
  });
}

/** Mark signed — only with uploaded signature evidence attached to this contract. */
export async function markContractSigned(ctx: Ctx, contractId: string, evidenceAttachmentId: string) {
  requireWrite(ctx, "legal");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contracts).where(and(eq(contracts.id, contractId), eq(contracts.orgId, ctx.orgId))).limit(1);
    if (!c || (c.productionId && !productionAllowed(ctx, c.productionId))) throw notFound();
    const [a] = await tx.select().from(attachments).where(and(eq(attachments.id, evidenceAttachmentId), eq(attachments.orgId, ctx.orgId), eq(attachments.entityType, "contracts"), eq(attachments.entityId, c.id), isNull(attachments.archivedAt))).limit(1);
    if (!a) throw invalid("Upload the signed document to this contract first, then select it as evidence.");
    if (!["approved", "sent", "generated", "blocked"].includes(c.status)) throw invalid(`Cannot mark a ${c.status} contract as signed.`);
    const [row] = await tx.update(contracts).set({ status: "signed", signedAt: new Date(), signatureEvidenceAttachmentId: a.id, updatedAt: new Date(), version: sql`${contracts.version} + 1` }).where(eq(contracts.id, c.id)).returning();
    if (c.engagementId) await tx.update(engagements).set({ contractStatus: "signed", updatedAt: new Date() }).where(eq(engagements.id, c.engagementId));
    await audit(tx, ctx, "contract_signed", "contracts", c.id, { productionId: c.productionId, before: c, after: row, meta: { evidence: a.id, sha256: a.sha256 } });
    await emitChanged(tx, ctx, "contracts", row, ["status"]);
    return row;
  });
}

// ───────────── Gated outbound messages (Send Cast Details port) ─────────────

export async function draftCastDetails(ctx: Ctx, engagementId: string) {
  requireWrite(ctx, "people");
  return db.transaction(async (tx) => {
    const [e] = await tx.select({ e: engagements, p: people, prod: productions }).from(engagements)
      .innerJoin(people, eq(people.id, engagements.personId)).innerJoin(productions, eq(productions.id, engagements.productionId))
      .where(and(eq(engagements.id, engagementId), eq(engagements.orgId, ctx.orgId))).limit(1);
    if (!e || !productionAllowed(ctx, e.e.productionId)) throw notFound();
    if (!e.p.email) throw invalid(`${e.p.fullName} has no email address on file.`);
    const body = `Hi ${e.p.preferredName ?? e.p.fullName},\n\nThank you for joining ${e.prod.title}.\n\nRole: ${e.e.roleTitle ?? e.e.kind}${e.e.characterName ? ` (${e.e.characterName})` : ""}\nDates: ${e.e.startDate ?? "TBC"} – ${e.e.endDate ?? "TBC"}\n\nThe production office will send call sheets before each shoot day.\n`;
    const key = `cast_details:${e.e.id}:${sha256(body).slice(0, 16)}`;
    const [row] = await tx.insert(outboundMessages).values({ orgId: ctx.orgId, createdBy: ctx.userId, productionId: e.e.productionId, template: "cast_details", subjectType: "engagements", subjectId: e.e.id, toPersonId: e.p.id, toAddress: e.p.email, subject: `${e.prod.title} — your role details`, body, status: "awaiting_confirmation", idempotencyKey: key })
      .onConflictDoNothing().returning();
    if (!row) throw invalid("An identical message is already drafted or sent for this engagement.");
    await audit(tx, ctx, "draft_message", "outbound_messages", row.id, { productionId: e.e.productionId, meta: { template: "cast_details", to: e.p.id } });
    return row;
  });
}

/** Explicit confirmation step. Without a configured provider the message is blocked, never "sent". */
export async function confirmMessages(ctx: Ctx, ids: string[]) {
  if (!["org_admin", "producer", "production_manager"].includes(ctx.role)) throw forbidden();
  if (!ids.length) return { queued: 0, blocked: 0, providerReason: undefined as string | undefined };
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(outboundMessages).where(and(eq(outboundMessages.orgId, ctx.orgId), inArray(outboundMessages.id, ids)));
    const s = mailStatus();
    let queued = 0, blockedN = 0;
    for (const m of rows) {
      if (m.productionId && !productionAllowed(ctx, m.productionId)) continue;
      if (!["awaiting_confirmation", "blocked_no_provider", "failed"].includes(m.status)) continue;
      if (!s.enabled) {
        await tx.update(outboundMessages).set({ status: "blocked_no_provider", confirmedBy: ctx.userId, confirmedAt: new Date(), lastError: s.reason, updatedAt: new Date() }).where(eq(outboundMessages.id, m.id));
        blockedN++;
      } else {
        await tx.update(outboundMessages).set({ status: "queued", confirmedBy: ctx.userId, confirmedAt: new Date(), updatedAt: new Date() }).where(eq(outboundMessages.id, m.id));
        await emit(tx, { orgId: ctx.orgId, type: "outbound_message.confirmed", entityType: "outbound_messages", entityId: m.id, productionId: m.productionId, idempotencyKey: `message.dispatch:${m.id}`, actorUserId: ctx.userId });
        queued++;
      }
      await audit(tx, ctx, "confirm_message", "outbound_messages", m.id, { productionId: m.productionId, meta: { provider: s.provider, enabled: s.enabled, reason: s.reason } });
    }
    return { queued, blocked: blockedN, providerReason: s.enabled ? undefined : s.reason };
  });
}

export async function cancelMessages(ctx: Ctx, ids: string[]) {
  if (!["org_admin", "producer", "production_manager"].includes(ctx.role)) throw forbidden();
  await db.transaction(async (tx) => {
    for (const id of ids) {
      const [m] = await tx.select().from(outboundMessages).where(and(eq(outboundMessages.id, id), eq(outboundMessages.orgId, ctx.orgId))).limit(1);
      if (!m || ["sent", "queued"].includes(m.status)) continue;
      await tx.update(outboundMessages).set({ status: "cancelled", updatedAt: new Date() }).where(eq(outboundMessages.id, id));
      await audit(tx, ctx, "cancel_message", "outbound_messages", id, { productionId: m.productionId });
    }
  });
}
