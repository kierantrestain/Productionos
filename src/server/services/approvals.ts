import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import {
  approvalDecisions, approvalRequests, budgetLines, budgets, contracts, expenses, greenlightGates, ipProjects, purchaseOrders,
} from "@/db/schema";
import { canDecide } from "@/lib/permissions";
import type { Ctx } from "../auth/context";
import { audit, emit } from "../audit";
import { productionAllowed } from "../entities/crud";
import { forbidden, invalid, notFound } from "../errors";
import { requireRead, requireWrite } from "./guards";

/** Authority thresholds (gross, pence). Documented in docs/BUSINESS_RULES.md. */
export function requiredRoleForSpend(grossMinor: number) {
  if (grossMinor < 100_000) return "production_manager"; // < £1,000
  if (grossMinor < 1_000_000) return "producer"; // < £10,000
  return "executive";
}

type SubjectType = "purchase_orders" | "expenses" | "budgets" | "greenlight_gates" | "contracts";

async function loadSubject(tx: DbOrTx, ctx: Ctx, type: SubjectType, id: string) {
  const tables = { purchase_orders: purchaseOrders, expenses, budgets, greenlight_gates: greenlightGates, contracts } as const;
  const t = tables[type] as any;
  const [row] = await tx.select().from(t).where(and(eq(t.id, id), eq(t.orgId, ctx.orgId), isNull(t.archivedAt))).limit(1);
  if (!row) throw notFound();
  const pid = (row as any).productionId as string | null | undefined;
  if (pid && !productionAllowed(ctx, pid)) throw notFound();
  return row as any;
}

/** Submit a subject for approval. Computes the required authority server-side. */
export async function requestApproval(ctx: Ctx, subjectType: SubjectType, subjectId: string, note?: string) {
  const domain = subjectType === "greenlight_gates" ? "slate" : subjectType === "contracts" ? "legal" : "finance";
  requireWrite(ctx, domain);
  return db.transaction(async (tx) => {
    const s = await loadSubject(tx, ctx, subjectType, subjectId);
    const [open] = await tx.select({ id: approvalRequests.id }).from(approvalRequests)
      .where(and(eq(approvalRequests.subjectId, subjectId), eq(approvalRequests.status, "pending"))).limit(1);
    if (open) throw invalid("This item already has a pending approval.");
    let kind: string, title: string, amountMinor: number | null = null, requiredRole: string;
    switch (subjectType) {
      case "purchase_orders":
        if (s.status !== "draft" && s.status !== "rejected") throw invalid("Only draft or rejected POs can be submitted.");
        amountMinor = Number(s.netMinor) + Number(s.vatMinor); kind = "purchase_order"; title = `PO ${s.number}: ${s.description}`; requiredRole = requiredRoleForSpend(amountMinor);
        await tx.update(purchaseOrders).set({ status: "pending_approval", updatedAt: new Date() }).where(eq(purchaseOrders.id, s.id));
        break;
      case "expenses":
        if (!["draft", "submitted", "rejected"].includes(s.status)) throw invalid("This expense cannot be submitted.");
        amountMinor = Number(s.netMinor) + Number(s.vatMinor); kind = "expense"; title = `Expense: ${s.description}`; requiredRole = requiredRoleForSpend(amountMinor);
        await tx.update(expenses).set({ status: "submitted", updatedAt: new Date() }).where(eq(expenses.id, s.id));
        break;
      case "budgets": {
        if (s.status === "locked") throw invalid("Locked budgets cannot be resubmitted.");
        const [{ total }] = await tx.select({ total: sql<number>`coalesce(sum(${budgetLines.estimateMinor}),0)::bigint` }).from(budgetLines).where(and(eq(budgetLines.budgetId, s.id), isNull(budgetLines.archivedAt)));
        amountMinor = Number(total); kind = "budget"; title = `Budget ${s.name} ${s.versionLabel}`; requiredRole = "executive";
        await tx.update(budgets).set({ status: "submitted", updatedAt: new Date() }).where(eq(budgets.id, s.id));
        break;
      }
      case "greenlight_gates": {
        const [ip] = await tx.select().from(ipProjects).where(eq(ipProjects.id, s.ipProjectId));
        kind = "greenlight"; title = `${s.gate} gate — ${ip?.title ?? "project"}`; requiredRole = "executive";
        await tx.update(greenlightGates).set({ status: "in_review", updatedAt: new Date() }).where(eq(greenlightGates.id, s.id));
        break;
      }
      case "contracts":
        if (!["draft", "generated", "blocked"].includes(s.status)) throw invalid("Only draft or generated contracts can be submitted for approval.");
        amountMinor = s.valueMinor != null ? Number(s.valueMinor) : null; kind = "contract"; title = `Contract: ${s.title}`; requiredRole = "finance_legal";
        break;
    }
    const [req] = await tx.insert(approvalRequests).values({
      orgId: ctx.orgId, createdBy: ctx.userId, productionId: s.productionId ?? null, subjectType, subjectId, kind: kind!, title: title!, amountMinor,
      requiredRole: requiredRole!, status: "pending", requestedBy: ctx.userId, decisionNote: null,
    }).returning();
    if (subjectType === "purchase_orders" || subjectType === "expenses") {
      const t = subjectType === "purchase_orders" ? purchaseOrders : expenses;
      await tx.update(t).set({ approvalRequestId: req.id }).where(eq(t.id, s.id));
    }
    if (subjectType === "greenlight_gates") await tx.update(greenlightGates).set({ approvalRequestId: req.id }).where(eq(greenlightGates.id, s.id));
    await tx.insert(approvalDecisions).values({ orgId: ctx.orgId, approvalRequestId: req.id, actorUserId: ctx.userId, actorRole: ctx.role, decision: "submitted", note: note ?? null });
    await audit(tx, ctx, "request_approval", subjectType, subjectId, { productionId: s.productionId ?? null, meta: { approvalRequestId: req.id, requiredRole, amountMinor } });
    await emit(tx, { orgId: ctx.orgId, type: "approval.requested", entityType: "approval_requests", entityId: req.id, productionId: s.productionId ?? null, idempotencyKey: `approval.requested:${req.id}`, actorUserId: ctx.userId });
    return req;
  });
}

/**
 * Decide an approval. Server checks authority for the required role, prevents self-approval
 * (segregation of duties), records an immutable decision and applies the effect atomically.
 */
export async function decideApproval(ctx: Ctx, approvalId: string, decision: "approved" | "rejected", note?: string) {
  requireRead(ctx, "approvals");
  if (decision === "rejected" && !note?.trim()) throw invalid("A reason is required when rejecting.");
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(approvalRequests).where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.orgId, ctx.orgId))).for("update").limit(1);
    if (!req || (req.productionId && !productionAllowed(ctx, req.productionId))) throw notFound();
    if (req.historical) throw invalid("Historical imported approvals are read-only records and cannot be decided.");
    if (req.status !== "pending") throw invalid(`This request is already ${req.status}.`);
    if (!canDecide(ctx.role, req.requiredRole)) throw forbidden(`This approval requires ${req.requiredRole.replace("_", " ")} authority.`);
    if (req.requestedBy === ctx.userId) throw forbidden("You cannot approve your own request.");
    await tx.update(approvalRequests).set({ status: decision, decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: note ?? null, updatedAt: new Date(), version: sql`${approvalRequests.version} + 1` }).where(eq(approvalRequests.id, req.id));
    await tx.insert(approvalDecisions).values({ orgId: ctx.orgId, approvalRequestId: req.id, actorUserId: ctx.userId, actorRole: ctx.role, decision, note: note ?? null });
    const ok = decision === "approved";
    switch (req.subjectType) {
      case "purchase_orders": await tx.update(purchaseOrders).set({ status: ok ? "approved" : "rejected", updatedAt: new Date() }).where(eq(purchaseOrders.id, req.subjectId)); break;
      case "expenses": await tx.update(expenses).set({ status: ok ? "approved" : "rejected", updatedAt: new Date() }).where(eq(expenses.id, req.subjectId)); break;
      case "budgets":
        await tx.update(budgets).set(ok ? { status: "approved", approvedAt: new Date(), approvedBy: ctx.userId, updatedAt: new Date() } : { status: "draft", updatedAt: new Date() }).where(eq(budgets.id, req.subjectId));
        if (ok) await tx.update(budgetLines).set({ approvedMinor: sql`${budgetLines.estimateMinor}` }).where(and(eq(budgetLines.budgetId, req.subjectId), eq(budgetLines.approvedMinor, 0)));
        break;
      case "greenlight_gates": {
        const today = new Date().toISOString().slice(0, 10);
        const [g] = await tx.update(greenlightGates).set({ status: ok ? "approved" : "rejected", decidedOn: today, decision: note ?? (ok ? "Approved" : "Rejected"), updatedAt: new Date() }).where(eq(greenlightGates.id, req.subjectId)).returning();
        if (ok && g?.gate === "greenlight") await tx.update(ipProjects).set({ stage: "greenlit", updatedAt: new Date() }).where(eq(ipProjects.id, g.ipProjectId));
        break;
      }
      case "contracts": if (ok) await tx.update(contracts).set({ status: "approved", updatedAt: new Date() }).where(eq(contracts.id, req.subjectId)); break;
    }
    await audit(tx, ctx, `approval_${decision}`, req.subjectType, req.subjectId, { productionId: req.productionId, meta: { approvalRequestId: req.id, note } });
    await emit(tx, { orgId: ctx.orgId, type: `approval.${decision}`, entityType: "approval_requests", entityId: req.id, productionId: req.productionId, idempotencyKey: `approval.decided:${req.id}`, actorUserId: ctx.userId });
    return { id: req.id, status: decision };
  });
}

export async function withdrawApproval(ctx: Ctx, approvalId: string) {
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(approvalRequests).where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.orgId, ctx.orgId))).limit(1);
    if (!req) throw notFound();
    if (req.requestedBy !== ctx.userId && ctx.role !== "org_admin") throw forbidden();
    if (req.status !== "pending") throw invalid("Only pending requests can be withdrawn.");
    await tx.update(approvalRequests).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(approvalRequests.id, req.id));
    await tx.insert(approvalDecisions).values({ orgId: ctx.orgId, approvalRequestId: req.id, actorUserId: ctx.userId, actorRole: ctx.role, decision: "withdrawn" });
    if (req.subjectType === "purchase_orders") await tx.update(purchaseOrders).set({ status: "draft" }).where(eq(purchaseOrders.id, req.subjectId));
    if (req.subjectType === "greenlight_gates") await tx.update(greenlightGates).set({ status: "pending" }).where(eq(greenlightGates.id, req.subjectId));
    if (req.subjectType === "budgets") await tx.update(budgets).set({ status: "draft" }).where(eq(budgets.id, req.subjectId));
    await audit(tx, ctx, "approval_withdrawn", req.subjectType, req.subjectId, { productionId: req.productionId });
  });
}

export async function listApprovals(ctx: Ctx, status: "pending" | "all" = "pending") {
  requireRead(ctx, "approvals");
  const rows = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.orgId, ctx.orgId), status === "pending" ? and(eq(approvalRequests.status, "pending"), eq(approvalRequests.historical, false)) : undefined))
    .orderBy(desc(approvalRequests.createdAt)).limit(500);
  return rows.filter((r) => !r.productionId || productionAllowed(ctx, r.productionId)).map((r) => ({ ...r, canDecide: !r.historical && canDecide(ctx.role, r.requiredRole) && r.requestedBy !== ctx.userId && r.status === "pending" }));
}

export async function approvalChain(ctx: Ctx, approvalId: string) {
  requireRead(ctx, "approvals");
  return db.select().from(approvalDecisions).where(and(eq(approvalDecisions.approvalRequestId, approvalId), eq(approvalDecisions.orgId, ctx.orgId))).orderBy(approvalDecisions.at);
}
