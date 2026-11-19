import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageContext } from "@/server/auth/request";
import { budgetSummary } from "@/server/services/finance";
import { loadProduction } from "@/server/services/guards";
import { RecordActions } from "@/components/record-actions";
import { EntityView } from "@/components/entity-view";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { money, pct } from "@/lib/format";

export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const s = await budgetSummary(ctx, id).catch(() => null);
  if (!s) notFound();
  const p = await loadProduction(ctx, s.budget.productionId);
  const c = s.budget.currency, t = s.totals;
  const cell = (v: number, bad = false) => <td className="num" style={bad && v < 0 ? { color: "var(--bad)", fontWeight: 650 } : undefined}>{money(v, c)}</td>;
  return (
    <>
      <PageHeader eyebrow={<><Link href="/budgets">Budgets</Link> / <Link href={`/productions/${p.id}?tab=money`}>{p.title}</Link></>}
        title={<span className="row" style={{ gap: 10 }}>{s.budget.name} {s.budget.versionLabel} <Badge value={s.budget.status} /></span>}
        lede="All figures net of VAT unless stated. Committed = approved, open POs not yet actualised. Forecast = explicit EFC or the greater of approved and committed + actual."
        actions={<><RecordActions entity="budgets" row={{ ...s.budget, id: s.budget.id } as never} role={ctx.role} /><Link className="btn" href={`/data/budgets/${id}`}>Edit budget</Link></>} />
      <div className="metrics">
        <div className="metric"><div className="v">{money(t.approved, c, { compact: true })}</div><div className="l">Approved (net)</div></div>
        <div className="metric"><div className="v">{money(t.committed, c, { compact: true })}</div><div className="l">Committed</div></div>
        <div className="metric"><div className="v">{money(t.actual, c, { compact: true })}</div><div className="l">Actual</div></div>
        <div className="metric"><div className="v">{money(t.forecast, c, { compact: true })}</div><div className="l">Forecast (EFC)</div></div>
        <div className={`metric ${t.variance < 0 ? "bad" : ""}`}><div className="v">{money(t.variance, c, { compact: true })}</div><div className="l">Variance</div></div>
        <div className="metric"><div className="v">{money(t.approvedGross, c, { compact: true })}</div><div className="l">Approved gross · VAT {money(t.vatOnApproved, c, { compact: true })}</div></div>
      </div>
      <Panel title="Budget-to-actual" flush>
        <div className="table-wrap" style={{ border: 0, borderRadius: 0, maxHeight: "none" }}>
          <table className="data">
            <thead><tr><th>Code</th><th>Category</th><th>Description</th><th className="num">VAT</th><th className="num">Estimate</th><th className="num">Approved</th><th className="num">Committed</th><th className="num">Actual</th><th className="num">Forecast</th><th className="num">Variance</th><th className="num">Approved gross</th></tr></thead>
            <tbody>
              {s.lines.map((l) => <tr key={l.id}><td className="mono">{l.code}</td><td><Link href={`/data/budget_lines/${l.id}`}>{l.category}</Link></td><td>{l.description}</td><td className="num">{pct(l.vatRateBp)}</td>{cell(l.estimate)}{cell(l.approved)}{cell(l.committed)}{cell(l.actual)}{cell(l.forecast)}{cell(l.variance, true)}{cell(l.approvedGross)}</tr>)}
              {(t.unallocatedActual > 0 || t.unallocatedCommitted > 0) && <tr><td /><td colSpan={5} className="subtle">Unallocated (no budget line)</td>{cell(t.unallocatedCommitted)}{cell(t.unallocatedActual)}<td colSpan={3} /></tr>}
              <tr style={{ fontWeight: 700 }}><td /><td colSpan={3}>Total</td>{cell(t.estimate)}{cell(t.approved)}{cell(t.committed)}{cell(t.actual)}{cell(t.forecast)}{cell(t.variance, true)}{cell(t.approvedGross)}</tr>
            </tbody>
          </table>
        </div>
      </Panel>
      <div style={{ marginTop: 16 }}><EntityView ctx={ctx} entity="budget_lines" sp={{}} fixed={{ budgetId: id, productionId: p.id }} title="Edit lines" /></div>
    </>
  );
}
