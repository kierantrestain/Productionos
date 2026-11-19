/** Organisation customisation: settings drive logic; option lists; custom fields with validation, filters and permissions. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db";
import { createEntity, listEntity, updateEntity } from "@/server/entities/crud";
import { createFieldDef, customValuesFor, listFieldDefs, setCustomValues, updateFieldDef, updateSettings } from "@/server/services/customise";
import { requestApproval } from "@/server/services/approvals";
import { buildSnapshot } from "@/server/services/callsheets";
import { addSceneToDay } from "@/server/services/production-ops";
import { makeOrg, makeUser, refresh } from "../support/factory";
import type { Ctx } from "@/server/auth/context";

let admin: Ctx, producer: Ctx, crew: Ctx, prodId: string;
beforeAll(async () => {
  const org = await makeOrg("Customise");
  admin = await makeUser(org.id, "org_admin");
  prodId = (await createEntity(admin, "productions", { title: "Custom show", kind: "series" })).id;
  producer = await makeUser(org.id, "producer", { productionIds: [prodId] });
  crew = await makeUser(org.id, "crew", { productionIds: [prodId] });
});
afterAll(async () => { await closeDb(); });

describe("organisation settings drive server logic", () => {
  it("validates input and is admin-only", async () => {
    await expect(updateSettings(producer, { currency: "USD" })).rejects.toThrow(/admins/);
    await expect(updateSettings(admin, { currency: "dollars" })).rejects.toThrow(/currency/);
    await expect(updateSettings(admin, { timezone: "Mars/Olympus" })).rejects.toThrow(/timezone/);
    await expect(updateSettings(admin, { approval: { pmLimitMinor: 500_000, producerLimitMinor: 100_000 } })).rejects.toThrow(/Producer limit/);
    await expect(updateSettings(admin, { options: { "scenes.status": ["parked"] } })).rejects.toThrow(/not an extensible/);
  });

  it("applies currency, VAT, approval limits and call-sheet policy", async () => {
    await updateSettings(admin, { currency: "USD", defaultVatBp: 875, approval: { pmLimitMinor: 50_000, producerLimitMinor: 200_000 }, callSheetContactPolicy: "Call the PO line only." });
    admin = await refresh(admin); producer = await refresh(producer);
    const budget = await createEntity(producer, "budgets", { productionId: prodId, name: "Main" });
    expect(budget.currency).toBe("USD");
    const line = await createEntity(producer, "budget_lines", { productionId: prodId, budgetId: budget.id, category: "Camera", estimateMinor: 1000 });
    expect(line.vatRateBp).toBe(875);
    const po = await createEntity(producer, "purchase_orders", { productionId: prodId, number: `PO-C-${Date.now()}`, description: "Lens", netMinor: 100_000, vatMinor: 0 });
    expect((await requestApproval(producer, "purchase_orders", po.id)).requiredRole).toBe("producer"); // £1,000 ≥ new PM limit (£500)
    const po2 = await createEntity(producer, "purchase_orders", { productionId: prodId, number: `PO-D-${Date.now()}`, description: "Crane", netMinor: 300_000, vatMinor: 0 });
    expect((await requestApproval(producer, "purchase_orders", po2.id)).requiredRole).toBe("executive");
    const scene = await createEntity(producer, "scenes", { productionId: prodId, number: "1", title: "Policy" });
    const day = await createEntity(producer, "shoot_days", { productionId: prodId, date: "2028-01-05" });
    await addSceneToDay(producer, day.id, scene.id);
    expect((await buildSnapshot(producer, day.id)).contactPolicy).toBe("Call the PO line only.");
  });

  it("accepts org-added options only where extensible", async () => {
    await expect(createEntity(producer, "scenes", { productionId: prodId, number: "2", title: "Song", kind: "song" })).rejects.toThrow();
    await updateSettings(admin, { options: { "scenes.kind": ["Song", "Choreography"] } });
    producer = await refresh(producer);
    const s = await createEntity(producer, "scenes", { productionId: prodId, number: "2", title: "Song", kind: "song" });
    expect(s.kind).toBe("song");
    await expect(updateEntity(producer, "scenes", s.id, { status: "parked" })).rejects.toThrow();
  });
});

describe("custom fields", () => {
  it("are admin-defined, typed, validated, filterable and follow record permissions", async () => {
    await expect(createFieldDef(producer, { entity: "scenes", label: "BPM", type: "number" })).rejects.toThrow(/admins/);
    await createFieldDef(admin, { entity: "scenes", label: "BPM", type: "number" });
    const mood = await createFieldDef(admin, { entity: "scenes", label: "Mood", type: "select", options: ["Upbeat", "Tense"] });
    await expect(createFieldDef(admin, { entity: "scenes", label: "Mood", type: "text" })).rejects.toThrow();
    await expect(createFieldDef(admin, { entity: "scenes", label: "Status", type: "text" })).rejects.toThrow(/built-in/);
    expect((await listFieldDefs(admin, "scenes")).map((d) => d.key)).toEqual(["bpm", "mood"]);

    const a = await createEntity(producer, "scenes", { productionId: prodId, number: "10", title: "Opener" });
    const b = await createEntity(producer, "scenes", { productionId: prodId, number: "11", title: "Closer" });
    await setCustomValues(producer, "scenes", a.id, { bpm: 128, mood: "Upbeat" });
    await setCustomValues(producer, "scenes", b.id, { mood: "Tense" });
    await expect(setCustomValues(producer, "scenes", a.id, { mood: "Sleepy" })).rejects.toThrow(/not one of/);
    await expect(setCustomValues(producer, "scenes", a.id, { bpm: "fast" })).rejects.toThrow(/number/);
    await expect(setCustomValues(producer, "scenes", a.id, { nope: 1 })).rejects.toThrow(/Unknown custom field/);
    await expect(setCustomValues(crew, "scenes", a.id, { bpm: 90 })).rejects.toThrow(/permission/);

    const vals = await customValuesFor(producer, "scenes", [a.id, b.id]);
    expect(vals[a.id]).toEqual({ bpm: 128, mood: "Upbeat" });
    const upbeat = await listEntity(producer, "scenes", { filters: { productionId: prodId }, customFilters: [{ fieldId: mood.id, value: "Upbeat" }] });
    expect(upbeat.rows.map((r) => r.id)).toEqual([a.id]);

    // Options in use cannot be removed.
    await expect(updateFieldDef(admin, mood.id, { options: ["Upbeat"] })).rejects.toThrow(/still use it/);
    // Required fields are enforced on creation.
    await createFieldDef(admin, { entity: "people", label: "Union number", type: "text", required: true });
    const p = await createEntity(producer, "people", { fullName: "Req Person" });
    await expect(setCustomValues(producer, "people", p.id, {}, { creating: true })).rejects.toThrow(/required/);
  });
});
