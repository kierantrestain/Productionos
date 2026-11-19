import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { budgetLines, budgets, expenses, purchaseOrders } from "@/db/schema";
import type { Ctx } from "../auth/context";
import { notFound } from "../errors";
import { loadProduction, requireRead } from "./guards";

export interface LineSummary {
  id: string; code: string | null; category: string; description: string | null; vatRateBp: number;
  estimate: number; approved: number; committed: number; actual: number; forecast: number; variance: number;
  estimateGross: number; approvedGross: number;
}
export interface BudgetSummary {
  budget: typeof budgets.$inferSelect;
  lines: LineSummary[];
  totals: Omit<LineSummary, "id" | "code" | "category" | "description" | "vatRateBp"> & { vatOnApproved: number; unallocatedActual: number; unallocatedCommitted: number };
}

/** VAT on a net amount at a basis-point rate, rounded half-up to the penny. */
export const vatOn = (netMinor: number, rateBp: number) => Math.round((netMinor * rateBp) / 10000);

/**
 * Budget-to-actual. All values NET in minor units:
 *  committed = approved, open (not closed) POs;  actual = approved or paid expenses;
 *  forecast (EFC) = explicit forecast if set, else max(approved, committed + actual);
 *  variance = approved − forecast (negative = overspend).
 * Expenses raised against a PO are counted once (as actual) and reduce that PO's commitment.
 */
export function summarise(lines: (typeof budgetLines.$inferSelect)[], pos: (typeof purchaseOrders.$inferSelect)[], exps: (typeof expenses.$inferSelect)[]) {
  const actualByPo = new Map<string, number>();
  for (const e of exps) if (e.purchaseOrderId && ["approved", "paid"].includes(e.status)) actualByPo.set(e.purchaseOrderId, (actualByPo.get(e.purchaseOrderId) ?? 0) + Number(e.netMinor));
  const committedFor = (lineId: string | null) => pos.filter((p) => p.budgetLineId === lineId && p.status === "approved")
    .reduce((a, p) => a + Math.max(Number(p.netMinor) - (actualByPo.get(p.id) ?? 0), 0), 0);
  const actualFor = (lineId: string | null) => exps.filter((e) => e.budgetLineId === lineId && ["approved", "paid"].includes(e.status)).reduce((a, e) => a + Number(e.netMinor), 0);
  const out: LineSummary[] = lines.map((l) => {
    const estimate = Number(l.estimateMinor), approved = Number(l.approvedMinor);
    const committed = committedFor(l.id), actual = actualFor(l.id);
    const forecast = l.forecastMinor != null ? Number(l.forecastMinor) : Math.max(approved, committed + actual);
    return { id: l.id, code: l.code, category: l.category, description: l.description, vatRateBp: l.vatRateBp, estimate, approved, committed, actual, forecast, variance: approved - forecast, estimateGross: estimate + vatOn(estimate, l.vatRateBp), approvedGross: approved + vatOn(approved, l.vatRateBp) };
  });
  const sum = (k: keyof LineSummary) => out.reduce((a, l) => a + (l[k] as number), 0);
  return {
    lines: out,
    totals: {
      estimate: sum("estimate"), approved: sum("approved"), committed: sum("committed"), actual: sum("actual"), forecast: sum("forecast"), variance: sum("variance"),
      estimateGross: sum("estimateGross"), approvedGross: sum("approvedGross"),
      vatOnApproved: out.reduce((a, l) => a + vatOn(l.approved, l.vatRateBp), 0),
      unallocatedActual: actualFor(null), unallocatedCommitted: committedFor(null),
    },
  };
}

export async function budgetSummary(ctx: Ctx, budgetId: string): Promise<BudgetSummary> {
  requireRead(ctx, "finance");
  const [b] = await db.select().from(budgets).where(and(eq(budgets.id, budgetId), eq(budgets.orgId, ctx.orgId), isNull(budgets.archivedAt))).limit(1);
  if (!b) throw notFound();
  await loadProduction(ctx, b.productionId);
  const lines = await db.select().from(budgetLines).where(and(eq(budgetLines.budgetId, b.id), isNull(budgetLines.archivedAt))).orderBy(asc(budgetLines.sortOrder), asc(budgetLines.code));
  const lineIds = lines.map((l) => l.id);
  const [pos, exps] = await Promise.all([
    db.select().from(purchaseOrders).where(and(eq(purchaseOrders.productionId, b.productionId), isNull(purchaseOrders.archivedAt))),
    db.select().from(expenses).where(and(eq(expenses.productionId, b.productionId), isNull(expenses.archivedAt))),
  ]);
  const inBudget = (id: string | null) => id === null || lineIds.includes(id);
  const s = summarise(lines, pos.filter((p) => inBudget(p.budgetLineId)), exps.filter((e) => inBudget(e.budgetLineId)));
  return { budget: b, ...s };
}

export async function productionFinance(ctx: Ctx, productionId: string) {
  requireRead(ctx, "finance");
  await loadProduction(ctx, productionId);
  const bs = await db.select().from(budgets).where(and(eq(budgets.productionId, productionId), isNull(budgets.archivedAt))).orderBy(asc(budgets.createdAt));
  return Promise.all(bs.map((b) => budgetSummary(ctx, b.id)));
}

/** Org-wide health for the executive dashboard: one row per production with an approved/locked budget. */
export async function financeHealth(ctx: Ctx, productionIds: string[]) {
  if (!productionIds.length) return [];
  const bs = await db.select().from(budgets).where(and(eq(budgets.orgId, ctx.orgId), inArray(budgets.productionId, productionIds), isNull(budgets.archivedAt)));
  const out: { productionId: string; budgetId: string; name: string; status: string; approved: number; forecast: number; actual: number; committed: number; variance: number }[] = [];
  for (const b of bs) {
    const s = await budgetSummary(ctx, b.id);
    out.push({ productionId: b.productionId, budgetId: b.id, name: `${b.name} ${b.versionLabel}`, status: b.status, approved: s.totals.approved, forecast: s.totals.forecast, actual: s.totals.actual, committed: s.totals.committed, variance: s.totals.variance });
  }
  return out;
}
