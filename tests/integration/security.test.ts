/** Acceptance 1, 10, 17, 18 — tenancy isolation, production scoping, field redaction, approvals, finance. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db";
import { createEntity, getEntityRow, listEntity, updateEntity } from "@/server/entities/crud";
import { decideApproval, requestApproval, requiredRoleForSpend } from "@/server/services/approvals";
import { budgetSummary, summarise, vatOn } from "@/server/services/finance";
import { getCallSheet, issueCallSheet } from "@/server/services/callsheets";
import { addSceneToDay, linkScenePerson } from "@/server/services/production-ops";
import { makeOrg, makeUser } from "../support/factory";
import type { Ctx } from "@/server/auth/context";

let adminA: Ctx, producerA: Ctx, adminB: Ctx;
let prodA: string, prodA2: string, personA: string;

beforeAll(async () => {
  const a = await makeOrg("Org A"), b = await makeOrg("Org B");
  adminA = await makeUser(a.id, "org_admin");
  producerA = await makeUser(a.id, "producer");
  adminB = await makeUser(b.id, "org_admin");
  prodA = (await createEntity(adminA, "productions", { title: "A main", kind: "series" })).id;
  prodA2 = (await createEntity(adminA, "productions", { title: "A secret", kind: "film", usesEpisodes: false })).id;
  personA = (await createEntity(adminA, "people", { fullName: "Private Person", email: "private@example.test", phone: "07000000000" })).id;
  producerA = await makeUser(a.id, "producer", { productionIds: [prodA] });
});
afterAll(async () => { await closeDb(); });

describe("tenancy and scoping", () => {
  it("organisation B cannot read or write organisation A records by id (acceptance 1)", async () => {
    await expect(getEntityRow(adminB, "productions", prodA)).rejects.toThrow(/not found/i);
    await expect(updateEntity(adminB, "productions", prodA, { title: "pwned" })).rejects.toThrow(/not found/i);
    expect((await listEntity(adminB, "productions")).rows.find((r) => r.id === prodA)).toBeUndefined();
    // Cannot link to another org's record either.
    await expect(createEntity(adminB, "engagements", { productionId: prodA, personId: personA, kind: "crew" })).rejects.toThrow();
  });

  it("production-scoped roles only see productions they belong to", async () => {
    const visible = (await listEntity(producerA, "productions")).rows.map((r) => r.id);
    expect(visible).toContain(prodA);
    expect(visible).not.toContain(prodA2);
    await expect(createEntity(producerA, "scenes", { productionId: prodA2, number: "1", title: "x" })).rejects.toThrow(/not a member/);
  });

  it("cast/crew cannot see finance, salaries or other people's personal data (acceptance 10)", async () => {
    const cast = await makeUser(adminA.orgId, "cast", { productionIds: [prodA] });
    const crew = await makeUser(adminA.orgId, "crew", { productionIds: [prodA] });
    for (const c of [cast, crew]) {
      await expect(listEntity(c, "budgets")).rejects.toThrow(/permission/);
      await expect(listEntity(c, "people")).rejects.toThrow(/permission/);
      await expect(listEntity(c, "engagements")).rejects.toThrow(/permission/);
      await expect(listEntity(c, "funding_sources")).rejects.toThrow(/permission/);
    }
    await expect(listEntity(cast, "scenes")).rejects.toThrow(/permission/);
    expect((await listEntity(crew, "scenes", { filters: { productionId: prodA } })).total).toBeGreaterThanOrEqual(0);
    await expect(createEntity(crew, "scenes", { productionId: prodA, number: "1", title: "x" })).rejects.toThrow(/permission/);
  });

  it("department heads see people but not personal contact details or rates", async () => {
    const dh = await makeUser(adminA.orgId, "department_head", { productionIds: [prodA] });
    const row = await getEntityRow(dh, "people", personA);
    expect(row.fullName).toBe("Private Person");
    expect(row.email).toBeNull();
    expect(row.phone).toBeNull();
    const eng = await createEntity(adminA, "engagements", { productionId: prodA, personId: personA, kind: "crew", roleTitle: "Gaffer", rateMinor: 45000 });
    const seen = await getEntityRow(dh, "engagements", eng.id);
    expect(seen.roleTitle).toBe("Gaffer");
    expect(seen.rateMinor).toBeNull(); // rate redacted for department heads
    await expect(updateEntity(dh, "engagements", eng.id, { rateMinor: 1 })).rejects.toThrow(/permission/);
  });

  it("cast can only open issued call sheets for days they are called on", async () => {
    const actor = await createEntity(adminA, "people", { fullName: "Actor One" });
    const other = await createEntity(adminA, "people", { fullName: "Actor Two" });
    const cast = await makeUser(adminA.orgId, "cast", { productionIds: [prodA], personId: actor.id });
    const castOther = await makeUser(adminA.orgId, "cast", { productionIds: [prodA], personId: other.id });
    const scene = await createEntity(adminA, "scenes", { productionId: prodA, number: "5", title: "Kitchen" });
    await linkScenePerson(adminA, scene.id, actor.id, "cast", "Mum");
    const day = await createEntity(adminA, "shoot_days", { productionId: prodA, date: "2027-05-01", generalCall: "08:00" });
    await addSceneToDay(adminA, day.id, scene.id);
    const cs = await issueCallSheet(adminA, day.id, null, { allowWithErrors: true });
    expect((await getCallSheet(cast, cs.id)).versionNumber).toBe(1);
    await expect(getCallSheet(castOther, cs.id)).rejects.toThrow(/not found/i);
  });
});

describe("approvals and finance (acceptance 17, 18)", () => {
  it("routes approvals by amount, blocks self-approval and insufficient authority", async () => {
    expect(requiredRoleForSpend(50_000)).toBe("production_manager");
    expect(requiredRoleForSpend(500_000)).toBe("producer");
    expect(requiredRoleForSpend(5_000_000)).toBe("executive");
    const exec = await makeUser(adminA.orgId, "executive");
    const pm = await makeUser(adminA.orgId, "production_manager", { productionIds: [prodA] });
    const budget = await createEntity(producerA, "budgets", { productionId: prodA, name: "Main" });
    const line = await createEntity(producerA, "budget_lines", { productionId: prodA, budgetId: budget.id, code: "200", category: "Camera", estimateMinor: 2_000_000, approvedMinor: 2_000_000, vatRateBp: 2000 });
    const po = await createEntity(producerA, "purchase_orders", { productionId: prodA, budgetLineId: line.id, number: `PO-${Date.now()}`, description: "Camera package", netMinor: 1_200_000, vatMinor: 240_000 });
    const req = await requestApproval(producerA, "purchase_orders", po.id);
    expect(req.requiredRole).toBe("executive");
    await expect(decideApproval(producerA, req.id, "approved")).rejects.toThrow();
    await expect(decideApproval(pm, req.id, "approved")).rejects.toThrow(/executive authority/);
    await expect(decideApproval(exec, req.id, "rejected")).rejects.toThrow(/reason/);
    await decideApproval(exec, req.id, "approved", "Within plan");
    await expect(decideApproval(exec, req.id, "approved")).rejects.toThrow(/already/);

    const exp = await createEntity(pm, "expenses", { productionId: prodA, budgetLineId: line.id, purchaseOrderId: po.id, description: "Camera week 1", netMinor: 400_000, vatMinor: 80_000 });
    const er = await requestApproval(pm, "expenses", exp.id);
    expect(er.requiredRole).toBe("producer");
    await decideApproval(producerA, er.id, "approved");

    const s = await budgetSummary(producerA, budget.id);
    const l = s.lines[0];
    expect(l.approved).toBe(2_000_000);
    expect(l.actual).toBe(400_000);
    expect(l.committed).toBe(800_000); // PO 1.2m minus 400k already actualised against it
    expect(l.forecast).toBe(2_000_000);
    expect(l.variance).toBe(0);
    expect(s.totals.vatOnApproved).toBe(400_000);
    expect(l.approvedGross).toBe(2_400_000);
  });

  it("calculates VAT and overspend correctly", () => {
    expect(vatOn(12345, 2000)).toBe(2469);
    expect(vatOn(100, 500)).toBe(5);
    const base = { orgId: "o", productionId: "p", budgetId: "b", createdAt: new Date(), updatedAt: new Date(), createdBy: null, version: 1, archivedAt: null, episodeId: null, description: null, sortOrder: 0 };
    const r = summarise(
      [{ ...base, id: "l1", code: "1", category: "Cat", estimateMinor: 1000, approvedMinor: 1000, forecastMinor: null, vatRateBp: 2000 }],
      [],
      [{ ...base, id: "e1", budgetLineId: "l1", purchaseOrderId: null, supplier: null, claimantPersonId: null, incurredOn: null, netMinor: 1500, vatMinor: 300, status: "paid", approvalRequestId: null, description: "x" }] as never,
    );
    expect(r.lines[0].forecast).toBe(1500);
    expect(r.lines[0].variance).toBe(-500);
  });
});
