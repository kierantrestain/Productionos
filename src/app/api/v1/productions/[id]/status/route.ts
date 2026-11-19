import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { deliverables, scenes, shootDays } from "@/db/schema";
import { apiContext } from "@/server/integrations/api-auth";
import { loadProduction } from "@/server/services/guards";
import { productionFinance } from "@/server/services/finance";

/** GET /api/v1/productions/:id/status — scope status:read. Production health summary (e.g. for Mimic OS). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await apiContext(req, "status:read");
  if (a instanceof NextResponse) return a;
  const { id } = await params;
  const p = await loadProduction(a.ctx, id).catch(() => null);
  if (!p) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const count = (t: typeof scenes | typeof deliverables, col: typeof scenes.status | typeof deliverables.status) =>
    db.select({ status: col, n: sql<number>`count(*)::int` }).from(t).where(and(eq(t.productionId, id), isNull(t.archivedAt))).groupBy(col);
  const [sc, dl, days, fin] = await Promise.all([count(scenes, scenes.status), count(deliverables, deliverables.status),
    db.select({ n: sql<number>`count(*)::int`, next: sql<string | null>`min(date) filter (where date >= current_date and status <> 'cancelled')` }).from(shootDays).where(and(eq(shootDays.productionId, id), isNull(shootDays.archivedAt))),
    productionFinance(a.ctx, id)]);
  return NextResponse.json({ version: 1, data: {
    id: p.id, title: p.title, status: p.status,
    scenes: Object.fromEntries(sc.map((r) => [r.status, r.n])), deliverables: Object.fromEntries(dl.map((r) => [r.status, r.n])),
    shootDays: { total: days[0].n, next: days[0].next },
    budgets: fin.map((b) => ({ name: b.budget.name, status: b.budget.status, currency: b.budget.currency, approvedNetMinor: b.totals.approved, forecastNetMinor: b.totals.forecast, varianceNetMinor: b.totals.variance })),
  } });
}
