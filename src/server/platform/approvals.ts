/**
 * Human-in-the-loop approval queue. AI agents never write directly and automations never call external
 * URLs directly: they file an approval. On approval the action runs with the APPROVER's permissions
 * (so an approval can't escalate access), the outcome is stored, and everything is audited.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { baseApprovals } from "@/db/schema";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { atLeast, baseAccess } from "./access";
import { addComment, createRecords, updateRecord } from "./records";

export type ApprovalKind = "create_record" | "update_record" | "add_comment" | "webhook";
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (u, i) => fetch(u, i);
/** Test seam (mock-only). */
export function __setApprovalFetcher(f: Fetcher | null) { fetcher = f ?? ((u, i) => fetch(u, i)); }

export async function fileApproval(input: { orgId: string; baseId: string; source: "agent" | "automation"; sourceId?: string; threadId?: string; requestedBy?: string | null; kind: ApprovalKind; payload: Record<string, unknown>; summary: string }) {
  const [row] = await db.insert(baseApprovals).values({ ...input, summary: input.summary.slice(0, 500), requestedBy: input.requestedBy ?? null }).returning();
  return row;
}

export async function listApprovals(ctx: Ctx, baseId: string, status: "pending" | "all" = "pending") {
  const { role } = await baseAccess(ctx, baseId);
  const rows = await db.select().from(baseApprovals).where(and(eq(baseApprovals.baseId, baseId), eq(baseApprovals.orgId, ctx.orgId), ...(status === "pending" ? [eq(baseApprovals.status, "pending")] : []))).orderBy(desc(baseApprovals.createdAt)).limit(100);
  // Creators see the whole queue; everyone else sees only what they asked for.
  return rows.filter((r) => atLeast(role, "creator") || r.requestedBy === ctx.userId);
}

export async function decideApproval(ctx: Ctx, id: string, approve: boolean) {
  const [a] = await db.select().from(baseApprovals).where(and(eq(baseApprovals.id, id), eq(baseApprovals.orgId, ctx.orgId))).limit(1);
  if (!a) throw notFound("Approval not found.");
  if (a.status !== "pending") throw invalid(`This request was already ${a.status}.`);
  const { role } = await baseAccess(ctx, a.baseId);
  const mayDecide = a.kind === "webhook" ? atLeast(role, "creator") : atLeast(role, "creator") || (a.requestedBy === ctx.userId && atLeast(role, "editor"));
  if (!mayDecide) throw forbidden(a.kind === "webhook" ? "Only creators can approve outbound requests." : "You can't approve this request.");
  // Claim atomically so two people can't both execute it.
  const [claimed] = await db.update(baseApprovals).set({ status: approve ? "approved" : "rejected", decidedBy: ctx.userId, decidedAt: new Date() }).where(and(eq(baseApprovals.id, id), eq(baseApprovals.status, "pending"))).returning();
  if (!claimed) throw invalid("Someone else just decided this request.");
  await audit(db, ctx, approve ? "approve" : "reject", "base_approvals", id, { meta: { kind: a.kind, source: a.source, summary: a.summary } });
  if (!approve) return { status: "rejected" as const };
  const p = a.payload as Record<string, unknown>;
  try {
    let result: Record<string, unknown> = {};
    if (a.kind === "create_record") { const [rid] = await createRecords(ctx, String(p.tableId), [p.values as Record<string, unknown>]); result = { recordId: rid }; }
    else if (a.kind === "update_record") { await updateRecord(ctx, String(p.recordId), p.values as Record<string, unknown>); result = { recordId: p.recordId }; }
    else if (a.kind === "add_comment") { const c = await addComment(ctx, String(p.recordId), String(p.body)); result = { commentId: c.id }; }
    else if (a.kind === "webhook") {
      const { assertPublicUrl } = await import("./sync");
      const u = await assertPublicUrl(String(p.url));
      const r = await fetcher(u.toString(), { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": a.id }, body: JSON.stringify(p.body ?? {}), redirect: "error", signal: AbortSignal.timeout(15_000) });
      result = { status: r.status };
      if (!r.ok) throw new Error(`The endpoint returned HTTP ${r.status}.`);
    }
    await db.update(baseApprovals).set({ result }).where(eq(baseApprovals.id, id));
    return { status: "approved" as const, result };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 500);
    await db.update(baseApprovals).set({ status: "failed", result: { error: msg } }).where(eq(baseApprovals.id, id));
    throw invalid(`Approved, but it couldn't be carried out: ${msg}`);
  }
}
