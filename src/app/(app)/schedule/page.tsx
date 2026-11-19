import Link from "next/link";
import { and, asc, eq, gte, inArray, isNull, lte, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { episodes, productions, scenes, scheduleBlocks, shootDays } from "@/db/schema";
import { requirePageContext } from "@/server/auth/request";
import { conflictSummary } from "@/server/services/conflicts";
import { Stripboard } from "@/components/stripboard";
import { Empty, Forbidden, PageHeader, Tabs } from "@/components/ui";
import { canRead, canWrite } from "@/lib/permissions";
import { productionAllowed } from "@/server/entities/crud";

export const metadata = { title: "Schedule" };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ month?: string; production?: string; tab?: string }> }) {
  const ctx = await requirePageContext();
  if (!canRead(ctx.role, "production")) return <Forbidden what="the schedule" />;
  const sp = await searchParams;
  const prods = (await db.select({ id: productions.id, title: productions.title }).from(productions).where(and(eq(productions.orgId, ctx.orgId), isNull(productions.archivedAt))).orderBy(asc(productions.title))).filter((p) => productionAllowed(ctx, p.id));
  const tab = sp.tab === "stripboard" || sp.production ? "stripboard" : "calendar";
  const header = <PageHeader title="Scheduling & shoot days" lede="One calendar across every production. Open any day for the Shoot-Day Command, or plan scenes on the stripboard." />;

  if (tab === "stripboard") {
    const pid = sp.production && productionAllowed(ctx, sp.production) ? sp.production : prods[0]?.id;
    if (!pid) return <>{header}<Empty title="No productions">Create a production first.</Empty></>;
    const days = await db.select().from(shootDays).where(and(eq(shootDays.productionId, pid), isNull(shootDays.archivedAt))).orderBy(asc(shootDays.date), asc(shootDays.unit));
    const blocks = days.length ? await db.select({ b: scheduleBlocks, s: scenes }).from(scheduleBlocks).leftJoin(scenes, eq(scenes.id, scheduleBlocks.sceneId)).where(and(inArray(scheduleBlocks.shootDayId, days.map((d) => d.id)), isNull(scheduleBlocks.archivedAt))).orderBy(asc(scheduleBlocks.sortOrder)) : [];
    const scheduled = blocks.map((b) => b.b.sceneId).filter(Boolean) as string[];
    const uns = await db.select({ s: scenes, ep: episodes }).from(scenes).leftJoin(episodes, eq(episodes.id, scenes.episodeId)).where(and(eq(scenes.productionId, pid), isNull(scenes.archivedAt), notInArray(scenes.status, ["omitted", "complete"]), scheduled.length ? notInArray(scenes.id, scheduled) : undefined)).orderBy(asc(episodes.number), asc(scenes.sortOrder), asc(scenes.number));
    const cs = await conflictSummary(ctx, days.map((d) => d.id));
    return (
      <>{header}
        <Tabs tabs={[{ key: "calendar", label: "Calendar" }, { key: "stripboard", label: "Stripboard" }]} active="stripboard" base="/schedule" />
        <div className="row" style={{ marginBottom: 12 }} aria-label="Production">{prods.map((p) => <Link key={p.id} className={`badge plain ${p.id === pid ? "tone-live" : ""}`} href={`/schedule?tab=stripboard&production=${p.id}`}>{p.title}</Link>)}</div>
        <Stripboard productionId={pid} canWrite={canWrite(ctx.role, "production")}
          unscheduled={uns.map(({ s, ep }) => ({ id: s.id, number: s.number, title: s.title, estDurationMins: s.estDurationMins, episode: ep ? (ep.number != null ? `Ep ${ep.number}` : ep.title) : null }))}
          days={days.map((d) => ({ id: d.id, date: d.date, dayNumber: d.dayNumber, unit: d.unit, status: d.status, errors: cs[d.id]?.errors ?? 0, blocks: blocks.filter((b) => b.b.shootDayId === d.id).map(({ b, s }) => ({ id: b.id, sceneId: b.sceneId, number: s?.number ?? null, title: s?.title ?? b.label ?? b.kind, start: b.startTime })) }))} />
      </>
    );
  }

  const today = new Date();
  const [y, m] = (sp.month ?? iso(today).slice(0, 7)).split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first); start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 41);
  const ids = prods.map((p) => p.id);
  const days = ids.length ? await db.select().from(shootDays).where(and(inArray(shootDays.productionId, ids), isNull(shootDays.archivedAt), gte(shootDays.date, iso(start)), lte(shootDays.date, iso(end)))).orderBy(asc(shootDays.date)) : [];
  const cs = await conflictSummary(ctx, days.map((d) => d.id));
  const title = new Map(prods.map((p) => [p.id, p.title]));
  const nav = (delta: number) => { const d = new Date(Date.UTC(y, m - 1 + delta, 1)); return `/schedule?month=${iso(d).slice(0, 7)}`; };
  // Earliest/latest shoot days so imported historical schedules (e.g. all 40 legacy days) are reachable.
  const [bounds] = ids.length ? await db.select({ min: shootDays.date }).from(shootDays).where(and(inArray(shootDays.productionId, ids), isNull(shootDays.archivedAt))).orderBy(asc(shootDays.date)).limit(1) : [];
  return (
    <>{header}
      <Tabs tabs={[{ key: "calendar", label: "Calendar" }, { key: "stripboard", label: "Stripboard" }]} active="calendar" base="/schedule" />
      <div className="row" style={{ marginBottom: 12 }}>
        <Link className="btn" href={nav(-1)} aria-label="Previous month">←</Link>
        <h2 style={{ minWidth: 160, textAlign: "center" }}>{new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(first)}</h2>
        <Link className="btn" href={nav(1)} aria-label="Next month">→</Link>
        <Link className="btn btn-quiet" href="/schedule">Today</Link>
        {bounds?.min && <Link className="btn btn-quiet" href={`/schedule?month=${bounds.min.slice(0, 7)}`}>First shoot day</Link>}
        <span className="spacer" /><span className="subtle" style={{ fontSize: 12 }}>{days.length} shoot day(s) in view</span>
      </div>
      <div className="cal" role="grid" aria-label="Shoot day calendar">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="dow" role="columnheader">{d}</div>)}
        {Array.from({ length: 42 }).map((_, i) => {
          const d = new Date(start); d.setUTCDate(start.getUTCDate() + i);
          const key = iso(d);
          const evs = days.filter((x) => x.date === key);
          return (
            <div key={key} role="gridcell" className={`day ${d.getUTCMonth() !== m - 1 ? "other" : ""} ${key === iso(today) ? "today" : ""}`}>
              <span className="dnum">{d.getUTCDate()}</span>
              {evs.map((e) => <Link key={e.id} href={`/schedule/day/${e.id}`} className={`ev ${cs[e.id]?.errors ? "has-error" : e.status === "wrapped" ? "wrapped" : ""}`} title={`${title.get(e.productionId)} · ${e.unit}${cs[e.id]?.errors ? ` · ${cs[e.id].errors} conflict(s)` : ""}`}>{e.dayNumber ? `D${e.dayNumber} ` : ""}{title.get(e.productionId)}</Link>)}
            </div>
          );
        })}
      </div>
    </>
  );
}
