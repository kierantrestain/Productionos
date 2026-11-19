import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import {
  callSheets, cateringOrders, dayCalls, locations, outboundMessages, people, productions, resources,
  sceneResources, scenePeople, scenes, scheduleBlocks, shootDays, transportBookings, episodes,
} from "@/db/schema";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { sha256 } from "../auth/password";
import { productionAllowed } from "../entities/crud";
import { invalid, notFound } from "../errors";
import { requireWrite } from "./guards";
import { shootDayConflicts } from "./conflicts";
import { DEFAULT_CONTACT_POLICY } from "@/lib/customise";

export interface CallSheetSnapshot {
  schema: 1;
  production: { id: string; title: string; kind: string; code: string | null };
  day: { id: string; date: string; dayNumber: number | null; unit: string; generalCall: string | null; estWrap: string | null; weatherNote: string | null; sunrise: string | null; sunset: string | null; safetyNotes: string | null; notes: string | null; unitBaseNotes: string | null };
  base: LocationInfo | null;
  locations: LocationInfo[];
  schedule: { kind: string; start: string | null; end: string | null; sceneNumber: string | null; title: string; episode: string | null; intExt: string | null; dayNight: string | null; location: string | null; cast: string[]; requirements: string[]; notes: string | null }[];
  calls: { group: "cast" | "crew" | "guests"; name: string; role: string | null; call: string | null; onSet: string | null; pickup: string | null }[];
  transport: { kind: string; pickup: string | null; from: string | null; to: string | null; driver: string | null; passengers: string | null }[];
  catering: { meal: string; time: string | null; headcount: number | null; dietary: string | null }[];
  contactPolicy: string;
  openIssues: { severity: string; message: string }[];
}
type LocationInfo = { name: string; address: string | null; postcode: string | null; what3words: string | null; parking: string | null; access: string | null; hospital: string | null };

const t5 = (t: string | null) => (t ? t.slice(0, 5) : null);
const loc = (l: typeof locations.$inferSelect): LocationInfo => ({ name: l.name, address: l.address, postcode: l.postcode, what3words: l.what3words, parking: l.parking, access: l.accessNotes, hospital: l.nearestHospital });

async function loadDayFor(ctx: Ctx, shootDayId: string, tx: DbOrTx = db) {
  const [d] = await tx.select().from(shootDays).where(and(eq(shootDays.id, shootDayId), eq(shootDays.orgId, ctx.orgId), isNull(shootDays.archivedAt))).limit(1);
  if (!d || !productionAllowed(ctx, d.productionId)) throw notFound("Shoot day not found.");
  return d;
}

/** Build the live call-sheet snapshot from the current plan. Personal contact details are never included. */
export async function buildSnapshot(ctx: Ctx, shootDayId: string, tx: DbOrTx = db): Promise<CallSheetSnapshot> {
  const day = await loadDayFor(ctx, shootDayId, tx);
  const [prod] = await tx.select().from(productions).where(eq(productions.id, day.productionId));
  const blocks = await tx.select({ b: scheduleBlocks, s: scenes, ep: episodes }).from(scheduleBlocks)
    .leftJoin(scenes, eq(scenes.id, scheduleBlocks.sceneId)).leftJoin(episodes, eq(episodes.id, scenes.episodeId))
    .where(and(eq(scheduleBlocks.shootDayId, day.id), isNull(scheduleBlocks.archivedAt))).orderBy(asc(scheduleBlocks.sortOrder));
  const sceneIds = blocks.map((b) => b.s?.id).filter(Boolean) as string[];
  const [castLinks, resLinks] = sceneIds.length ? await Promise.all([
    tx.select({ sceneId: scenePeople.sceneId, name: people.fullName, role: scenePeople.roleType, character: scenePeople.characterName }).from(scenePeople).innerJoin(people, eq(people.id, scenePeople.personId)).where(inArray(scenePeople.sceneId, sceneIds)),
    tx.select({ sceneId: sceneResources.sceneId, name: resources.name, kind: resources.kind, qty: sceneResources.quantity }).from(sceneResources).innerJoin(resources, eq(resources.id, sceneResources.resourceId)).where(inArray(sceneResources.sceneId, sceneIds)),
  ]) : [[], []];
  const locIds = new Set<string>();
  for (const b of blocks) { const l = b.b.locationId ?? b.s?.locationId; if (l) locIds.add(l); }
  if (day.baseLocationId) locIds.add(day.baseLocationId);
  const locRows = locIds.size ? await tx.select().from(locations).where(inArray(locations.id, [...locIds])) : [];
  const locMap = new Map(locRows.map((l) => [l.id, l]));
  const calls = await tx.select({ c: dayCalls, name: people.fullName }).from(dayCalls).innerJoin(people, eq(people.id, dayCalls.personId))
    .where(and(eq(dayCalls.shootDayId, day.id), isNull(dayCalls.archivedAt))).orderBy(asc(dayCalls.callTime), asc(people.fullName));
  const transport = await tx.select().from(transportBookings).where(and(eq(transportBookings.shootDayId, day.id), isNull(transportBookings.archivedAt))).orderBy(asc(transportBookings.pickupTime));
  const catering = await tx.select().from(cateringOrders).where(and(eq(cateringOrders.shootDayId, day.id), isNull(cateringOrders.archivedAt))).orderBy(asc(cateringOrders.serveTime));
  const conflicts = await shootDayConflicts(ctx, day.id);

  return {
    schema: 1,
    production: { id: prod.id, title: prod.title, kind: prod.kind, code: prod.code },
    day: { id: day.id, date: day.date, dayNumber: day.dayNumber, unit: day.unit, generalCall: t5(day.generalCall), estWrap: t5(day.estWrap), weatherNote: day.weatherNote, sunrise: day.sunrise, sunset: day.sunset, safetyNotes: day.safetyNotes, notes: day.notes, unitBaseNotes: day.unitBaseNotes },
    base: day.baseLocationId && locMap.get(day.baseLocationId) ? loc(locMap.get(day.baseLocationId)!) : null,
    locations: locRows.map(loc),
    schedule: blocks.map((b) => {
      const l = b.b.locationId ?? b.s?.locationId;
      return {
        kind: b.b.kind, start: t5(b.b.startTime), end: t5(b.b.endTime), sceneNumber: b.s?.number ?? null, title: b.s?.title ?? b.b.label ?? b.b.kind,
        episode: b.ep ? (b.ep.number != null ? `Ep ${b.ep.number}` : b.ep.title) : null, intExt: b.s?.intExt ?? null, dayNight: b.s?.dayNight ?? null,
        location: l ? locMap.get(l)?.name ?? null : null,
        cast: castLinks.filter((c) => c.sceneId === b.s?.id && c.role !== "crew").map((c) => c.character ? `${c.name} (${c.character})` : c.name),
        requirements: resLinks.filter((r) => r.sceneId === b.s?.id).map((r) => `${r.kind}: ${r.name}${r.qty > 1 ? ` ×${r.qty}` : ""}`),
        notes: b.b.notes ?? b.s?.specialRequirements ?? null,
      };
    }),
    calls: calls.map(({ c, name }) => ({
      group: c.roleType === "crew" ? "crew" as const : ["cast", "presenter", "host", "panellist"].includes(c.roleType) ? "cast" as const : "guests" as const,
      name, role: c.roleTitle, call: t5(c.callTime), onSet: t5(c.onSetTime), pickup: t5(c.pickupTime),
    })),
    transport: transport.map((t) => ({ kind: t.kind, pickup: t5(t.pickupTime), from: t.pickupLocation, to: t.dropoffLocation, driver: t.driver, passengers: t.passengers })),
    catering: catering.map((c) => ({ meal: c.meal, time: t5(c.serveTime), headcount: c.headcount, dietary: c.dietaryNotes })),
    contactPolicy: ctx.settings?.callSheetContactPolicy?.trim() || DEFAULT_CONTACT_POLICY,
    openIssues: conflicts.map((c) => ({ severity: c.severity, message: c.message })),
  };
}

function stableHash(o: unknown) { return sha256(JSON.stringify(o)); }

/**
 * Issue a new immutable call-sheet version. The previous issued version is marked superseded but
 * its snapshot is preserved byte-for-byte (enforced by a database trigger).
 */
export async function issueCallSheet(ctx: Ctx, shootDayId: string, notes?: string | null, opts: { allowWithErrors?: boolean } = {}) {
  requireWrite(ctx, "production");
  return db.transaction(async (tx) => {
    const day = await loadDayFor(ctx, shootDayId, tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"callsheet:" + day.id}))`);
    const snapshot = await buildSnapshot(ctx, day.id, tx);
    if (!snapshot.schedule.length) throw invalid("Add at least one scheduled block before issuing a call sheet.");
    const errors = snapshot.openIssues.filter((i) => i.severity === "error");
    if (errors.length && !opts.allowWithErrors) throw invalid(`Resolve ${errors.length} blocking conflict(s) first, or issue with acknowledged conflicts.`, { conflicts: errors });
    const [{ m }] = await tx.select({ m: sql<number>`coalesce(max(${callSheets.versionNumber}), 0)::int` }).from(callSheets).where(eq(callSheets.shootDayId, day.id));
    await tx.update(callSheets).set({ status: "superseded", updatedAt: new Date() }).where(and(eq(callSheets.shootDayId, day.id), eq(callSheets.status, "issued")));
    const [row] = await tx.insert(callSheets).values({
      orgId: ctx.orgId, createdBy: ctx.userId, productionId: day.productionId, shootDayId: day.id, versionNumber: m + 1, status: "issued",
      snapshot, snapshotHash: stableHash(snapshot), issuedAt: new Date(), issuedBy: ctx.userId, notes: notes || (errors.length ? `Issued with ${errors.length} acknowledged conflict(s)` : null),
    }).returning();
    await audit(tx, ctx, "issue_call_sheet", "shoot_days", day.id, { productionId: day.productionId, meta: { callSheetId: row.id, version: row.versionNumber, hash: row.snapshotHash } });
    return row;
  });
}

export async function listCallSheets(ctx: Ctx, shootDayId: string) {
  const day = await loadDayFor(ctx, shootDayId);
  return db.select({ id: callSheets.id, versionNumber: callSheets.versionNumber, status: callSheets.status, issuedAt: callSheets.issuedAt, snapshotHash: callSheets.snapshotHash, notes: callSheets.notes })
    .from(callSheets).where(eq(callSheets.shootDayId, day.id)).orderBy(desc(callSheets.versionNumber));
}

/**
 * Fetch an issued call sheet. Cast and crew may only open issued sheets for days they are called on.
 */
export async function getCallSheet(ctx: Ctx, callSheetId: string) {
  const [cs] = await db.select().from(callSheets).where(and(eq(callSheets.id, callSheetId), eq(callSheets.orgId, ctx.orgId))).limit(1);
  if (!cs) throw notFound();
  if (ctx.role === "cast" || ctx.role === "crew") {
    if (!ctx.personId || cs.status === "draft") throw notFound();
    const [c] = await db.select({ id: dayCalls.id }).from(dayCalls).where(and(eq(dayCalls.shootDayId, cs.shootDayId), eq(dayCalls.personId, ctx.personId))).limit(1);
    if (!c) throw notFound();
  } else if (!productionAllowed(ctx, cs.productionId) || !["org_admin", "executive", "producer", "production_manager", "department_head", "post", "finance_legal"].includes(ctx.role)) {
    throw notFound();
  }
  return { ...cs, snapshot: cs.snapshot as CallSheetSnapshot };
}

/**
 * Prepare (never send) distribution drafts for an issued call sheet. Each recipient message waits
 * for explicit confirmation in the outbox review screen.
 */
export async function prepareDistribution(ctx: Ctx, callSheetId: string) {
  requireWrite(ctx, "production");
  const cs = await getCallSheet(ctx, callSheetId);
  if (cs.status !== "issued") throw invalid("Only the current issued version can be distributed.");
  return db.transaction(async (tx) => {
    const recipients = await tx.select({ personId: dayCalls.personId, name: people.fullName, email: people.email, call: dayCalls.callTime })
      .from(dayCalls).innerJoin(people, eq(people.id, dayCalls.personId)).where(eq(dayCalls.shootDayId, cs.shootDayId));
    let created = 0, missingEmail = 0;
    const snap = cs.snapshot;
    for (const r of recipients) {
      if (!r.email) { missingEmail++; continue; }
      const ins = await tx.insert(outboundMessages).values({
        orgId: ctx.orgId, createdBy: ctx.userId, productionId: cs.productionId, template: "call_sheet", subjectType: "call_sheets", subjectId: cs.id,
        toPersonId: r.personId, toAddress: r.email, subject: `Call sheet v${cs.versionNumber} — ${snap.production.title} — ${snap.day.date}`,
        body: `Hi ${r.name},\n\nYour call time on ${snap.day.date} is ${t5(r.call) ?? snap.day.generalCall ?? "TBC"}.\nUnit base: ${snap.base?.name ?? "see call sheet"}${snap.base?.postcode ? ` (${snap.base.postcode})` : ""}.\n\nThe full call sheet (version ${cs.versionNumber}) is available in Production OS.\n\n${snap.contactPolicy}`,
        status: "awaiting_confirmation", idempotencyKey: `call_sheet:${cs.id}:${r.personId}`,
      }).onConflictDoNothing().returning();
      if (ins[0]) created++;
    }
    await audit(tx, ctx, "prepare_distribution", "call_sheets", cs.id, { productionId: cs.productionId, meta: { created, missingEmail } });
    return { created, missingEmail, total: recipients.length };
  });
}
