/** Base platform engine: formulas, links, lookups/rollups, views, type conversion, permissions. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { baseFields, baseRecords, memberships } from "@/db/schema";
import { evaluate, parse, toStored, toDisplay } from "@/lib/platform/formula";
import { createBaseFromSpec } from "@/server/platform/spec";
import { archiveField, createField, createView, loadBaseStructure, updateField, updateViewConfig } from "@/server/platform/schema";
import { addComment, createRecords, deleteRecords, recordHistory, updateRecord } from "@/server/platform/records";
import { runView } from "@/server/platform/query";
import { contextForUser } from "@/server/auth/sessions";
import { makeOrg, makeUser } from "../support/factory";
import type { Ctx } from "@/server/auth/context";

const asRole = async (ctx: Ctx, role: string) => { await db.update(memberships).set({ platformRole: role }).where(and(eq(memberships.userId, ctx.userId), eq(memberships.orgId, ctx.orgId))); return (await contextForUser(ctx.userId, ctx.orgId))!; };

describe("formula language", () => {
  const vals: Record<string, unknown> = { a: 3, b: 4, n: "Kim", d: "2028-01-31", tags: ["x", "y"] };
  const ev = (src: string) => evaluate(parse(src), (id) => vals[id], new Date("2028-02-10T12:00:00Z"));
  it("evaluates arithmetic, text, logic and dates", () => {
    expect(ev("{a} * {b} + 2")).toBe(14);
    expect(ev('"Hi " & UPPER({n})')).toBe("Hi KIM");
    expect(ev('IF({a} > 2, "big", "small")')).toBe("big");
    expect(ev("DATETIME_DIFF(TODAY(), {d}, 'days')")).toBe(10);
    expect(ev("DATETIME_FORMAT(DATEADD({d}, 1, 'months'), 'YYYY-MM-DD')")).toBe("2028-03-02");
    expect(ev("ROUND(10 / 3, 2)")).toBe(3.33);
    expect(ev("ARRAYJOIN({tags}, ' | ')")).toBe("x | y");
    expect(ev("{a} / 0")).toBeNull();
    expect(ev('SWITCH({n}, "Kim", 1, "Lee", 2, 0)')).toBe(1);
  });
  it("rejects bad syntax and unknown functions; maps names to ids", () => {
    expect(() => parse("{a} +")).toThrow();
    expect(() => parse("NOPE(1)")).toThrow(/Unknown function/);
    const f = [{ id: "f1", name: "Budget" }, { id: "f2", name: "Spent" }];
    expect(toStored("{Budget} - {Spent}", f)).toBe("{f1} - {f2}");
    expect(toDisplay("{f1} - {f2}", f)).toBe("{Budget} - {Spent}");
    expect(() => toStored("{Nope}", f)).toThrow(/Unknown field/);
  });
});

let owner: Ctx, baseId: string, T: Record<string, string>;
beforeAll(async () => {
  const org = await makeOrg("Platform");
  owner = await asRole(await makeUser(org.id, "org_admin"), "owner");
  const r = await createBaseFromSpec(owner, {
    name: "Studio", color: "purple", tables: [
      { name: "Projects", fields: [
        { name: "Name", type: "singleLineText" }, { name: "Budget", type: "currency" },
        { name: "Stage", type: "singleSelect", choices: ["Idea", "Shooting", "Done"] },
        { name: "Tasks", type: "link", linkTo: "Tasks", inverseName: "Project" },
        { name: "Task count", type: "count", via: "Tasks" },
        { name: "Hours", type: "rollup", via: "Tasks", target: "Hours", fn: "sum" },
        { name: "Owners", type: "lookup", via: "Tasks", target: "Owner" },
        { name: "Cost per hour", type: "formula", formula: "IF({Hours} > 0, ROUND({Budget} / {Hours}, 2), BLANK())" },
      ], records: [{ Name: "Pilot", Budget: 1000, Stage: "Shooting", Tasks: ["Shoot", "Edit"] }, { Name: "Promo", Budget: 500, Stage: "Idea" }] },
      { name: "Tasks", fields: [{ name: "Title", type: "singleLineText" }, { name: "Hours", type: "number" }, { name: "Owner", type: "singleLineText" }, { name: "Done", type: "checkbox" }],
        records: [{ Title: "Shoot", Hours: 30, Owner: "Ava" }, { Title: "Edit", Hours: 20, Owner: "Ben", Done: true }, { Title: "Grade", Hours: 5, Owner: "Cy" }] },
    ],
  });
  baseId = r.baseId; T = r.tableIds;
});
afterAll(async () => { await closeDb(); });

const fieldId = async (tableId: string, name: string) => (await db.select().from(baseFields).where(and(eq(baseFields.tableId, tableId), eq(baseFields.name, name), isNull(baseFields.archivedAt))))[0].id;
const rowsOf = async (ctx: Ctx, tableId: string, config = {}, role = "owner") => runView(ctx, role, tableId, config);

describe("links, lookups, rollups and formulas", () => {
  it("computes count, rollup, lookup and formula through two-way links", async () => {
    const v = await rowsOf(owner, T.Projects);
    const pilot = v.rows.find((r) => r.values[v.fields[0].id] === "Pilot")!;
    const val = (n: string) => pilot.values[v.fields.find((f) => f.name === n)!.id];
    expect(val("Task count")).toBe(2);
    expect(val("Hours")).toBe(50);
    expect((val("Owners") as string[]).sort()).toEqual(["Ava", "Ben"]);
    expect(val("Cost per hour")).toBe(20);
    expect((val("Tasks") as { title: string }[]).map((x) => x.title).sort()).toEqual(["Edit", "Shoot"]);
    // Inverse side shows the project.
    const tv = await rowsOf(owner, T.Tasks);
    const shoot = tv.rows.find((r) => r.values[tv.fields[0].id] === "Shoot")!;
    expect((shoot.values[await fieldId(T.Tasks, "Project")] as { title: string }[])[0].title).toBe("Pilot");
  });

  it("keeps both sides of a link in sync on update, delete and restore", async () => {
    const tasksField = await fieldId(T.Projects, "Tasks");
    const projectField = await fieldId(T.Tasks, "Project");
    const v = await rowsOf(owner, T.Projects);
    const promo = v.rows.find((r) => r.values[v.fields[0].id] === "Promo")!;
    const grade = (await rowsOf(owner, T.Tasks)).rows.find((r) => Object.values(r.values).includes("Grade"))!;
    await updateRecord(owner, promo.id, { [tasksField]: [grade.id] });
    const [g] = await db.select().from(baseRecords).where(eq(baseRecords.id, grade.id));
    expect(g.data[projectField]).toEqual([promo.id]);
    await deleteRecords(owner, [promo.id]);
    expect((await db.select().from(baseRecords).where(eq(baseRecords.id, grade.id)))[0].data[projectField]).toEqual([]);
    await deleteRecords(owner, [promo.id], true);
    expect((await db.select().from(baseRecords).where(eq(baseRecords.id, grade.id)))[0].data[projectField]).toEqual([promo.id]);
    const hist = await recordHistory(owner, promo.id);
    expect(hist.map((h) => h.action)).toEqual(["restore", "delete", "update", "create"]);
  });

  it("rejects circular formulas and invalid lookups", async () => {
    const a = await createField(owner, T.Tasks, { name: "A", type: "formula", options: { formula: "{Hours} * 2" } });
    await expect(createField(owner, T.Tasks, { name: "B", type: "formula", options: { formula: "{A} + {B}" } })).rejects.toThrow(/Unknown field|circular/);
    await createField(owner, T.Tasks, { name: "C", type: "formula", options: { formula: "{A} + 1" } });
    await expect(updateField(owner, a.id, { options: { formula: "{C} + 1" } })).rejects.toThrow(/circular/);
    await expect(createField(owner, T.Tasks, { name: "L", type: "lookup", options: { linkFieldId: await fieldId(T.Tasks, "Hours") } })).rejects.toThrow(/link field/);
  });
});

describe("views: filters, sorts, grouping, search, colours", () => {
  it("filters and sorts with type-aware semantics", async () => {
    const hours = await fieldId(T.Tasks, "Hours"); const done = await fieldId(T.Tasks, "Done"); const title = await fieldId(T.Tasks, "Title");
    const v = await rowsOf(owner, T.Tasks, { filters: { conjunction: "and", conditions: [{ fieldId: hours, op: ">=", value: 10 }, { fieldId: done, op: "isNotChecked" }] } });
    expect(v.rows.map((r) => r.values[title])).toEqual(["Shoot"]);
    const s = await rowsOf(owner, T.Tasks, { sorts: [{ fieldId: hours, dir: "desc" }] });
    expect(s.rows.map((r) => r.values[title])).toEqual(["Shoot", "Edit", "Grade"]);
    const or = await rowsOf(owner, T.Tasks, { filters: { conjunction: "or", conditions: [{ fieldId: title, op: "contains", value: "gra" }, { fieldId: done, op: "isChecked" }] } });
    expect(or.rows.length).toBe(2);
    const stage = await fieldId(T.Projects, "Stage");
    const col = await rowsOf(owner, T.Projects, { color: { mode: "select", fieldId: stage } });
    expect(col.rows.find((r) => Object.values(r.values).includes("Pilot"))!.color).toBeTruthy();
  });
});

describe("type conversion", () => {
  it("converts text to single select, creating choices from existing values", async () => {
    const owner2 = await fieldId(T.Tasks, "Owner");
    const f = await updateField(owner, owner2, { type: "singleSelect" });
    expect(((f.options as { choices: { name: string }[] }).choices).map((c) => c.name).sort()).toEqual(["Ava", "Ben", "Cy"]);
    const v = await rowsOf(owner, T.Tasks);
    expect(v.rows.every((r) => typeof r.values[owner2] === "string" && (r.values[owner2] as string).startsWith("sel"))).toBe(true);
  });
});

describe("permissions", () => {
  it("enforces workspace roles, table rules, field visibility and personal views", async () => {
    const editor = await asRole(await makeUser(owner.orgId, "producer"), "editor");
    const commenter = await asRole(await makeUser(owner.orgId, "crew"), "commenter");
    const reader = await asRole(await makeUser(owner.orgId, "cast"), "reader");
    const recId = (await rowsOf(owner, T.Tasks)).rows[0].id;
    const hours = await fieldId(T.Tasks, "Hours");
    await updateRecord(editor, recId, { [hours]: 31 });
    await expect(updateRecord(commenter, recId, { [hours]: 1 })).rejects.toThrow(/editor access/);
    await expect(updateRecord(reader, recId, { [hours]: 1 })).rejects.toThrow(/editor access/);
    await expect(addComment(reader, recId, "hi")).rejects.toThrow(/commenter/);
    expect((await addComment(commenter, recId, "Looks good")).body).toBe("Looks good");
    await expect(createField(editor, T.Tasks, { name: "X", type: "number" })).rejects.toThrow(/creator access/);
    // Field hidden from roles below editor; field editable only by creators.
    await updateField(owner, hours, { permissions: { hiddenBelow: "editor", edit: "creator" } });
    const rv = await runView(reader, "reader", T.Tasks, {});
    expect(rv.fields.some((f) => f.id === hours)).toBe(false);
    await expect(updateRecord(editor, recId, { [hours]: 2 })).rejects.toThrow(/can't edit/);
    // Personal view: commenter may create; others can't see it.
    const pv = await createView(commenter, T.Tasks, { name: "Mine", type: "grid", personal: true });
    await updateViewConfig(commenter, pv.id, { sorts: [{ fieldId: hours, dir: "asc" }] });
    expect((await loadBaseStructure(editor, baseId)).views.some((v) => v.id === pv.id)).toBe(false);
    await expect(createView(commenter, T.Tasks, { name: "Shared", type: "grid" })).rejects.toThrow(/creator/);
    // Table rule: deletes need creator.
    const { updateTable } = await import("@/server/platform/schema");
    await updateTable(owner, T.Tasks, { permissions: { delete: "creator" } });
    await expect(deleteRecords(editor, [recId])).rejects.toThrow(/creator access/);
    await expect(createRecords(reader, T.Tasks, [{}])).rejects.toThrow(/editor access/);
    await expect(archiveField(editor, hours)).rejects.toThrow(/creator access/);
  });
});

describe("templates", () => {
  it("every template builds a valid, linked base", async () => {
    const { TEMPLATES, templateSpec } = await import("@/server/platform/templates");
    for (const t of TEMPLATES) {
      const r = await createBaseFromSpec(owner, templateSpec(t.key));
      for (const tid of Object.values(r.tableIds)) await runView(owner, "owner", tid, {});
    }
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(8);
  });
  it("seed values on auto-created inverse links are linked both ways and roll up", async () => {
    const { templateSpec } = await import("@/server/platform/templates");
    const r = await createBaseFromSpec(owner, templateSpec("projects"));
    const v = await runView(owner, "owner", r.tableIds.Projects, {});
    const byName = (n: string) => v.fields.find((f) => f.name === n)!.id;
    const row = v.rows[0];
    expect((row.values[byName("Tasks")] as unknown[]).length).toBe(2);
    expect(row.values[byName("Task count")]).toBe(2);
    expect(row.values[byName("Done tasks")]).toBe(1);
    expect(row.values[byName("Progress")]).toBe(0.5);
  });
});
