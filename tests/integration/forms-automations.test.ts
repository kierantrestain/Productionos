/**
 * Forms 2.0 (conditional logic, pages, prefill, closing), the "form submitted" trigger and the
 * "notify people" action, and the interface filter bar — all enforced on the server.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { baseViews, memberships, recordComments } from "@/db/schema";
import { contextForUser } from "@/server/auth/sessions";
import { createBaseFromSpec } from "@/server/platform/spec";
import { loadBaseStructure, updateView } from "@/server/platform/schema";
import { loadPublicForm, submitPublicForm } from "@/server/platform/public-form";
import { runView } from "@/server/platform/query";
import { createRecords } from "@/server/platform/records";
import { saveAutomation } from "@/server/platform/automations";
import { drainOutbox } from "@/server/workflows/engine";
import { cleanAnswers, formClosed, missingRequired, pagesOf, prefillFrom, visibleItems, type FormItem } from "@/lib/platform/form-logic";
import { createInterfaceApp } from "@/server/apps/presets";
import { componentData } from "@/server/apps/data";
import { findPage, publishApp, resolveRuntime } from "@/server/apps/apps";
import type { Ctx } from "@/server/auth/context";
import { makeOrg, makeUser } from "../support/factory";

let owner: Ctx; let editor: Ctx; let orgId: string; let baseId: string; let T: Record<string, string>; let F: Record<string, string>; let choice: Record<string, string>;
const asRole = async (ctx: Ctx, role: string) => { await db.update(memberships).set({ platformRole: role }).where(and(eq(memberships.userId, ctx.userId), eq(memberships.orgId, ctx.orgId))); return (await contextForUser(ctx.userId, ctx.orgId))!; };

beforeAll(async () => {
  const org = await makeOrg("Forms"); orgId = org.id;
  owner = await asRole(await makeUser(org.id, "org_admin"), "owner");
  editor = await asRole(await makeUser(org.id, "production_manager"), "editor");
  const r = await createBaseFromSpec(owner, { name: "Intake", tables: [
    { name: "Requests", fields: [{ name: "Title", type: "singleLineText" }, { name: "Kind", type: "singleSelect", choices: ["Bug", "Idea"] }, { name: "Steps", type: "longText" }, { name: "Urgent", type: "checkbox" }],
      records: [{ Title: "Old bug", Kind: "Bug" }, { Title: "Old idea", Kind: "Idea" }, { Title: "Another idea", Kind: "Idea" }] },
  ] });
  baseId = r.baseId; T = r.tableIds;
  const st = await loadBaseStructure(owner, baseId);
  F = Object.fromEntries(st.fields.filter((f) => f.tableId === T.Requests).map((f) => [f.name, f.id]));
  choice = Object.fromEntries((st.fields.find((f) => f.id === F.Kind)!.options.choices ?? []).map((c) => [c.name, c.id]));
});
afterAll(async () => { await closeDb(); });

describe("form logic (pure)", () => {
  const items: FormItem[] = [{ fieldId: "kind", required: true }, { fieldId: "steps", required: true, showIf: { fieldId: "kind", op: "is", value: "bug" } }, { fieldId: "note", pageBreak: true, showIf: { fieldId: "steps", op: "isNotEmpty" } }];
  it("shows questions only when their condition holds (and chains through hidden questions)", () => {
    expect([...visibleItems(items, { kind: "idea" })]).toEqual(["kind"]);
    expect([...visibleItems(items, { kind: "bug", steps: "1. open" })]).toEqual(["kind", "steps", "note"]);
    expect([...visibleItems(items, { kind: "idea", steps: "stale" })]).toEqual(["kind"]); // note hidden because steps is hidden
  });
  it("required only applies to visible questions; hidden answers are dropped; pages split at breaks", () => {
    expect(missingRequired(items, { kind: "idea" })).toHaveLength(0);
    expect(missingRequired(items, { kind: "bug" }).map((x) => x.fieldId)).toEqual(["steps"]);
    expect(cleanAnswers(items, { kind: "idea", steps: "leaked" })).toEqual({ kind: "idea" });
    expect(pagesOf(items).map((p) => p.map((x) => x.fieldId))).toEqual([["kind", "steps"], ["note"]]);
  });
  it("prefill matches names and choices; closing by flag or date", () => {
    expect(prefillFrom({ prefill_Kind: "Idea", "prefill_Your+name": "Sam", other: "x" }, [{ fieldId: "k", name: "Kind", type: "singleSelect", choices: [{ id: "c1", name: "Idea" }] }, { fieldId: "n", name: "Your name", type: "singleLineText" }])).toEqual({ k: "c1", n: "Sam" });
    expect(formClosed({ closed: true })).toBe(true);
    expect(formClosed({ closesAt: new Date(Date.now() - 1000).toISOString() })).toBe(true);
    expect(formClosed({ closesAt: new Date(Date.now() + 864e5).toISOString() })).toBe(false);
  });
});

describe("public forms, form trigger and notify action", () => {
  it("server enforces conditional required + drops hidden answers; closed forms refuse; submissions trigger automations that notify", async () => {
    const [v] = await db.insert(baseViews).values({ orgId, tableId: T.Requests, name: "Report", type: "form", createdBy: owner.userId, config: { form: { fields: [
      { fieldId: F.Title, required: true }, { fieldId: F.Kind, required: true }, { fieldId: F.Steps, required: true, showIf: { fieldId: F.Kind, op: "is", value: choice.Bug } },
    ] } } }).returning();
    const token = (await updateView(owner, v.id, { share: true })).shareToken!;
    await saveAutomation(owner, baseId, { name: "Notify on form", isEnabled: true, trigger: { type: "form_submitted", tableId: T.Requests, formViewId: v.id },
      actions: [{ type: "notify", userIds: [editor.userId], message: "New request: {Title}" }] });
    await expect(submitPublicForm(token, { [F.Title]: "Crash", [F.Kind]: choice.Bug })).rejects.toThrow(/Steps is required/);
    const idea = await submitPublicForm(token, { [F.Title]: "Dark mode", [F.Kind]: choice.Idea, [F.Steps]: "should be dropped" });
    const row = (await runView(owner, "owner", T.Requests, {}, { recordIds: [idea.id] })).rows[0];
    expect(row.values[F.Steps] ?? null).toBeNull();
    // a record added in the grid must NOT fire the form trigger
    await createRecords(owner, T.Requests, [{ [F.Title]: "Grid entry" }]);
    await drainOutbox({ orgId, budgetMs: 20_000 }); await drainOutbox({ orgId, budgetMs: 20_000 });
    const notes = await db.select().from(recordComments).where(eq(recordComments.orgId, orgId));
    expect(notes).toHaveLength(1);
    expect(notes[0].recordId).toBe(idea.id);
    expect(notes[0].mentions).toEqual([editor.userId]);
    expect(notes[0].body).toContain("New request: Dark mode");
    await db.update(baseViews).set({ config: { form: { ...(v.config.form ?? {}), fields: v.config.form!.fields, closed: true } } }).where(eq(baseViews.id, v.id));
    expect((await loadPublicForm(token)).form.closed).toBe(true);
    await expect(submitPublicForm(token, { [F.Title]: "Late", [F.Kind]: choice.Idea })).rejects.toThrow(/closed/);
  });
  it("notify refuses people outside the workspace", async () => {
    const outsider = await makeUser((await makeOrg("Other")).id, "crew");
    await expect(saveAutomation(owner, baseId, { name: "Bad", trigger: { type: "record_created", tableId: T.Requests }, actions: [{ type: "notify", userIds: [outsider.userId], message: "hi" }] })).rejects.toThrow(/members of this workspace/);
  });
});

describe("interface filter bar", () => {
  it("URL filters narrow every component on the same table; unknown fields are ignored", async () => {
    const a = await createInterfaceApp(owner, { baseId, name: "Requests board", layout: "dashboard", tableId: T.Requests });
    await publishApp(owner, a.id);
    const rt = await resolveRuntime(owner, a.slug, false);
    const page = findPage(rt)!;
    expect(page.components.some((c) => c.type === "filter")).toBe(true);
    const kpi = page.components.find((c) => c.type === "kpi")!;
    const all = await componentData({ ctx: owner, rt, page }, kpi);
    const ideas = await componentData({ ctx: owner, rt, page, pageFilters: { [F.Kind]: choice.Idea } }, kpi);
    const bogus = await componentData({ ctx: owner, rt, page, pageFilters: { "not-a-field": "x" } }, kpi);
    expect(all.kind === "kpi" && ideas.kind === "kpi" && bogus.kind === "kpi").toBe(true);
    if (all.kind === "kpi" && ideas.kind === "kpi" && bogus.kind === "kpi") { expect(ideas.value).toBeLessThan(all.value); expect(ideas.value).toBeGreaterThan(0); expect(bogus.value).toBe(all.value); }
    const searched = await componentData({ ctx: owner, rt, page, pageFilters: { q: "dark" } }, kpi);
    expect(searched.kind === "kpi" && searched.value).toBe(1);
  });
});
