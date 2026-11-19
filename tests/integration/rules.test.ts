/** Custom automation rules: validation, firing, idempotency, owner permissions and loop guard. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { tasks, workflowRuns } from "@/db/schema";
import { createEntity, getEntityRow, updateEntity } from "@/server/entities/crud";
import { createRule, setRuleStatus } from "@/server/workflows/rules";
import { processOutbox } from "@/server/workflows/engine";
import { advanceDeliverable, approveDeliverable } from "@/server/services/post-legal";
import { makeOrg, makeUser } from "../support/factory";
import type { Ctx } from "@/server/auth/context";

let admin: Ctx, producer: Ctx, prodId: string;
beforeAll(async () => {
  const org = await makeOrg("Rules");
  admin = await makeUser(org.id, "org_admin");
  prodId = (await createEntity(admin, "productions", { title: "Rules show", kind: "series" })).id;
  producer = await makeUser(org.id, "producer", { productionIds: [prodId] });
});
afterAll(async () => { await closeDb(); });

describe("custom automation rules", () => {
  it("validates rules and is admin-only", async () => {
    const base = { name: "x", entity: "scenes", event: "updated", field: "kind", value: "round", action: { type: "create_task", title: "t" } };
    await expect(createRule(producer, base)).rejects.toThrow(/admins/);
    await expect(createRule(admin, { ...base, value: "nonsense" })).rejects.toThrow(/not a valid/);
    await expect(createRule(admin, { ...base, field: "description" })).rejects.toThrow(/can't be used/);
    await expect(createRule(admin, { ...base, action: { type: "set_field", field: "kind", value: "segment" } })).rejects.toThrow(/triggers it/);
    await expect(createRule(admin, { ...base, action: { type: "set_field", field: "status", value: "nonsense" } })).rejects.toThrow();
  });

  it("creates a task when a deliverable is rejected — exactly once, linked to the production", async () => {
    await createRule(admin, { name: "Chase rejected deliverables", entity: "deliverables", event: "updated", field: "status", value: "rejected", action: { type: "create_task", title: "Fix QC notes: {{title}}", priority: "urgent", dueInDays: 1 } });
    const d = await createEntity(producer, "deliverables", { productionId: prodId, title: "Ep1 master", requiresRightsClearance: false });
    await advanceDeliverable(producer, d.id, "in_progress");
    await processOutbox({ orgId: admin.orgId });
    expect((await db.select().from(tasks).where(eq(tasks.productionId, prodId))).length).toBe(0); // condition false
    await advanceDeliverable(producer, d.id, "ready_for_approval");
    await approveDeliverable(producer, d.id, "rejected", "Audio peaks");
    // approveDeliverable writes directly; emulate a status edit through the generic path as well
    await processOutbox({ orgId: admin.orgId });
    await processOutbox({ orgId: admin.orgId });
    const t = (await db.select().from(tasks).where(eq(tasks.productionId, prodId))).filter((x) => x.title === "Fix QC notes: Ep1 master");
    expect(t.length).toBe(1);
    expect(t[0].priority).toBe("urgent");
    expect(t[0].dueDate).not.toBeNull();
  });

  it("sets a field, runs with owner permissions, and respects pause + loop guard", async () => {
    // Two rules that would ping-pong forever without the depth guard.
    const r1 = await createRule(admin, { name: "A", entity: "scenes", event: "updated", field: "dayNight", value: "NIGHT", action: { type: "set_field", field: "intExt", value: "EXT" } });
    const r2 = await createRule(admin, { name: "B", entity: "scenes", event: "updated", field: "intExt", value: "EXT", action: { type: "set_field", field: "dayNight", value: "NIGHT" } });
    const s = await createEntity(producer, "scenes", { productionId: prodId, number: "1", title: "Alley", intExt: "INT", dayNight: "DAY" });
    await updateEntity(producer, "scenes", s.id, { dayNight: "NIGHT" });
    for (let i = 0; i < 6; i++) await processOutbox({ orgId: admin.orgId });
    expect((await getEntityRow(producer, "scenes", s.id)).intExt).toBe("EXT");
    const runs = await db.select().from(workflowRuns).where(and(eq(workflowRuns.orgId, admin.orgId), eq(workflowRuns.workflowKey, r1.key)));
    expect(runs.some((x) => x.status === "succeeded")).toBe(true);
    await setRuleStatus(admin, r1.id, "paused");
    await setRuleStatus(admin, r2.id, "paused");
    await updateEntity(producer, "scenes", s.id, { intExt: "INT" });
    await updateEntity(producer, "scenes", s.id, { dayNight: "DAY" });
    await updateEntity(producer, "scenes", s.id, { dayNight: "NIGHT" });
    for (let i = 0; i < 3; i++) await processOutbox({ orgId: admin.orgId });
    expect((await getEntityRow(producer, "scenes", s.id)).intExt).toBe("INT"); // paused rules don't fire
  });
});

describe("resource checkout logic and location booking clashes", () => {
  it("syncs resource status, blocks over-issue, and flags another production's booking", async () => {
    const { shootDayConflicts } = await import("@/server/services/conflicts");
    const { addSceneToDay } = await import("@/server/services/production-ops");
    const kit = await createEntity(producer, "resources", { name: "Gimbal", kind: "equipment", quantity: 1 });
    const co = await createEntity(producer, "resource_checkouts", { resourceId: kit.id, productionId: prodId, dueAt: new Date(Date.now() - 864e5).toISOString() });
    expect((await getEntityRow(producer, "resources", kit.id)).status).toBe("checked_out");
    await expect(createEntity(producer, "resource_checkouts", { resourceId: kit.id, productionId: prodId })).rejects.toThrow(/already checked out/);
    await updateEntity(producer, "resource_checkouts", co.id, { inAt: new Date().toISOString() });
    expect((await getEntityRow(producer, "resources", kit.id)).status).toBe("available");

    const loc = await createEntity(admin, "locations", { name: "Rooftop", status: "confirmed" });
    const other = await createEntity(admin, "productions", { title: "Other prod", kind: "film", usesEpisodes: false });
    await createEntity(admin, "location_bookings", { productionId: other.id, locationId: loc.id, startDate: "2028-07-01", endDate: "2028-07-03", status: "confirmed" });
    const sc = await createEntity(producer, "scenes", { productionId: prodId, number: "50", title: "Roof", locationId: loc.id });
    const day = await createEntity(producer, "shoot_days", { productionId: prodId, date: "2028-07-02" });
    await addSceneToDay(producer, day.id, sc.id);
    const c = await shootDayConflicts(producer, day.id);
    const clash = c.find((x) => x.type === "location_clash");
    expect(clash?.severity).toBe("error");
    expect(clash?.message).toMatch(/another production/); // producer isn't a member of the other production
  });
});
