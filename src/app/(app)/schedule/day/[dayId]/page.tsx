import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { dayCalls, people, scheduleBlocks, scenes, shootDays, productions, locations } from "@/db/schema";
import { requirePageContext } from "@/server/auth/request";
import { productionAllowed } from "@/server/entities/crud";
import { buildSnapshot, listCallSheets } from "@/server/services/callsheets";
import { DayCommand, type DayData } from "@/components/day-command";
import { EntityView } from "@/components/entity-view";
import { PageHeader } from "@/components/ui";
import { canRead, canWrite } from "@/lib/permissions";
import { date } from "@/lib/format";

export default async function ShootDayPage({ params }: { params: Promise<{ dayId: string }> }) {
  const ctx = await requirePageContext();
  if (!canRead(ctx.role, "production")) notFound();
  const { dayId } = await params;
  const [day] = await db.select().from(shootDays).where(and(eq(shootDays.id, dayId), eq(shootDays.orgId, ctx.orgId), isNull(shootDays.archivedAt))).limit(1);
  if (!day || !productionAllowed(ctx, day.productionId)) notFound();
  const [[prod], snapshot, sheets, blocks, calls, otherDays] = await Promise.all([
    db.select().from(productions).where(eq(productions.id, day.productionId)),
    buildSnapshot(ctx, day.id), listCallSheets(ctx, day.id),
    db.select({ b: scheduleBlocks, s: scenes, loc: locations.name }).from(scheduleBlocks).leftJoin(scenes, eq(scenes.id, scheduleBlocks.sceneId)).leftJoin(locations, sql`${locations.id} = coalesce(${scheduleBlocks.locationId}, ${scenes.locationId})`)
      .where(and(eq(scheduleBlocks.shootDayId, day.id), isNull(scheduleBlocks.archivedAt))).orderBy(asc(scheduleBlocks.sortOrder)),
    db.select({ c: dayCalls, name: people.fullName }).from(dayCalls).innerJoin(people, eq(people.id, dayCalls.personId)).where(and(eq(dayCalls.shootDayId, day.id), isNull(dayCalls.archivedAt))).orderBy(asc(dayCalls.callTime), asc(people.fullName)),
    db.select({ id: shootDays.id, date: shootDays.date, dayNumber: shootDays.dayNumber }).from(shootDays).where(and(eq(shootDays.productionId, day.productionId), isNull(shootDays.archivedAt), sql`${shootDays.id} <> ${day.id}`)).orderBy(asc(shootDays.date)),
  ]);
  const scheduledIds = (await db.selectDistinct({ id: scheduleBlocks.sceneId }).from(scheduleBlocks).where(and(eq(scheduleBlocks.productionId, day.productionId), isNull(scheduleBlocks.archivedAt)))).map((r) => r.id).filter(Boolean) as string[];
  const unscheduled = await db.select({ id: scenes.id, number: scenes.number, title: scenes.title, estDurationMins: scenes.estDurationMins }).from(scenes)
    .where(and(eq(scenes.productionId, day.productionId), isNull(scenes.archivedAt), notInArray(scenes.status, ["omitted", "complete"]), scheduledIds.length ? notInArray(scenes.id, scheduledIds) : undefined)).orderBy(asc(scenes.sortOrder), asc(scenes.number));
  const snapBlocks = snapshot.schedule;
  const data: DayData = {
    day: { id: day.id, date: day.date, dayNumber: day.dayNumber, unit: day.unit, status: day.status, generalCall: day.generalCall, estWrap: day.estWrap, productionId: day.productionId, notes: day.notes },
    production: { id: prod.id, title: prod.title },
    base: snapshot.base ? { name: snapshot.base.name, address: snapshot.base.address, postcode: snapshot.base.postcode, parking: snapshot.base.parking } : null,
    blocks: blocks.map(({ b, s, loc }, i) => ({ id: b.id, kind: b.kind, sceneId: b.sceneId, label: b.label, startTime: b.startTime, endTime: b.endTime, sceneNumber: s?.number ?? null, sceneTitle: s?.title ?? null, intExt: s?.intExt ?? null, dayNight: s?.dayNight ?? null, location: loc ?? null, cast: snapBlocks[i]?.cast ?? [], requirements: snapBlocks[i]?.requirements ?? [] })),
    calls: calls.map(({ c, name }) => ({ id: c.id, personId: c.personId, name, roleType: c.roleType, roleTitle: c.roleTitle, callTime: c.callTime, onSetTime: c.onSetTime, pickupTime: c.pickupTime, confirmed: c.confirmed, checkedInAt: c.checkedInAt?.toISOString() ?? null })),
    conflicts: snapshot.openIssues.map((o) => ({ ...o, type: "time_overlap" as const, severity: o.severity as "error" | "warning" })),
    snapshot, callSheets: sheets.map((s) => ({ ...s, issuedAt: s.issuedAt?.toISOString() ?? null })), unscheduled, otherDays,
    canWrite: canWrite(ctx.role, "production"), canCheckIn: ["org_admin", "producer", "production_manager", "department_head"].includes(ctx.role),
  };
  // Full typed conflicts (with entity links) for the panel.
  const { shootDayConflicts } = await import("@/server/services/conflicts");
  data.conflicts = await shootDayConflicts(ctx, day.id);
  const fixed = { productionId: day.productionId, shootDayId: day.id };
  return (
    <>
      <PageHeader eyebrow={<><Link href="/schedule">Schedule</Link> / <Link href={`/productions/${prod.id}?tab=schedule`}>{prod.title}</Link> / {date(day.date)}</>} title="Shoot-Day Command"
        actions={<>{otherDays.filter((d) => d.date < day.date).slice(-1).map((d) => <Link key={d.id} className="btn" href={`/schedule/day/${d.id}`}>← {date(d.date, { short: true })}</Link>)}
          {otherDays.filter((d) => d.date > day.date).slice(0, 1).map((d) => <Link key={d.id} className="btn" href={`/schedule/day/${d.id}`}>{date(d.date, { short: true })} →</Link>)}
          <Link className="btn" href={`/data/shoot_days/${day.id}`}>Edit day details</Link></>} />
      <DayCommand data={data} logistics={<div className="stack">
        <EntityView ctx={ctx} entity="transport_bookings" sp={{}} fixed={fixed} title="Transport" />
        <EntityView ctx={ctx} entity="catering_orders" sp={{}} fixed={fixed} title="Catering" />
      </div>} />
    </>
  );
}
