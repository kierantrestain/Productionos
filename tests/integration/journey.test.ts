/**
 * Acceptance 2, 3, 4, 7, 9, 12, 30 — the first-release producer journey against real PostgreSQL:
 * show → episode → scene → linked people/resources → shots → shoot day → conflicts → call sheet → post → delivery.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { callSheets, shots, scenes as scenesT } from "@/db/schema";
import { createEntity, getEntityRow, listEntity, updateEntity } from "@/server/entities/crud";
import { addSceneToDay, duplicateShot, linkScenePerson, linkSceneResource, moveBlock, wrapDayToPost, upsertCall } from "@/server/services/production-ops";
import { shootDayConflicts } from "@/server/services/conflicts";
import { buildSnapshot, issueCallSheet, getCallSheet } from "@/server/services/callsheets";
import { advanceDeliverable, approveDeliverable, decideEditVersion, markDelivered } from "@/server/services/post-legal";
import { processOutbox } from "@/server/workflows/engine";
import { makeOrg, makeUser, refresh } from "../support/factory";
import type { Ctx } from "@/server/auth/context";

let producer: Ctx, exec: Ctx;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const org = await makeOrg("Journey");
  producer = await makeUser(org.id, "producer");
  exec = await makeUser(org.id, "executive");
});
afterAll(async () => { await closeDb(); });

describe("first-release producer journey", () => {
  it("creates a show/IP, a series production and an episode", async () => {
    const ip = await createEntity(exec, "ip_projects", { title: "Fixture: Quiz Night", formatType: "gameshow", stage: "greenlit" });
    const prod = await createEntity(producer, "productions", { title: "Fixture: Quiz Night S1", kind: "gameshow", usesEpisodes: true, ipProjectId: ip.id });
    producer = await refresh(producer); // creator becomes a production member
    const ep = await createEntity(producer, "episodes", { productionId: prod.id, number: 1, title: "Heat 1" });
    Object.assign(ids, { ip: ip.id, prod: prod.id, ep: ep.id });
    const reread = await getEntityRow(producer, "episodes", ep.id);
    expect(reread.title).toBe("Heat 1");
  });

  it("supports a standalone production with no seasons or episodes", async () => {
    const film = await createEntity(producer, "productions", { title: "Fixture: Brand Spot", kind: "commercial", usesEpisodes: false });
    producer = await refresh(producer);
    const seg = await createEntity(producer, "scenes", { productionId: film.id, number: "1", title: "Hero product shot", kind: "segment" });
    expect(seg.episodeId).toBeNull();
  });

  it("adds scenes, links shared people and resources, rejects cross-production links", async () => {
    const loc = await createEntity(producer, "locations", { name: "Studio 2", kind: "studio", status: "confirmed" });
    const host = await createEntity(producer, "people", { fullName: "Fixture Host" });
    const camOp = await createEntity(producer, "people", { fullName: "Fixture Camera Op" });
    const buzzer = await createEntity(producer, "resources", { name: "Buzzer set", kind: "prop", quantity: 1 });
    const camera = await createEntity(producer, "resources", { name: "Studio camera", kind: "equipment", quantity: 2 });
    const s1 = await createEntity(producer, "scenes", { productionId: ids.prod, episodeId: ids.ep, number: "1", title: "Round 1 — Fastest finger", kind: "round", locationId: loc.id, estDurationMins: 45 });
    const s2 = await createEntity(producer, "scenes", { productionId: ids.prod, episodeId: ids.ep, number: "2", title: "Round 2 — Picture board", kind: "round", locationId: loc.id, estDurationMins: 30 });
    await linkScenePerson(producer, s1.id, host.id, "host");
    await linkScenePerson(producer, s1.id, camOp.id, "crew");
    await linkSceneResource(producer, s1.id, buzzer.id, 1);
    await linkSceneResource(producer, s1.id, camera.id, 2);
    Object.assign(ids, { loc: loc.id, host: host.id, camOp: camOp.id, buzzer: buzzer.id, camera: camera.id, s1: s1.id, s2: s2.id });
    // Duplicate scene numbers inside an episode are rejected by the database.
    await expect(createEntity(producer, "scenes", { productionId: ids.prod, episodeId: ids.ep, number: "1", title: "dupe" })).rejects.toThrow();
    // Episode from another production cannot be linked.
    const other = await createEntity(producer, "productions", { title: "Other", kind: "series" });
    producer = await refresh(producer);
    await expect(createEntity(producer, "scenes", { productionId: other.id, episodeId: ids.ep, number: "9", title: "x" })).rejects.toThrow(/different production/);
  });

  it("auto-creates at most one initial shot no matter how often the scene is edited (acceptance 12)", async () => {
    for (let i = 0; i < 4; i++) {
      const cur = await getEntityRow(producer, "scenes", ids.s1);
      await updateEntity(producer, "scenes", ids.s1, { director: i % 2 ? "Dir A" : "Dir B", title: `Round 1 — Fastest finger${i ? ` v${i}` : ""}` }, cur.version as number);
      await processOutbox({ orgId: producer.orgId });
    }
    const all = await db.select().from(shots).where(eq(shots.sceneId, ids.s1));
    expect(all.filter((s) => s.autoGenerated)).toHaveLength(1);
    // A deliberate manual shot and a duplicate are kept; the automation never deletes them.
    const manual = await createEntity(producer, "shots", { productionId: ids.prod, sceneId: ids.s1, number: "2", description: "Contestant reaction ISO", shotType: "ISO" });
    const dupe = await duplicateShot(producer, manual.id);
    expect(dupe.number).toBe("3");
    await updateEntity(producer, "scenes", ids.s1, { director: "Dir C" });
    await processOutbox({ orgId: producer.orgId });
    const after = await db.select().from(shots).where(eq(shots.sceneId, ids.s1));
    expect(after).toHaveLength(3);
    expect(after.filter((s) => s.autoGenerated)).toHaveLength(1);
  });

  it("schedules scenes on a shoot day and detects conflicts without reload (acceptance 7, 11)", async () => {
    const day = await createEntity(producer, "shoot_days", { productionId: ids.prod, date: "2027-03-10", dayNumber: 1, generalCall: "07:30", baseLocationId: ids.loc });
    ids.day = day.id;
    await addSceneToDay(producer, day.id, ids.s1);
    await addSceneToDay(producer, day.id, ids.s2, { startTime: "08:00", endTime: "08:30" }); // overlaps 07:30–08:15
    const c1 = await shootDayConflicts(producer, day.id);
    expect(c1.some((c) => c.type === "time_overlap")).toBe(true);
    expect(c1.some((c) => c.type === "contract_unsigned" || c.type === "release_missing")).toBe(true);

    // Same camera kit needed by another production's day on the same date → overcommitted.
    const other = await createEntity(producer, "productions", { title: "Other show", kind: "series" });
    producer = await refresh(producer);
    const oScene = await createEntity(producer, "scenes", { productionId: other.id, number: "1", title: "Other scene" });
    await linkSceneResource(producer, oScene.id, ids.camera, 1);
    await linkScenePerson(producer, oScene.id, ids.camOp, "crew");
    const oDay = await createEntity(producer, "shoot_days", { productionId: other.id, date: "2027-03-10" });
    await addSceneToDay(producer, oDay.id, oScene.id);
    const c2 = await shootDayConflicts(producer, day.id);
    expect(c2.find((c) => c.type === "resource_overcommitted")?.message).toMatch(/Studio camera: 3 needed/);
    expect(c2.some((c) => c.type === "person_double_booked")).toBe(true);
    expect(c2.some((c) => c.type === "location_clash")).toBe(false); // other day uses no location

    // Unavailability is detected.
    await createEntity(producer, "availability_blocks", { personId: ids.host, startDate: "2027-03-09", endDate: "2027-03-11", kind: "unavailable", note: "Holiday" });
    expect((await shootDayConflicts(producer, day.id)).some((c) => c.type === "person_unavailable")).toBe(true);
  });

  it("issues versioned immutable call sheets (acceptance 9)", async () => {
    await expect(issueCallSheet(producer, ids.day)).rejects.toThrow(/blocking conflict/);
    const v1 = await issueCallSheet(producer, ids.day, null, { allowWithErrors: true });
    expect(v1.versionNumber).toBe(1);
    const snap1 = (await getCallSheet(producer, v1.id)).snapshot;
    expect(snap1.calls.some((c) => c.name === "Fixture Host")).toBe(true);
    expect(JSON.stringify(snap1)).not.toMatch(/@/); // no personal emails in the snapshot

    // Reschedule: move scene 2 before scene 1, then issue v2.
    const blocks = await db.execute(sql`select id, scene_id from schedule_blocks where shoot_day_id = ${ids.day} order by sort_order`) as unknown as { id: string; scene_id: string }[];
    await moveBlock(producer, blocks[1].id, { shootDayId: ids.day, beforeBlockId: blocks[0].id });
    await upsertCall(producer, ids.day, ids.host, { callTime: "06:45", roleType: "host" });
    const live = await buildSnapshot(producer, ids.day);
    expect(live.schedule[0].sceneNumber).toBe("2");
    const v2 = await issueCallSheet(producer, ids.day, "Revised running order", { allowWithErrors: true });
    expect(v2.versionNumber).toBe(2);

    const [old] = await db.select().from(callSheets).where(eq(callSheets.id, v1.id));
    expect(old.status).toBe("superseded");
    expect((old.snapshot as typeof snap1).schedule[0].sceneNumber).toBe("1"); // unchanged history
    // Database refuses to rewrite an issued snapshot.
    await expect(db.update(callSheets).set({ snapshot: { tampered: true } }).where(eq(callSheets.id, v1.id))).rejects.toThrow();
  });

  it("hands the shoot over to post, reviews the cut and approves + delivers (acceptance 20, 30)", async () => {
    const r = await wrapDayToPost(producer, ids.day);
    expect(r.scenesMarkedShot).toBe(2);
    const again = await wrapDayToPost(producer, ids.day); // idempotent
    expect(again.tasksCreated).toBe(0);
    const [s1] = await db.select().from(scenesT).where(eq(scenesT.id, ids.s1));
    expect(s1.status).toBe("shot");
    const tasks = await listEntity(producer, "post_tasks", { filters: { productionId: ids.prod } });
    expect(tasks.rows.map((t) => t.kind).sort()).toEqual(["edit", "ingest"]);

    const editor = await createEntity(producer, "people", { fullName: "Fixture Editor" });
    await updateEntity(producer, "post_tasks", tasks.rows.find((t) => t.kind === "edit")!.id, { assigneePersonId: editor.id, status: "in_progress" });
    const cut = await createEntity(producer, "edit_versions", { productionId: ids.prod, episodeId: ids.ep, versionLabel: "v1", kind: "rough_cut" });
    const approvedCut = await decideEditVersion(exec, cut.id, "approved");
    expect(approvedCut.status).toBe("approved");

    const del = await createEntity(producer, "deliverables", { productionId: ids.prod, episodeId: ids.ep, title: "ProRes 422 HQ master", dueDate: "2027-04-01" });
    await advanceDeliverable(producer, del.id, "in_progress");
    await advanceDeliverable(producer, del.id, "ready_for_approval");
    await expect(markDelivered(producer, del.id)).rejects.toThrow(/approved/);
    // A missing underlying right blocks approval (acceptance 19).
    const right = await createEntity(producer, "rights_entries", { title: "Format licence", productionId: ids.prod, status: "missing" });
    await expect(approveDeliverable(exec, del.id, "approved")).rejects.toThrow(/Rights not cleared/);
    await updateEntity(producer, "rights_entries", right.id, { status: "cleared" });
    const approved = await approveDeliverable(exec, del.id, "approved");
    expect(approved.status).toBe("approved");
    const delivered = await markDelivered(producer, del.id);
    expect(delivered.status).toBe("delivered");
  });

  it("persists everything for a second session of another authorised user (acceptance 2)", async () => {
    const org = producer.orgId;
    const pm = await makeUser(org, "production_manager", { productionIds: [ids.prod] });
    const scenes = await listEntity(pm, "scenes", { filters: { episodeId: ids.ep } });
    expect(scenes.total).toBe(2);
    const del = await listEntity(pm, "deliverables", { filters: { productionId: ids.prod } });
    expect(del.rows[0].status).toBe("delivered");
  });
});

describe("resource demand is peak-per-day, not summed across sequential scenes", () => {
  it("does not flag kit reused across consecutive scenes of one unit", async () => {
    const org = await makeOrg("Peak");
    const p = await makeUser(org.id, "org_admin");
    const prod = await createEntity(p, "productions", { title: "Peak test", kind: "gameshow" });
    const cams = await createEntity(p, "resources", { name: "Ped camera", kind: "equipment", quantity: 4 });
    const day = await createEntity(p, "shoot_days", { productionId: prod.id, date: "2027-09-01", generalCall: "08:00" });
    for (let i = 1; i <= 5; i++) {
      const s = await createEntity(p, "scenes", { productionId: prod.id, number: String(i), title: `Round ${i}` });
      await linkSceneResource(p, s.id, cams.id, 4);
      await addSceneToDay(p, day.id, s.id);
    }
    expect((await shootDayConflicts(p, day.id)).some((c) => c.type === "resource_overcommitted")).toBe(false);
    const prod2 = await createEntity(p, "productions", { title: "Second unit", kind: "series" });
    const s2 = await createEntity(p, "scenes", { productionId: prod2.id, number: "1", title: "Pickup" });
    await linkSceneResource(p, s2.id, cams.id, 1);
    const day2 = await createEntity(p, "shoot_days", { productionId: prod2.id, date: "2027-09-01" });
    await addSceneToDay(p, day2.id, s2.id);
    expect((await shootDayConflicts(p, day.id)).find((c) => c.type === "resource_overcommitted")?.message).toMatch(/5 needed .* only 4/);
  });
});
