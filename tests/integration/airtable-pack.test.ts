/**
 * Airtable export-pack importer, against a hand-written SYNTHETIC fixture (fictional data only — the
 * real pack is never committed). Covers type mapping, two-way links, formula translation + fallback,
 * lookups/rollups/counts, unresolved links, forms/views/pages/automations, dry-run and idempotency.
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { baseAutomations, baseFields, baseRecords, baseTables, baseViews, bases, memberships, migrationMap } from "@/db/schema";
import { contextForUser } from "@/server/auth/sessions";
import { runView } from "@/server/platform/query";
import { importPack, loadPack, planField, reportMarkdown, translateFormula } from "@/server/migration/airtable-pack";
import { makeOrg, makeUser } from "../support/factory";
import type { Ctx } from "@/server/auth/context";

const DIR = path.resolve(__dirname, "../fixtures/airtable-pack-synthetic");
let owner: Ctx;
const counts = async (orgId: string) => {
  const b = await db.select().from(bases).where(and(eq(bases.orgId, orgId), like(bases.templateKey, "airtable:%")));
  const ids = b.map((x) => x.id);
  const t = ids.length ? await db.select().from(baseTables).where(eq(baseTables.baseId, ids[0])) : [];
  const tids = t.map((x) => x.id);
  const f = tids.length ? (await Promise.all(tids.map((id) => db.select().from(baseFields).where(eq(baseFields.tableId, id))))).flat() : [];
  const r = tids.length ? (await Promise.all(tids.map((id) => db.select().from(baseRecords).where(eq(baseRecords.tableId, id))))).flat() : [];
  const v = tids.length ? (await Promise.all(tids.map((id) => db.select().from(baseViews).where(eq(baseViews.tableId, id))))).flat() : [];
  return { bases: b.length, tables: t.length, fields: f.length, records: r.length, views: v.length };
};

beforeAll(async () => {
  const org = await makeOrg("Pack import");
  const u = await makeUser(org.id, "org_admin");
  await db.update(memberships).set({ platformRole: "owner" }).where(eq(memberships.userId, u.userId));
  owner = (await contextForUser(u.userId, org.id))!;
});
afterAll(async () => { await closeDb(); });

describe("pack reader and mapping (pure)", () => {
  it("validates the manifest and maps types honestly", () => {
    const pack = loadPack(DIR);
    expect(pack.issues).toEqual([]);
    const b = pack.bases[0];
    const by = (id: string) => { for (const t of b.tables) { const f = t.fields.find((x) => x.id === id); if (f) return planField(f, t.fields); } throw new Error(id); };
    expect(by("fldPNotes")).toMatchObject({ kind: "plain", type: "longText" });
    expect(by("fldPTasks")).toMatchObject({ kind: "link", type: "link" });
    expect(by("fldPHours")).toMatchObject({ kind: "computed", type: "lookup", category: "rollup→lookup" });
    expect(by("fldPCount")).toMatchObject({ kind: "computed", type: "count" });
    expect(by("fldPDouble")).toMatchObject({ kind: "computed", type: "formula", deps: ["fldPBudget"] });
    expect(by("fldPBad")).toMatchObject({ kind: "fallback", type: "longText" });
    expect(by("fldPWho")).toMatchObject({ kind: "plain", type: "singleLineText" });
    expect(by("fldPCreated")).toMatchObject({ kind: "computed", type: "createdTime" });
    expect(translateFormula("{Budget} * 2", b.tables[0].fields)).toEqual({ expr: "{fldPBudget} * 2", refs: ["fldPBudget"] });
  });
});

describe("importing a pack", () => {
  it("dry run writes nothing and predicts the impact", async () => {
    const before = await counts(owner.orgId);
    const r = await importPack(owner, loadPack(DIR), { apply: false });
    expect(await counts(owner.orgId)).toEqual(before);
    expect(r.mode).toBe("dry-run");
    expect(r.totals.records).toBe(5);
    expect(r.totals.recordsCreated).toBe(5);
    expect(r.totals.linksUnresolved).toBe(1);
    expect((await db.select().from(migrationMap).where(eq(migrationMap.orgId, owner.orgId))).length).toBe(0);
  });

  it("applies: records, two-way links, computed fields, lineage, forms, views, pages and disabled automations", async () => {
    const r = await importPack(owner, loadPack(DIR), { apply: true });
    const b = r.bases[0];
    expect(b.tables.map((t) => [t.sourceRecords, t.afterImport])).toEqual([[2, 2], [3, 3]]);
    expect(b.links.unresolved).toEqual([{ tableId: "tblSynProjects001", recordId: "recSynP2", fieldId: "fldPTasks", targetRecordId: "recSynGONE" }]);
    expect(b.links.resolved).toBe(6);

    const [projects] = await db.select().from(baseTables).where(eq(baseTables.baseId, b.targetBaseId!)).orderBy(baseTables.sortOrder);
    const v = await runView(owner, "owner", projects.id, {});
    const fid = (n: string) => v.fields.find((f) => f.name === n)!.id;
    const pilot = v.rows.find((x) => x.values[fid("Name")] === "Pilot")!;
    expect((pilot.values[fid("Tasks")] as { title: string }[]).map((x) => x.title).sort()).toEqual(["Edit", "Shoot"]);
    expect(pilot.values[fid("Task count")]).toBe(2);
    expect(pilot.values[fid("Double budget")]).toBe(2000);
    expect(pilot.values[fid("Hours")]).toEqual([30, 20]); // rollup recreated as lookup of the same values
    expect(pilot.values[fid("Odd formula")]).toBe("PILOT"); // unsupported formula → text snapshot
    expect(pilot.values[fid("Notes")]).toBe("**Bold** plan");
    expect(pilot.values[fid("Created by")]).toBe("Example Person <person@example.test>");
    expect(pilot.createdAt).toBe("2025-03-01T09:30:00.000Z"); // original creation time preserved natively
    const files = pilot.values[fid("Files")] as { filename: string; pendingTransfer: boolean }[];
    expect(files).toEqual([expect.objectContaining({ filename: "storyboard.pdf", pendingTransfer: true })]);
    expect(b.attachments.pendingTransfer).toBe(1);
    // Inverse link is wired to the other Airtable field, not a duplicate.
    const tasksField = v.fields.find((f) => f.name === "Tasks")!;
    const [inv] = await db.select().from(baseFields).where(eq(baseFields.id, tasksField.options.inverseFieldId!));
    expect(inv.name).toBe("Project");
    expect(inv.options.singleRecord).toBe(true);
    // Lineage.
    const [rec] = await db.select().from(baseRecords).where(eq(baseRecords.id, pilot.id));
    expect(rec.sourceRef).toBe("appSynthetic00001/tblSynProjects001/recSynP1");
    expect(b.formulaFidelity).toMatchObject({ fields: 1, matched: 2, mismatched: 0 });
    // Views: names/types only; unsupported "block" → grid with a warning.
    const views = await db.select().from(baseViews).where(eq(baseViews.tableId, projects.id));
    expect(views.map((x) => [x.name, x.type]).sort()).toEqual([["All projects", "grid"], ["Board", "kanban"], ["Gantt", "grid"]]);
    expect(views.every((x) => !x.config.filters && !x.config.sorts)).toBe(true);
    expect(b.warnings.some((w) => w.category === "view type fallback")).toBe(true);
    // Form view with required flags + help text; notes for flattened sections and prefill.
    expect(b.forms[0]).toMatchObject({ status: "form view created", elements: 3, mappedElements: 3 });
    expect(b.forms[0].notes.join(" ")).toMatch(/flattened.*|prefilled/);
    // Pages are inventoried, not invented.
    expect(b.pages.find((p) => p.sourceId === "pagSynDash")?.status).toMatch(/manual rebuild/);
    expect(b.pages.find((p) => p.sourceId === "pagSynForm1")?.status).toBe("imported as form view");
    // Automations: translatable ones created DISABLED; external-trigger one reported only.
    const autos = await db.select().from(baseAutomations).where(eq(baseAutomations.baseId, b.targetBaseId!));
    expect(autos).toHaveLength(2);
    expect(autos.every((a) => a.isEnabled === false)).toBe(true);
    const kickoff = autos.find((a) => a.name.includes("kickoff"))!;
    const branch = (kickoff.actions as { type: string; then: { type: string; linkFieldId?: string; values: Record<string, unknown> }[] }[])[0];
    expect(branch.type).toBe("branch");
    expect(branch.then[0].type).toBe("create_record");
    expect(branch.then[0].linkFieldId).toBeTruthy();
    expect(Object.values(branch.then[0].values)).toContain("Kickoff for {Name}");
    expect(b.automations.find((a) => a.sourceId === "wflSynExternal")).toMatchObject({ created: false });
    expect(b.automations.find((a) => a.sourceId === "wflSynMarkDone")!.untranslated).toContain("gmailSendEmail");
    expect(reportMarkdown(r)).toContain("pending transfer");
  });

  it("is idempotent: a rerun creates nothing and changes nothing", async () => {
    const before = await counts(owner.orgId);
    const r = await importPack(owner, loadPack(DIR), { apply: true });
    expect(await counts(owner.orgId)).toEqual(before);
    expect(r.totals).toMatchObject({ recordsCreated: 0, recordsUpdated: 0, recordsUnchanged: 5 });
    expect(r.bases[0].counts.tables.created).toBe(0);
    expect(r.bases[0].counts.fields.created).toBe(0);
    expect((await db.select().from(baseAutomations).where(eq(baseAutomations.baseId, r.bases[0].targetBaseId!))).length).toBe(2);
  });

  it("resumes: deleting a record's import and rerunning restores only that record", async () => {
    const [b] = await db.select().from(bases).where(and(eq(bases.orgId, owner.orgId), eq(bases.templateKey, "airtable:appSynthetic00001")));
    const tables = await db.select().from(baseTables).where(eq(baseTables.baseId, b.id));
    const tasks = tables.find((t) => t.name === "Tasks")!;
    await db.delete(baseRecords).where(and(eq(baseRecords.tableId, tasks.id), eq(baseRecords.sourceRef, "appSynthetic00001/tblSynTasks000001/recSynT3")));
    const r = await importPack(owner, loadPack(DIR), { apply: true });
    expect(r.totals).toMatchObject({ recordsCreated: 1, recordsUnchanged: 4 });
  });
});
