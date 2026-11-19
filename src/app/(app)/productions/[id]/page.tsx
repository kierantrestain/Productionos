import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull, sql, asc } from "drizzle-orm";
import { db } from "@/db";
import { episodes, scenes, shootDays, shots } from "@/db/schema";
import { requirePageContext } from "@/server/auth/request";
import { loadProduction } from "@/server/services/guards";
import { Workspace } from "@/components/workspace";
import { RecordDetail } from "@/components/record-detail";
import { EntityView, type SP } from "@/components/entity-view";
import { Badge } from "@/components/ui";
import { date, humanize } from "@/lib/format";
import { canRead } from "@/lib/permissions";
import { productionFinance } from "@/server/services/finance";
import { money } from "@/lib/format";

export default async function ProductionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const sp = await searchParams;
  const p = await loadProduction(ctx, id).catch(() => null);
  if (!p) notFound();
  const fixed = { productionId: id };
  const eps = await db.select().from(episodes).where(and(eq(episodes.productionId, id), isNull(episodes.archivedAt))).orderBy(asc(episodes.number));
  const episodeChips = (tab: string) => p.usesEpisodes && eps.length > 0 ? (
    <div className="row" style={{ marginBottom: 10 }} aria-label="Filter by episode">
      <Link className={`badge plain ${!sp.f_episodeId ? "tone-live" : ""}`} href={`/productions/${id}?tab=${tab}`}>All</Link>
      {eps.map((e) => <Link key={e.id} className={`badge plain ${sp.f_episodeId === e.id ? "tone-live" : ""}`} href={`/productions/${id}?tab=${tab}&f_episodeId=${e.id}`}>{e.number != null ? `Ep ${e.number}` : e.title}</Link>)}
    </div>) : null;

  const overview = async () => {
    const [[sc], [sh], days] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int`, ready: sql<number>`count(*) filter (where status in ('ready','scheduled'))::int`, shot: sql<number>`count(*) filter (where status in ('shot','in_post','complete'))::int` }).from(scenes).where(and(eq(scenes.productionId, id), isNull(scenes.archivedAt))),
      db.select({ total: sql<number>`count(*)::int` }).from(shots).where(and(eq(shots.productionId, id), isNull(shots.archivedAt))),
      db.select().from(shootDays).where(and(eq(shootDays.productionId, id), isNull(shootDays.archivedAt))).orderBy(asc(shootDays.date)),
    ]);
    const fin = canRead(ctx.role, "finance") ? await productionFinance(ctx, id) : [];
    const next = days.find((d) => d.date >= new Date().toISOString().slice(0, 10) && d.status !== "cancelled");
    return (
      <RecordDetail bare ctx={ctx} entity="productions" id={id} eyebrow={<><Link href="/productions">Productions</Link> / {humanize(p.kind)}</>}
        actions={<><Link className="btn" href={`/schedule?production=${id}`}>Stripboard</Link>{next && <Link className="btn btn-primary" href={`/schedule/day/${next.id}`}>Next shoot day · {date(next.date, { short: true })}</Link>}</>}
        below={
          <div className="metrics" style={{ marginBottom: 0 }}>
            <Link className="metric" href={`/productions/${id}?tab=episodes`}><div className="v">{p.usesEpisodes ? eps.length : "—"}</div><div className="l">{p.usesEpisodes ? "Episodes / units" : "Standalone"}</div></Link>
            <Link className="metric" href={`/productions/${id}?tab=scenes`}><div className="v">{sc.total}</div><div className="l">Scenes & segments · {sc.shot} shot</div></Link>
            <Link className="metric" href={`/productions/${id}?tab=shots`}><div className="v">{sh.total}</div><div className="l">Shots</div></Link>
            <Link className="metric" href={`/productions/${id}?tab=schedule`}><div className="v">{days.length}</div><div className="l">Shoot days</div></Link>
            {fin.map((b) => <Link key={b.budget.id} className={`metric ${b.totals.variance < 0 ? "bad" : ""}`} href={`/budgets/${b.budget.id}`}><div className="v">{money(b.totals.variance, b.budget.currency, { compact: true })}</div><div className="l">Variance · {b.budget.name}</div></Link>)}
          </div>
        } />
    );
  };

  return (
    <Workspace ctx={ctx} sp={sp} base={`/productions/${id}`} title={<span className="row" style={{ gap: 10 }}>{p.title} <Badge value={p.status} />{p.isLegacyImport && <span className="badge tone-info">Legacy import</span>}</span>}
      eyebrow={<><Link href="/productions">Productions</Link> / {humanize(p.kind)}{p.usesEpisodes ? "" : " · standalone"}</>}
      tabs={[
        { key: "overview", label: "Overview", render: overview },
        ...(p.usesEpisodes ? [{ key: "episodes", label: "Episodes", entity: "episodes", fixed }] : []),
        { key: "scenes", label: p.kind === "series" || p.kind === "film" ? "Scenes" : "Segments & running order", render: async () => <>{episodeChips("scenes")}<EntityView ctx={ctx} entity="scenes" sp={sp} fixed={{ ...fixed, ...(typeof sp.f_episodeId === "string" ? { episodeId: sp.f_episodeId } : {}) }} recordBase={`/productions/${id}/scenes`} /></> },
        { key: "shots", label: "Shot list", entity: "shots", fixed },
        { key: "schedule", label: "Shoot days", entity: "shoot_days", fixed, recordBase: "/schedule/day" },
        { key: "people", label: "Cast & crew", entity: "engagements", fixed },
        { key: "locations", label: "Location bookings", entity: "location_bookings", fixed },
        { key: "kit", label: "Kit bookings", entity: "resource_bookings", fixed },
        { key: "money", label: "Budgets", entity: "budgets", fixed, recordBase: "/budgets" },
        { key: "pos", label: "POs", entity: "purchase_orders", fixed },
        { key: "expenses", label: "Expenses", entity: "expenses", fixed },
        { key: "post", label: "Post", entity: "post_tasks", fixed },
        { key: "cuts", label: "Cuts & review", entity: "edit_versions", fixed },
        { key: "deliverables", label: "Deliverables", entity: "deliverables", fixed },
        { key: "contracts", label: "Contracts", entity: "contracts", fixed },
        { key: "releases", label: "Releases", entity: "release_forms", fixed },
        { key: "commercial", label: "Sponsors", entity: "sponsor_deals", fixed },
      ]} />
  );
}
