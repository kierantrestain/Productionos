/**
 * Production operations: scene links, shot lists, scheduling, day calls and the shoot → post handover.
 * Every mutation is permission-checked, production-scoped, transactional and audited.
 */
import { and, asc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import {
  dayCalls, editVersions, people, postTasks, resources, scenePeople, sceneResources, scenes, scheduleBlocks, shootDays, shots,
} from "@/db/schema";
import type { Ctx } from "../auth/context";
import { audit, emit } from "../audit";
import { productionAllowed } from "../entities/crud";
import { invalid, notFound } from "../errors";
import { requireWrite } from "./guards";

async function loadScene(ctx: Ctx, sceneId: string, tx: DbOrTx = db) {
  const [s] = await tx.select().from(scenes).where(and(eq(scenes.id, sceneId), eq(scenes.orgId, ctx.orgId), isNull(scenes.archivedAt))).limit(1);
  if (!s || !productionAllowed(ctx, s.productionId)) throw notFound("Scene not found.");
  return s;
}
async function loadDay(ctx: Ctx, dayId: string, tx: DbOrTx = db) {
  const [d] = await tx.select().from(shootDays).where(and(eq(shootDays.id, dayId), eq(shootDays.orgId, ctx.orgId), isNull(shootDays.archivedAt))).limit(1);
  if (!d || !productionAllowed(ctx, d.productionId)) throw notFound("Shoot day not found.");
  return d;
}
async function assertPerson(ctx: Ctx, personId: string, tx: DbOrTx) {
  const [p] = await tx.select({ id: people.id }).from(people).where(and(eq(people.id, personId), eq(people.orgId, ctx.orgId))).limit(1);
  if (!p) throw invalid("Person not found in this organisation.");
}

// ───────────── Scene links ─────────────

export async function linkScenePerson(ctx: Ctx, sceneId: string, personId: string, roleType: string, characterName?: string | null) {
  requireWrite(ctx, "production");
  if (!["cast", "crew", "guest", "contestant", "panellist", "host", "contributor"].includes(roleType)) throw invalid("Unknown role type.");
  return db.transaction(async (tx) => {
    const s = await loadScene(ctx, sceneId, tx);
    await assertPerson(ctx, personId, tx);
    const [row] = await tx.insert(scenePeople).values({ orgId: ctx.orgId, sceneId, personId, roleType, characterName: characterName || null })
      .onConflictDoUpdate({ target: [scenePeople.sceneId, scenePeople.personId, scenePeople.roleType], set: { characterName: characterName || null } }).returning();
    await audit(tx, ctx, "link_person", "scenes", sceneId, { productionId: s.productionId, after: { personId, roleType, characterName } });
    return row;
  });
}

export async function unlinkScenePerson(ctx: Ctx, linkId: string) {
  requireWrite(ctx, "production");
  await db.transaction(async (tx) => {
    const [l] = await tx.select().from(scenePeople).where(and(eq(scenePeople.id, linkId), eq(scenePeople.orgId, ctx.orgId))).limit(1);
    if (!l) throw notFound();
    const s = await loadScene(ctx, l.sceneId, tx);
    await tx.delete(scenePeople).where(eq(scenePeople.id, linkId));
    await audit(tx, ctx, "unlink_person", "scenes", s.id, { productionId: s.productionId, before: { personId: l.personId, roleType: l.roleType } });
  });
}

export async function linkSceneResource(ctx: Ctx, sceneId: string, resourceId: string, quantity = 1, notes?: string | null) {
  requireWrite(ctx, "production", "scene_resources");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) throw invalid("Quantity must be a positive whole number.");
  return db.transaction(async (tx) => {
    const s = await loadScene(ctx, sceneId, tx);
    const [r] = await tx.select().from(resources).where(and(eq(resources.id, resourceId), eq(resources.orgId, ctx.orgId))).limit(1);
    if (!r || (r.productionId && r.productionId !== s.productionId)) throw invalid("Resource not available to this production.");
    const [row] = await tx.insert(sceneResources).values({ orgId: ctx.orgId, sceneId, resourceId, quantity, notes: notes || null })
      .onConflictDoUpdate({ target: [sceneResources.sceneId, sceneResources.resourceId], set: { quantity, notes: notes || null } }).returning();
    await audit(tx, ctx, "link_resource", "scenes", sceneId, { productionId: s.productionId, after: { resourceId, quantity } });
    return row;
  });
}

export async function unlinkSceneResource(ctx: Ctx, linkId: string) {
  requireWrite(ctx, "production", "scene_resources");
  await db.transaction(async (tx) => {
    const [l] = await tx.select().from(sceneResources).where(and(eq(sceneResources.id, linkId), eq(sceneResources.orgId, ctx.orgId))).limit(1);
    if (!l) throw notFound();
    const s = await loadScene(ctx, l.sceneId, tx);
    await tx.delete(sceneResources).where(eq(sceneResources.id, linkId));
    await audit(tx, ctx, "unlink_resource", "scenes", s.id, { productionId: s.productionId, before: { resourceId: l.resourceId } });
  });
}

export async function sceneLinks(ctx: Ctx, sceneId: string) {
  await loadScene(ctx, sceneId);
  const [ppl, res] = await Promise.all([
    db.select({ id: scenePeople.id, personId: scenePeople.personId, roleType: scenePeople.roleType, characterName: scenePeople.characterName, name: people.fullName })
      .from(scenePeople).innerJoin(people, eq(people.id, scenePeople.personId)).where(eq(scenePeople.sceneId, sceneId)).orderBy(asc(scenePeople.roleType), asc(people.fullName)),
    db.select({ id: sceneResources.id, resourceId: sceneResources.resourceId, quantity: sceneResources.quantity, notes: sceneResources.notes, name: resources.name, kind: resources.kind, status: resources.status })
      .from(sceneResources).innerJoin(resources, eq(resources.id, sceneResources.resourceId)).where(eq(sceneResources.sceneId, sceneId)).orderBy(asc(resources.kind), asc(resources.name)),
  ]);
  return { people: ppl, resources: res };
}

// ───────────── Shots ─────────────

export async function nextShotNumber(tx: DbOrTx, sceneId: string) {
  const rows = await tx.select({ number: shots.number }).from(shots).where(and(eq(shots.sceneId, sceneId), isNull(shots.archivedAt)));
  const nums = rows.map((r) => parseInt(r.number, 10)).filter((n) => !Number.isNaN(n));
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}

export async function reorderShots(ctx: Ctx, sceneId: string, orderedIds: string[]) {
  requireWrite(ctx, "production", "shots");
  await db.transaction(async (tx) => {
    const s = await loadScene(ctx, sceneId, tx);
    const existing = await tx.select({ id: shots.id }).from(shots).where(and(eq(shots.sceneId, sceneId), isNull(shots.archivedAt)));
    const set = new Set(existing.map((e) => e.id));
    if (orderedIds.length !== set.size || orderedIds.some((id) => !set.has(id))) throw invalid("Shot order is out of date. Refresh and try again.");
    for (let i = 0; i < orderedIds.length; i++) await tx.update(shots).set({ sortOrder: (i + 1) * 10, updatedAt: new Date() }).where(eq(shots.id, orderedIds[i]));
    await audit(tx, ctx, "reorder_shots", "scenes", sceneId, { productionId: s.productionId, after: { order: orderedIds } });
  });
}

/** Deliberate duplicate: always gets a new shot number; never touches generation keys. */
export async function duplicateShot(ctx: Ctx, shotId: string) {
  requireWrite(ctx, "production", "shots");
  return db.transaction(async (tx) => {
    const [src] = await tx.select().from(shots).where(and(eq(shots.id, shotId), eq(shots.orgId, ctx.orgId), isNull(shots.archivedAt))).limit(1);
    if (!src || !productionAllowed(ctx, src.productionId)) throw notFound();
    const number = await nextShotNumber(tx, src.sceneId);
    const [row] = await tx.insert(shots).values({
      orgId: ctx.orgId, createdBy: ctx.userId, productionId: src.productionId, sceneId: src.sceneId, number, sortOrder: src.sortOrder + 5,
      description: src.description, shotType: src.shotType, framing: src.framing, movement: src.movement, lens: src.lens, camera: src.camera,
      priority: src.priority, estMinutes: src.estMinutes, notes: src.notes, autoGenerated: false, generationKey: null,
    }).returning();
    await audit(tx, ctx, "duplicate", "shots", row.id, { productionId: src.productionId, meta: { from: src.id }, after: row });
    return row;
  });
}

/**
 * Automation action (SAP-SHOT-INIT): create the initial shot for a scene only if the scene has no
 * shots at all. The unique generation key makes concurrent / repeated executions harmless.
 * Returns the created shot or null when skipped.
 */
export async function generateInitialShot(tx: DbOrTx, orgId: string, sceneId: string) {
  const [s] = await tx.select().from(scenes).where(and(eq(scenes.id, sceneId), eq(scenes.orgId, orgId))).limit(1);
  if (!s || s.archivedAt) return { created: null, reason: "scene_missing" as const };
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(shots).where(eq(shots.sceneId, sceneId));
  if (n > 0) return { created: null, reason: "scene_has_shots" as const };
  const inserted = await tx.insert(shots).values({
    orgId, productionId: s.productionId, sceneId, number: "1", sortOrder: 10, autoGenerated: true, generationKey: `auto-initial:${sceneId}`,
    description: `Master — ${s.title}`, shotType: "WS", priority: "must",
  }).onConflictDoNothing({ target: shots.generationKey }).returning();
  return inserted[0] ? { created: inserted[0], reason: "created" as const } : { created: null, reason: "already_generated" as const };
}

// ───────────── Scheduling ─────────────

const addMinutes = (t: string, mins: number) => {
  const total = Math.min(Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export async function addSceneToDay(ctx: Ctx, shootDayId: string, sceneId: string, opts: { startTime?: string; endTime?: string } = {}) {
  requireWrite(ctx, "production");
  return db.transaction(async (tx) => {
    const day = await loadDay(ctx, shootDayId, tx);
    const s = await loadScene(ctx, sceneId, tx);
    if (s.productionId !== day.productionId) throw invalid("That scene belongs to a different production.");
    const existing = await tx.select().from(scheduleBlocks).where(and(eq(scheduleBlocks.shootDayId, day.id), isNull(scheduleBlocks.archivedAt))).orderBy(asc(scheduleBlocks.sortOrder));
    if (existing.some((b) => b.sceneId === sceneId)) throw invalid(`Scene ${s.number} is already on this day.`);
    const lastEnd = [...existing].reverse().find((b) => b.endTime)?.endTime?.slice(0, 5) ?? day.generalCall?.slice(0, 5) ?? "08:00";
    const start = opts.startTime ?? lastEnd;
    const end = opts.endTime ?? addMinutes(start, s.estDurationMins ?? 60);
    const sortOrder = (existing.at(-1)?.sortOrder ?? 0) + 10;
    const [block] = await tx.insert(scheduleBlocks).values({ orgId: ctx.orgId, createdBy: ctx.userId, productionId: day.productionId, shootDayId: day.id, kind: "scene", sceneId, startTime: start, endTime: end, locationId: s.locationId, sortOrder }).returning();
    if (["draft", "ready"].includes(s.status)) await tx.update(scenes).set({ status: "scheduled", updatedAt: new Date(), version: sql`${scenes.version} + 1` }).where(eq(scenes.id, s.id));
    await syncCallsTx(tx, ctx, day);
    await audit(tx, ctx, "schedule_scene", "shoot_days", day.id, { productionId: day.productionId, after: { sceneId, startTime: start, endTime: end } });
    return block;
  });
}

export async function addBlock(ctx: Ctx, shootDayId: string, kind: string, label: string, startTime?: string | null, endTime?: string | null) {
  requireWrite(ctx, "production");
  if (!["travel", "meal", "setup", "company_move", "rehearsal", "other"].includes(kind)) throw invalid("Unknown block type.");
  return db.transaction(async (tx) => {
    const day = await loadDay(ctx, shootDayId, tx);
    const [{ m }] = await tx.select({ m: max(scheduleBlocks.sortOrder) }).from(scheduleBlocks).where(eq(scheduleBlocks.shootDayId, day.id));
    const [block] = await tx.insert(scheduleBlocks).values({ orgId: ctx.orgId, createdBy: ctx.userId, productionId: day.productionId, shootDayId: day.id, kind, label: label || kind, startTime: startTime || null, endTime: endTime || null, sortOrder: (m ?? 0) + 10 }).returning();
    await audit(tx, ctx, "add_block", "shoot_days", day.id, { productionId: day.productionId, after: block });
    return block;
  });
}

export async function updateBlock(ctx: Ctx, blockId: string, patch: { startTime?: string | null; endTime?: string | null; label?: string | null; notes?: string | null; locationId?: string | null }) {
  requireWrite(ctx, "production");
  for (const k of ["startTime", "endTime"] as const) if (patch[k] && !/^\d{2}:\d{2}(:\d{2})?$/.test(patch[k]!)) throw invalid("Times must be HH:MM.");
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(scheduleBlocks).where(and(eq(scheduleBlocks.id, blockId), eq(scheduleBlocks.orgId, ctx.orgId))).limit(1);
    if (!b || !productionAllowed(ctx, b.productionId)) throw notFound();
    const next = { ...patch } as Record<string, unknown>;
    const st = (patch.startTime ?? b.startTime)?.slice(0, 5), et = (patch.endTime ?? b.endTime)?.slice(0, 5);
    if (st && et && et <= st) throw invalid("End time must be after start time.");
    const [row] = await tx.update(scheduleBlocks).set({ ...next, updatedAt: new Date(), version: sql`${scheduleBlocks.version} + 1` }).where(eq(scheduleBlocks.id, blockId)).returning();
    await audit(tx, ctx, "update_block", "shoot_days", b.shootDayId, { productionId: b.productionId, before: b, after: row });
    return row;
  });
}

/** Move a block to another position or another shoot day (drag-and-drop or keyboard). */
export async function moveBlock(ctx: Ctx, blockId: string, target: { shootDayId: string; beforeBlockId?: string | null }) {
  requireWrite(ctx, "production");
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(scheduleBlocks).where(and(eq(scheduleBlocks.id, blockId), eq(scheduleBlocks.orgId, ctx.orgId), isNull(scheduleBlocks.archivedAt))).limit(1);
    if (!b || !productionAllowed(ctx, b.productionId)) throw notFound();
    const day = await loadDay(ctx, target.shootDayId, tx);
    if (day.productionId !== b.productionId) throw invalid("Cannot move a block to another production's day.");
    const siblings = (await tx.select().from(scheduleBlocks).where(and(eq(scheduleBlocks.shootDayId, day.id), isNull(scheduleBlocks.archivedAt), ne(scheduleBlocks.id, b.id))).orderBy(asc(scheduleBlocks.sortOrder)));
    if (b.sceneId && day.id !== b.shootDayId && siblings.some((x) => x.sceneId === b.sceneId)) throw invalid("That scene is already on the target day.");
    const idx = target.beforeBlockId ? siblings.findIndex((x) => x.id === target.beforeBlockId) : -1;
    const ordered = [...siblings];
    ordered.splice(idx < 0 ? ordered.length : idx, 0, b);
    for (let i = 0; i < ordered.length; i++) {
      await tx.update(scheduleBlocks).set({ sortOrder: (i + 1) * 10, shootDayId: day.id, updatedAt: new Date() }).where(eq(scheduleBlocks.id, ordered[i].id));
    }
    if (day.id !== b.shootDayId) {
      await syncCallsTx(tx, ctx, day);
      await audit(tx, ctx, "move_block", "shoot_days", day.id, { productionId: day.productionId, meta: { from: b.shootDayId, blockId } });
    } else {
      await audit(tx, ctx, "reorder_block", "shoot_days", day.id, { productionId: day.productionId, meta: { blockId } });
    }
  });
}

export async function removeBlock(ctx: Ctx, blockId: string) {
  requireWrite(ctx, "production");
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(scheduleBlocks).where(and(eq(scheduleBlocks.id, blockId), eq(scheduleBlocks.orgId, ctx.orgId))).limit(1);
    if (!b || !productionAllowed(ctx, b.productionId)) throw notFound();
    await tx.delete(scheduleBlocks).where(eq(scheduleBlocks.id, blockId));
    if (b.sceneId) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(scheduleBlocks).where(and(eq(scheduleBlocks.sceneId, b.sceneId), isNull(scheduleBlocks.archivedAt)));
      if (n === 0) await tx.update(scenes).set({ status: "ready", updatedAt: new Date() }).where(and(eq(scenes.id, b.sceneId), eq(scenes.status, "scheduled")));
    }
    await audit(tx, ctx, "unschedule", "shoot_days", b.shootDayId, { productionId: b.productionId, before: b });
  });
}

/** Ensure everyone in a scheduled scene has a call entry (call time defaults to general call). */
async function syncCallsTx(tx: DbOrTx, ctx: Ctx, day: typeof shootDays.$inferSelect) {
  const needed = await tx.selectDistinct({ personId: scenePeople.personId, roleType: scenePeople.roleType, characterName: scenePeople.characterName })
    .from(scheduleBlocks).innerJoin(scenePeople, eq(scenePeople.sceneId, scheduleBlocks.sceneId))
    .where(and(eq(scheduleBlocks.shootDayId, day.id), isNull(scheduleBlocks.archivedAt)));
  const seen = new Set<string>();
  for (const n of needed) {
    if (seen.has(n.personId)) continue;
    seen.add(n.personId);
    await tx.insert(dayCalls).values({ orgId: ctx.orgId, createdBy: ctx.userId, productionId: day.productionId, shootDayId: day.id, personId: n.personId, roleType: n.roleType === "crew" ? "crew" : n.roleType, roleTitle: n.characterName, callTime: day.generalCall })
      .onConflictDoNothing({ target: [dayCalls.shootDayId, dayCalls.personId] });
  }
}

export async function syncCalls(ctx: Ctx, shootDayId: string) {
  requireWrite(ctx, "production");
  await db.transaction(async (tx) => syncCallsTx(tx, ctx, await loadDay(ctx, shootDayId, tx)));
}

export async function upsertCall(ctx: Ctx, shootDayId: string, personId: string, patch: { roleType?: string; roleTitle?: string | null; callTime?: string | null; onSetTime?: string | null; pickupTime?: string | null; confirmed?: boolean; notes?: string | null }) {
  requireWrite(ctx, "production");
  for (const k of ["callTime", "onSetTime", "pickupTime"] as const) if (patch[k] && !/^\d{2}:\d{2}(:\d{2})?$/.test(patch[k]!)) throw invalid("Times must be HH:MM.");
  return db.transaction(async (tx) => {
    const day = await loadDay(ctx, shootDayId, tx);
    await assertPerson(ctx, personId, tx);
    const [row] = await tx.insert(dayCalls).values({ orgId: ctx.orgId, createdBy: ctx.userId, productionId: day.productionId, shootDayId, personId, roleType: patch.roleType ?? "crew", roleTitle: patch.roleTitle ?? null, callTime: patch.callTime ?? day.generalCall, onSetTime: patch.onSetTime ?? null, pickupTime: patch.pickupTime ?? null, confirmed: patch.confirmed ?? false, notes: patch.notes ?? null })
      .onConflictDoUpdate({ target: [dayCalls.shootDayId, dayCalls.personId], set: { ...patch, updatedAt: new Date(), version: sql`${dayCalls.version} + 1` } }).returning();
    await audit(tx, ctx, "set_call", "shoot_days", shootDayId, { productionId: day.productionId, after: { personId, ...patch } });
    return row;
  });
}

export async function removeCall(ctx: Ctx, callId: string) {
  requireWrite(ctx, "production");
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(dayCalls).where(and(eq(dayCalls.id, callId), eq(dayCalls.orgId, ctx.orgId))).limit(1);
    if (!c || !productionAllowed(ctx, c.productionId)) throw notFound();
    await tx.delete(dayCalls).where(eq(dayCalls.id, callId));
    await audit(tx, ctx, "remove_call", "shoot_days", c.shootDayId, { productionId: c.productionId, before: c });
  });
}

/** On-set check-in (tablet). Production writers and department heads may check people in. */
export async function checkIn(ctx: Ctx, callId: string, undo = false) {
  if (!["org_admin", "producer", "production_manager", "department_head"].includes(ctx.role)) throw invalid("Only production staff can check people in.");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(dayCalls).where(and(eq(dayCalls.id, callId), eq(dayCalls.orgId, ctx.orgId))).limit(1);
    if (!c || !productionAllowed(ctx, c.productionId)) throw notFound();
    const [row] = await tx.update(dayCalls).set({ checkedInAt: undo ? null : new Date(), updatedAt: new Date() }).where(eq(dayCalls.id, callId)).returning();
    await audit(tx, ctx, undo ? "undo_check_in" : "check_in", "shoot_days", c.shootDayId, { productionId: c.productionId, after: { personId: c.personId } });
    return row;
  });
}

// ───────────── Shoot → post handover ─────────────

/**
 * Wrap a shoot day: marks it wrapped, marks its scheduled scenes as shot, and creates (once) an
 * ingest task for the day plus an edit task per affected episode. Idempotent via generation keys.
 */
export async function wrapDayToPost(ctx: Ctx, shootDayId: string) {
  requireWrite(ctx, "production");
  return db.transaction(async (tx) => {
    const day = await loadDay(ctx, shootDayId, tx);
    const blockScenes = await tx.select({ s: scenes }).from(scheduleBlocks).innerJoin(scenes, eq(scenes.id, scheduleBlocks.sceneId))
      .where(and(eq(scheduleBlocks.shootDayId, day.id), isNull(scheduleBlocks.archivedAt)));
    if (!blockScenes.length) throw invalid("There are no scheduled scenes on this day to hand over.");
    await tx.update(shootDays).set({ status: "wrapped", updatedAt: new Date(), version: sql`${shootDays.version} + 1` }).where(eq(shootDays.id, day.id));
    const sceneIds = blockScenes.map((b) => b.s.id);
    await tx.update(scenes).set({ status: "shot", updatedAt: new Date(), version: sql`${scenes.version} + 1` }).where(and(inArray(scenes.id, sceneIds), inArray(scenes.status, ["draft", "ready", "scheduled"])));
    const created: string[] = [];
    const ins = await tx.insert(postTasks).values({ orgId: ctx.orgId, createdBy: ctx.userId, productionId: day.productionId, kind: "ingest", title: `Ingest & verify rushes — ${day.date} (${day.unit})`, status: "todo", generationKey: `wrap-ingest:${day.id}`, notes: `Scenes: ${blockScenes.map((b) => b.s.number).join(", ")}` })
      .onConflictDoNothing({ target: postTasks.generationKey }).returning();
    if (ins[0]) created.push(ins[0].id);
    const episodeIds = [...new Set(blockScenes.map((b) => b.s.episodeId ?? "none"))];
    for (const ep of episodeIds) {
      const r = await tx.insert(postTasks).values({ orgId: ctx.orgId, createdBy: ctx.userId, productionId: day.productionId, episodeId: ep === "none" ? null : ep, kind: "edit", title: "Assembly edit", status: "todo", generationKey: `wrap-edit:${day.productionId}:${ep}` })
        .onConflictDoNothing({ target: postTasks.generationKey }).returning();
      if (r[0]) created.push(r[0].id);
    }
    await audit(tx, ctx, "wrap_to_post", "shoot_days", day.id, { productionId: day.productionId, meta: { scenes: sceneIds.length, createdTasks: created } });
    await emit(tx, { orgId: ctx.orgId, type: "shoot_day.wrapped", entityType: "shoot_days", entityId: day.id, productionId: day.productionId, idempotencyKey: `shoot_day.wrapped:${day.id}`, actorUserId: ctx.userId });
    return { scenesMarkedShot: sceneIds.length, tasksCreated: created.length };
  });
}

export async function editVersionsFor(ctx: Ctx, productionId: string) {
  if (!productionAllowed(ctx, productionId)) throw notFound();
  return db.select().from(editVersions).where(and(eq(editVersions.productionId, productionId), isNull(editVersions.archivedAt)));
}
