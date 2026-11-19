import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { callSheets, dayCalls, locations, productions, shootDays } from "@/db/schema";
import { requirePageContext } from "@/server/auth/request";
import { Empty, PageHeader } from "@/components/ui";
import { date, time } from "@/lib/format";

export const metadata = { title: "My schedule" };

/** Personal view for cast and crew: only their own calls and issued call sheets. No finance, no other people's details. */
export default async function MySchedulePage() {
  const ctx = await requirePageContext();
  if (!ctx.personId) return <><PageHeader title="My schedule" /><Empty title="Your account isn’t linked to a person record">Ask the production office to link your login to your cast/crew profile.</Empty></>;
  const today = new Date().toISOString().slice(0, 10);
  const calls = await db.select({ c: dayCalls, d: shootDays, p: productions.title, base: locations }).from(dayCalls)
    .innerJoin(shootDays, eq(shootDays.id, dayCalls.shootDayId)).innerJoin(productions, eq(productions.id, shootDays.productionId)).leftJoin(locations, eq(locations.id, shootDays.baseLocationId))
    .where(and(eq(dayCalls.personId, ctx.personId), eq(dayCalls.orgId, ctx.orgId), isNull(dayCalls.archivedAt), isNull(shootDays.archivedAt), gte(shootDays.date, today))).orderBy(asc(shootDays.date));
  const sheets = calls.length ? await db.select({ id: callSheets.id, dayId: callSheets.shootDayId, v: callSheets.versionNumber }).from(callSheets).where(and(inArray(callSheets.shootDayId, calls.map((c) => c.d.id)), eq(callSheets.status, "issued"))).orderBy(desc(callSheets.versionNumber)) : [];
  return (
    <>
      <PageHeader title="My schedule" lede={`Hello ${ctx.name}. Your upcoming calls and the latest issued call sheets.`} />
      {calls.length === 0 ? <Empty title="No upcoming calls">You’ll see your call times here once the production office schedules you.</Empty> : (
        <div className="stack">{calls.map(({ c, d, p, base }) => {
          const sheet = sheets.find((s) => s.dayId === d.id);
          return (
            <section key={c.id} className="panel"><div className="panel-body" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
              <div>
                <div className="subtle" style={{ fontSize: 12 }}>{p} · {d.unit}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{date(d.date, { weekday: true })}</div>
                <div className="muted">{c.roleTitle ?? ""}</div>
                {base && <div style={{ marginTop: 6, fontSize: 13 }}><strong>{base.name}</strong>{base.address ? ` — ${base.address}` : ""}{base.postcode ? ` ${base.postcode}` : ""}{base.parking ? <div className="subtle">Parking: {base.parking}</div> : null}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="subtle" style={{ fontSize: 11, textTransform: "uppercase" }}>Your call</div>
                <div className="mono" style={{ fontSize: 30, fontWeight: 700 }}>{time(c.callTime ?? d.generalCall)}</div>
                {c.pickupTime && <div className="subtle">Pickup {time(c.pickupTime)}</div>}
                {sheet ? <Link className="btn btn-primary" style={{ marginTop: 8 }} href={`/callsheets/${sheet.id}`}>Call sheet v{sheet.v}</Link> : <div className="subtle" style={{ fontSize: 12, marginTop: 8 }}>Call sheet not yet issued</div>}
              </div>
            </div></section>);
        })}</div>
      )}
    </>
  );
}
