import { and, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  availabilityBlocks, dayCalls, engagements, locationBookings, locations, people, productions, releaseForms, resourceBookings,
  resources, scenePeople, sceneResources, scenes, scheduleBlocks, shootDays,
} from "@/db/schema";
import type { Ctx } from "../auth/context";
import { productionAllowed } from "../entities/crud";
import { notFound } from "../errors";

export type ConflictSeverity = "error" | "warning";
export interface Conflict {
  type: "time_overlap" | "person_double_booked" | "person_unavailable" | "resource_overcommitted" | "resource_unavailable"
    | "location_clash" | "location_unconfirmed" | "contract_unsigned" | "release_missing" | "not_on_call_sheet";
  severity: ConflictSeverity;
  message: string;
  entityType?: string;
  entityId?: string;
}

const RELEASE_ROLES = new Set(["cast", "guest", "contestant", "panellist", "host", "contributor"]);
const toMin = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);

/**
 * Computes every scheduling conflict for one shoot day. Looks across all productions in the
 * organisation (a person or kit item can only be in one place), but never reveals the name of a
 * production the caller cannot access.
 */
export async function shootDayConflicts(ctx: Ctx, shootDayId: string): Promise<Conflict[]> {
  const [day] = await db.select().from(shootDays).where(and(eq(shootDays.id, shootDayId), eq(shootDays.orgId, ctx.orgId), isNull(shootDays.archivedAt))).limit(1);
  if (!day || !productionAllowed(ctx, day.productionId)) throw notFound("Shoot day not found.");
  const out: Conflict[] = [];

  // Other live shoot days on the same date (any production in the org).
  const sameDate = await db.select({ id: shootDays.id, productionId: shootDays.productionId, unit: shootDays.unit, title: productions.title })
    .from(shootDays).innerJoin(productions, eq(productions.id, shootDays.productionId))
    .where(and(eq(shootDays.orgId, ctx.orgId), eq(shootDays.date, day.date), isNull(shootDays.archivedAt), ne(shootDays.status, "cancelled")));
  const dayLabel = new Map(sameDate.map((d) => [d.id, productionAllowed(ctx, d.productionId) ? `${d.title} (${d.unit})` : "another production"]));
  const dayIds = sameDate.map((d) => d.id);

  // 1. Time overlaps within the day.
  const blocks = await db.select({ b: scheduleBlocks, s: scenes }).from(scheduleBlocks).leftJoin(scenes, eq(scenes.id, scheduleBlocks.sceneId))
    .where(and(eq(scheduleBlocks.shootDayId, day.id), isNull(scheduleBlocks.archivedAt))).orderBy(scheduleBlocks.sortOrder);
  const timed = blocks.filter((x) => x.b.startTime && x.b.endTime).sort((a, b) => toMin(a.b.startTime)! - toMin(b.b.startTime)!);
  for (let i = 1; i < timed.length; i++) {
    const prev = timed[i - 1], cur = timed[i];
    if (toMin(cur.b.startTime)! < toMin(prev.b.endTime)!) {
      out.push({ type: "time_overlap", severity: "error", entityType: "schedule_blocks", entityId: cur.b.id,
        message: `${label(cur)} (${cur.b.startTime!.slice(0, 5)}) starts before ${label(prev)} ends (${prev.b.endTime!.slice(0, 5)}).` });
    }
  }

  // 2/3/7/8/9. People: who is needed on this date, anywhere in the org.
  const callRows = dayIds.length ? await db.select({ personId: dayCalls.personId, dayId: dayCalls.shootDayId }).from(dayCalls)
    .where(and(inArray(dayCalls.shootDayId, dayIds), isNull(dayCalls.archivedAt))) : [];
  const sceneRows = dayIds.length ? await db.select({ personId: scenePeople.personId, dayId: scheduleBlocks.shootDayId, roleType: scenePeople.roleType, sceneId: scenePeople.sceneId })
    .from(scheduleBlocks).innerJoin(scenePeople, eq(scenePeople.sceneId, scheduleBlocks.sceneId))
    .where(and(inArray(scheduleBlocks.shootDayId, dayIds), isNull(scheduleBlocks.archivedAt))) : [];
  const personDays = new Map<string, Set<string>>();
  for (const r of [...callRows, ...sceneRows]) {
    if (!personDays.has(r.personId)) personDays.set(r.personId, new Set());
    personDays.get(r.personId)!.add(r.dayId);
  }
  const onThisDay = new Set([...personDays].filter(([, ds]) => ds.has(day.id)).map(([p]) => p));
  const peopleRows = onThisDay.size ? await db.select({ id: people.id, name: people.fullName }).from(people).where(inArray(people.id, [...onThisDay])) : [];
  const pname = new Map(peopleRows.map((p) => [p.id, p.name]));

  for (const pid of onThisDay) {
    const others = [...personDays.get(pid)!].filter((d) => d !== day.id);
    if (others.length) out.push({ type: "person_double_booked", severity: "error", entityType: "people", entityId: pid,
      message: `${pname.get(pid)} is also scheduled on ${others.map((o) => dayLabel.get(o)).join(", ")} on ${day.date}.` });
  }
  if (onThisDay.size) {
    const unavailable = await db.select().from(availabilityBlocks).where(and(eq(availabilityBlocks.orgId, ctx.orgId), inArray(availabilityBlocks.personId, [...onThisDay]),
      lte(availabilityBlocks.startDate, day.date), gte(availabilityBlocks.endDate, day.date), eq(availabilityBlocks.kind, "unavailable"), isNull(availabilityBlocks.archivedAt)));
    for (const u of unavailable) out.push({ type: "person_unavailable", severity: "error", entityType: "people", entityId: u.personId,
      message: `${pname.get(u.personId)} is marked unavailable (${u.startDate} → ${u.endDate})${u.note ? `: ${u.note}` : ""}.` });

    const engs = await db.select().from(engagements).where(and(eq(engagements.productionId, day.productionId), inArray(engagements.personId, [...onThisDay]), isNull(engagements.archivedAt)));
    for (const e of engs) {
      if ((e.kind === "cast" || e.kind === "crew" || e.kind === "presenter") && e.contractStatus !== "signed" && e.status !== "cancelled") {
        out.push({ type: "contract_unsigned", severity: "warning", entityType: "engagements", entityId: e.id,
          message: `${pname.get(e.personId)} (${e.roleTitle ?? e.kind}) has no signed contract (status: ${e.contractStatus}).` });
      }
    }
    const needRelease = [...new Set(sceneRows.filter((r) => r.dayId === day.id && RELEASE_ROLES.has(r.roleType)).map((r) => r.personId))];
    if (needRelease.length) {
      const signed = await db.select({ personId: releaseForms.personId }).from(releaseForms)
        .where(and(eq(releaseForms.productionId, day.productionId), inArray(releaseForms.personId, needRelease), eq(releaseForms.status, "signed"), isNull(releaseForms.archivedAt)));
      const ok = new Set(signed.map((s) => s.personId));
      for (const pid of needRelease) if (!ok.has(pid)) out.push({ type: "release_missing", severity: "warning", entityType: "people", entityId: pid, message: `${pname.get(pid)} has no signed release form for this production.` });
    }
    const called = new Set(callRows.filter((r) => r.dayId === day.id).map((r) => r.personId));
    for (const pid of new Set(sceneRows.filter((r) => r.dayId === day.id).map((r) => r.personId))) {
      if (!called.has(pid)) out.push({ type: "not_on_call_sheet", severity: "warning", entityType: "people", entityId: pid, message: `${pname.get(pid)} is in a scheduled scene but has no call time.` });
    }
  }

  // 4/5. Resources: demand on this date across the org vs. quantity owned.
  // Peak (not summed) demand per day: one kit item serves consecutive scenes; two units on one date both need it.
  const sceneDemand = dayIds.length ? await db.select({ resourceId: sceneResources.resourceId, dayId: scheduleBlocks.shootDayId, qty: sql<number>`max(${sceneResources.quantity})::int` })
    .from(scheduleBlocks).innerJoin(sceneResources, eq(sceneResources.sceneId, scheduleBlocks.sceneId))
    .where(and(inArray(scheduleBlocks.shootDayId, dayIds), isNull(scheduleBlocks.archivedAt)))
    .groupBy(sceneResources.resourceId, scheduleBlocks.shootDayId) : [];
  const bookings = await db.select().from(resourceBookings).where(and(eq(resourceBookings.orgId, ctx.orgId), lte(resourceBookings.startDate, day.date), gte(resourceBookings.endDate, day.date), ne(resourceBookings.status, "released"), isNull(resourceBookings.archivedAt)));
  const demand = new Map<string, Map<string, number>>(); // resource -> demandKey -> qty
  const add = (rid: string, key: string, q: number) => {
    if (!demand.has(rid)) demand.set(rid, new Map());
    const m = demand.get(rid)!; m.set(key, Math.max(m.get(key) ?? 0, q));
  };
  for (const r of sceneDemand) add(r.resourceId, `day:${r.dayId}`, r.qty);
  for (const b of bookings) add(b.resourceId, b.shootDayId ? `day:${b.shootDayId}` : `booking:${b.id}:${b.productionId}`, b.quantity);
  const thisDayResources = [...demand].filter(([, m]) => m.has(`day:${day.id}`)).map(([rid]) => rid);
  if (thisDayResources.length) {
    const rs = await db.select().from(resources).where(inArray(resources.id, thisDayResources));
    for (const r of rs) {
      const m = demand.get(r.id)!;
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      if (total > r.quantity) {
        const elsewhere = [...m.keys()].filter((k) => k !== `day:${day.id}`).map((k) => k.startsWith("day:") ? dayLabel.get(k.slice(4)) ?? "another booking" : "a dated booking");
        out.push({ type: "resource_overcommitted", severity: "error", entityType: "resources", entityId: r.id,
          message: `${r.name}: ${total} needed on ${day.date} but only ${r.quantity} available${elsewhere.length ? ` (also required by ${[...new Set(elsewhere)].join(", ")})` : ""}.` });
      }
      if (["maintenance", "lost", "retired"].includes(r.status)) out.push({ type: "resource_unavailable", severity: "error", entityType: "resources", entityId: r.id, message: `${r.name} is ${r.status}.` });
    }
  }

  // 6/7. Locations.
  const locIds = new Set<string>();
  for (const x of blocks) { const l = x.b.locationId ?? x.s?.locationId; if (l) locIds.add(l); }
  if (day.baseLocationId) locIds.add(day.baseLocationId);
  if (locIds.size) {
    const locs = await db.select().from(locations).where(inArray(locations.id, [...locIds]));
    for (const l of locs) if (!["confirmed", "cleared"].includes(l.status)) out.push({ type: "location_unconfirmed", severity: "warning", entityType: "locations", entityId: l.id, message: `${l.name} is not confirmed (status: ${l.status}).` });
    const otherDays = dayIds.filter((d) => d !== day.id);
    if (otherDays.length) {
      const otherUse = await db.select({ dayId: scheduleBlocks.shootDayId, loc: sql<string>`coalesce(${scheduleBlocks.locationId}, ${scenes.locationId})` })
        .from(scheduleBlocks).leftJoin(scenes, eq(scenes.id, scheduleBlocks.sceneId))
        .where(and(inArray(scheduleBlocks.shootDayId, otherDays), isNull(scheduleBlocks.archivedAt)));
      const otherBase = sameDate.filter((d) => d.id !== day.id);
      const baseRows = otherBase.length ? await db.select({ id: shootDays.id, loc: shootDays.baseLocationId }).from(shootDays).where(inArray(shootDays.id, otherBase.map((d) => d.id))) : [];
      for (const l of locs) {
        if (l.allowsSharedUse) continue;
        const users = new Set([...otherUse.filter((u) => u.loc === l.id).map((u) => u.dayId), ...baseRows.filter((b) => b.loc === l.id).map((b) => b.id)]);
        // Any other unit (same or different production) using a non-shared location on this date is a clash.
        if (users.size) out.push({ type: "location_clash", severity: "error", entityType: "locations", entityId: l.id, message: `${l.name} is also in use by ${[...users].map((d) => dayLabel.get(d)).join(", ")} on ${day.date}.` });
      }
    }
  }
  // Location / studio bookings held by other productions on this date.
  if (locIds.size) {
    const books = await db.select({ b: locationBookings, title: productions.title, loc: locations }).from(locationBookings)
      .innerJoin(productions, eq(productions.id, locationBookings.productionId)).innerJoin(locations, eq(locations.id, locationBookings.locationId))
      .where(and(eq(locationBookings.orgId, ctx.orgId), inArray(locationBookings.locationId, [...locIds]), ne(locationBookings.productionId, day.productionId), ne(locationBookings.status, "released"),
        lte(locationBookings.startDate, day.date), gte(locationBookings.endDate, day.date), isNull(locationBookings.archivedAt)));
    for (const x of books) {
      if (x.loc.allowsSharedUse) continue;
      out.push({ type: "location_clash", severity: x.b.status === "confirmed" ? "error" : "warning", entityType: "locations", entityId: x.loc.id,
        message: `${x.loc.name} is ${x.b.status === "confirmed" ? "booked" : "on hold"} for ${productionAllowed(ctx, x.b.productionId) ? x.title : "another production"} (${x.b.startDate} → ${x.b.endDate}).` });
    }
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

function label(x: { b: { kind: string; label: string | null }; s: { number: string; title: string } | null }) {
  return x.s ? `Sc ${x.s.number}` : x.b.label ?? x.b.kind;
}

/** Conflict counts for many days (dashboards, calendars). */
export async function conflictSummary(ctx: Ctx, dayIds: string[]) {
  const res: Record<string, { errors: number; warnings: number }> = {};
  for (const id of dayIds) {
    try {
      const c = await shootDayConflicts(ctx, id);
      res[id] = { errors: c.filter((x) => x.severity === "error").length, warnings: c.filter((x) => x.severity === "warning").length };
    } catch { /* not visible */ }
  }
  return res;
}
