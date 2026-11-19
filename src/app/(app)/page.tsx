import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageContext } from "@/server/auth/request";
import { homeFor } from "@/lib/nav";
import { commandCentre } from "@/server/services/dashboard";
import { Badge, Empty, PageHeader, Panel } from "@/components/ui";
import { date, humanize, money } from "@/lib/format";

export const metadata = { title: "Command Centre" };

export default async function CommandCentrePage() {
  const ctx = await requirePageContext();
  if (homeFor(ctx.role) !== "/") redirect(homeFor(ctx.role));
  const data = await commandCentre(ctx);
  return (
    <>
      <PageHeader title="Command Centre" eyebrow={new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "Europe/London" }).format(new Date())}
        lede="Live position across your productions. Every figure is a database count — select it to see the records behind it." />
      <div className="metrics" role="list" aria-label="Key metrics">
        {data.metrics.map((m) => (
          <Link key={m.key} href={m.href} className={`metric ${m.tone ?? ""}`} role="listitem" title={m.definition}>
            <div className="v">{m.value}</div><div className="l">{m.label}</div>
          </Link>
        ))}
      </div>
      <div className="grid-2">
        <div className="stack">
          <Panel title="Upcoming shoot days" actions={<Link className="btn btn-sm" href="/schedule">Open schedule</Link>} flush>
            {data.upcoming.length === 0 ? <Empty title="Nothing scheduled">Create shoot days from a production’s schedule.</Empty> : (
              <ul className="list">{data.upcoming.map((d) => (
                <li key={d.id}>
                  <div style={{ width: 92 }}><strong>{date(d.date, { weekday: true, short: true })}</strong><div className="subtle" style={{ fontSize: 12 }}>{d.dayNumber ? `Day ${d.dayNumber}` : d.unit}</div></div>
                  <div style={{ flex: 1, minWidth: 0 }}><Link href={`/schedule/day/${d.id}`} style={{ fontWeight: 560 }}>{d.production}</Link><div className="subtle" style={{ fontSize: 12 }}>{d.unit}</div></div>
                  {d.conflicts.errors > 0 ? <span className="badge tone-bad">{d.conflicts.errors} conflict{d.conflicts.errors > 1 ? "s" : ""}</span> : d.conflicts.warnings > 0 ? <span className="badge tone-warn">{d.conflicts.warnings} warning{d.conflicts.warnings > 1 ? "s" : ""}</span> : <span className="badge tone-ok">Clear</span>}
                  <Badge value={d.status} />
                </li>))}
              </ul>)}
          </Panel>
          {data.finance.length > 0 && (
            <Panel title="Budget health" actions={<Link className="btn btn-sm" href="/budgets">Budgets</Link>} flush>
              <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
                <table className="data"><thead><tr><th>Production</th><th>Budget</th><th className="num">Approved</th><th className="num">Committed</th><th className="num">Actual</th><th className="num">Forecast</th><th className="num">Variance</th></tr></thead>
                  <tbody>{data.finance.map((f) => (
                    <tr key={f.budgetId}><td><Link href={`/productions/${f.productionId}?tab=money`}>{f.production}</Link></td><td><Link href={`/budgets/${f.budgetId}`}>{f.name}</Link> <Badge value={f.status} /></td>
                      <td className="num">{money(f.approved)}</td><td className="num">{money(f.committed)}</td><td className="num">{money(f.actual)}</td><td className="num">{money(f.forecast)}</td>
                      <td className="num" style={{ color: f.variance < 0 ? "var(--bad)" : undefined, fontWeight: 600 }}>{money(f.variance)}</td></tr>))}
                  </tbody></table>
              </div>
            </Panel>
          )}
        </div>
        <div className="stack">
          <Panel title="Productions" actions={<Link className="btn btn-sm" href="/productions">All</Link>} flush>
            {data.productions.length === 0 ? <Empty title="No productions yet" action={<Link className="btn btn-primary" href="/productions">Create a production</Link>} /> : (
              <ul className="list">{data.productions.slice(0, 10).map((p) => (
                <li key={p.id}><div style={{ flex: 1, minWidth: 0 }}><Link href={`/productions/${p.id}`} style={{ fontWeight: 560 }}>{p.title}</Link><div className="subtle" style={{ fontSize: 12 }}>{humanize(p.kind)}{p.isLegacyImport ? " · legacy import" : ""}</div></div><Badge value={p.status} /></li>))}
              </ul>)}
          </Panel>
          <Panel title="Deliverables due" actions={<Link className="btn btn-sm" href="/post?tab=deliverables">Post</Link>} flush>
            {data.deliverables.length === 0 ? <Empty title="No open deliverables" /> : (
              <ul className="list">{data.deliverables.map((d) => (
                <li key={d.id}><div style={{ flex: 1, minWidth: 0 }}><Link href={`/data/deliverables/${d.id}`} style={{ fontWeight: 560 }}>{d.title}</Link><div className="subtle" style={{ fontSize: 12 }}>{d.production} · due {date(d.dueDate)}</div></div><Badge value={d.status} /></li>))}
              </ul>)}
          </Panel>
        </div>
      </div>
    </>
  );
}
