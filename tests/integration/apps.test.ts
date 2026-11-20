/**
 * App builder platform: the SAME generic engine builds Agency CRM, Production OS and Client Portal.
 * Covers fixture-exact KPIs, publish/versions/rollback, draft conflicts, cross-base binding, role and
 * component visibility, server-side action re-validation and portal scoping (positive + negative).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { memberships } from "@/db/schema";
import { contextForUser } from "@/server/auth/sessions";
import { createUserWithMembership } from "@/server/services/admin";
import { createApp, findPage, listVersions, publishApp, resolveRuntime, rollbackApp, saveDraft, getAppForBuilder } from "@/server/apps/apps";
import { componentData } from "@/server/apps/data";
import { runButton, submitAppForm, updateFromApp } from "@/server/apps/runtime-actions";
import { createAppFromTemplate } from "@/server/apps/templates";
import { createBaseFromSpec } from "@/server/platform/spec";
import { runView } from "@/server/platform/query";
import type { AppConfig } from "@/lib/apps/types";
import type { Ctx } from "@/server/auth/context";
import { makeOrg, makeUser } from "../support/factory";

let owner: Ctx; let reader: Ctx; let editor: Ctx; let portal: Ctx; let orgId: string;
const asRole = async (ctx: Ctx, role: string) => { await db.update(memberships).set({ platformRole: role }).where(and(eq(memberships.userId, ctx.userId), eq(memberships.orgId, ctx.orgId))); return (await contextForUser(ctx.userId, ctx.orgId))!; };
async function pageData(ctx: Ctx, slug: string, pageSlug?: string, recordId?: string, preview = false) {
  const rt = await resolveRuntime(ctx, slug, preview);
  const page = findPage(rt, pageSlug)!;
  const out: Record<string, Awaited<ReturnType<typeof componentData>>> = {};
  for (const c of page.components) out[c.props.title ?? c.type + c.id] = await componentData({ ctx, rt, page, recordId }, c);
  return { rt, page, out };
}

beforeAll(async () => {
  const org = await makeOrg("Apps"); orgId = org.id;
  owner = await asRole(await makeUser(org.id, "org_admin"), "owner");
  editor = await asRole(await makeUser(org.id, "production_manager"), "editor");
  reader = await asRole(await makeUser(org.id, "crew"), "reader");
  const u = await createUserWithMembership({ orgId, email: "client-portal@demo.productionos.test", name: "Portal Client", role: "external_reviewer" });
  portal = await asRole((await contextForUser(u.id, orgId))!, "portal");
});
afterAll(async () => { await closeDb(); });

describe("Agency CRM template on the generic builder", () => {
  let slug = "";
  it("creates base + automation + published app; KPIs match the fixture exactly", async () => {
    const r = await createAppFromTemplate(owner, "agency-crm"); slug = r.slug;
    const { out, rt } = await pageData(owner, slug);
    expect(rt.versionLabel).toBe("v1");
    expect(out["Open deals"]).toEqual({ kind: "kpi", value: 6, count: 6 });
    expect(out["Pipeline value"]).toMatchObject({ value: 99000 });
    expect(out["Won"]).toMatchObject({ value: 54000 });
    expect(out["Avg. deal cycle"]).toMatchObject({ value: 28.5 });
    const chart = out["Deals by stage"] as { kind: "series"; series: { label: string; value: number }[] };
    expect(chart.series.map((s) => `${s.label}:${s.value}`)).toEqual(["Qualified:20000", "Proposal:46000", "Negotiation:33000", "Won:54000"]);
    expect((out["Active deals"] as { rows: unknown[] }).rows).toHaveLength(6);
  });
  it("detail page, button action and automation run end to end; readers are refused writes", async () => {
    const rt = await resolveRuntime(owner, slug);
    const deal = rt.config.pages.find((p) => p.slug === "deal")!;
    const v = await runView(owner, "owner", deal.tableId!, {}, {});
    const horizon = v.rows.find((x) => Object.values(x.values).includes("Horizon Rebrand"))!;
    const btn = deal.components.find((c) => c.type === "button")!;
    await expect(runButton(reader, slug, deal.id, btn.id, horizon.id)).rejects.toThrow(/not available|editor/i);
    await runButton(editor, slug, deal.id, btn.id, horizon.id);
    const { drainOutbox } = await import("@/server/workflows/engine");
    await drainOutbox({ orgId, budgetMs: 15_000 });
    const { out } = await pageData(owner, slug, "deal", horizon.id);
    const rec = Object.values(out).find((d) => d.kind === "record") as { kind: "record"; related: { name: string; rows: { title: string }[] }[] };
    expect(rec.related.find((r) => r.name === "Activity")!.rows.map((x) => x.title)).toContain("Deal won — Horizon Rebrand (£22,000)");
  });
  it("hidden pages/components are refused server-side, and stored config wins over tampering", async () => {
    const rt = await resolveRuntime(reader, slug);
    expect(rt.config.pages.length).toBeGreaterThan(0);
    expect(findPage(rt, "new-deal")).toBeUndefined(); // visibleTo editor
    const newDeal = rt.config.pages.find((p) => p.slug === "new-deal")!;
    await expect(submitAppForm(reader, slug, newDeal.id, newDeal.components[0].id, {})).rejects.toThrow(/not available/);
    const dash = findPage(rt)!;
    const kanban = dash.components.find((c) => c.type === "kanban")!;
    const anyDeal = (await runView(owner, "owner", kanban.props.data!.tableId, {}, {})).rows[0];
    // A kanban may only move the stage field — anything else is rejected even if the client sends it.
    await expect(updateFromApp(editor, slug, dash.id, kanban.id, anyDeal.id, { [kanban.props.fieldIds![0]]: 1 })).rejects.toThrow(/Moving cards/);
  });
});

describe("drafts, publish, versions and rollback", () => {
  it("autosave detects conflicts; publish is immutable; rollback republishes", async () => {
    const b = await createBaseFromSpec(owner, { name: "Ops", tables: [{ name: "Tickets", fields: [{ name: "Ticket", type: "singleLineText" }], records: [{ Ticket: "A" }, { Ticket: "B" }] }] });
    const app = await createApp(owner, { baseId: b.baseId, name: "Ops hub" });
    const tableId = b.tableIds.Tickets;
    const cfg = (title: string): AppConfig => ({ homePageId: "p1", pages: [{ id: "p1", title, slug: "home", kind: "dashboard", components: [{ id: "k", type: "kpi", w: 3, props: { title: "Tickets", agg: "count", data: { tableId } } }] }] });
    const s1 = await saveDraft(owner, app.id, cfg("One"), app.draftRevision);
    await expect(saveDraft(owner, app.id, cfg("Stale"), app.draftRevision)).rejects.toThrow(/Someone else/);
    await publishApp(owner, app.id, "first");
    await saveDraft(owner, app.id, cfg("Two"), s1.revision);
    expect(findPage(await resolveRuntime(owner, app.slug))!.title).toBe("One"); // published unchanged by drafts
    expect(findPage(await resolveRuntime(owner, app.slug, true))!.title).toBe("Two"); // preview shows draft
    await expect(resolveRuntime(reader, app.slug, true)).rejects.toThrow(/Only creators/);
    await publishApp(owner, app.id, "second");
    const versions = await listVersions(owner, app.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    await rollbackApp(owner, app.id, versions[1].id);
    expect(findPage(await resolveRuntime(owner, app.slug))!.title).toBe("One");
    expect((await listVersions(owner, app.id))[0].version).toBe(3);
    const { out } = await pageData(owner, app.slug);
    expect(out.Tickets).toMatchObject({ kind: "kpi", value: 2 });
  });
  it("refuses components bound to another base's table", async () => {
    const a = await createBaseFromSpec(owner, { name: "A", tables: [{ name: "T", fields: [{ name: "N", type: "singleLineText" }] }] });
    const other = await createBaseFromSpec(owner, { name: "B", tables: [{ name: "Secret", fields: [{ name: "N", type: "singleLineText" }] }] });
    const app = await createApp(owner, { baseId: a.baseId, name: "Leak test" });
    const bad: AppConfig = { pages: [{ id: "p", title: "P", slug: "p", kind: "dashboard", components: [{ id: "c", type: "table", w: 12, props: { data: { tableId: other.tableIds.Secret } } }] }] };
    await expect(saveDraft(owner, app.id, bad, (await getAppForBuilder(owner, app.id)).app.draftRevision)).rejects.toThrow(/outside this app's base/);
  });
});

describe("Client portal scoping", () => {
  let slug = "";
  it("portal visitors only see their own records; other clients' records are refused", async () => {
    slug = (await createAppFromTemplate(owner, "client-portal")).slug;
    const { out, rt } = await pageData(portal, slug);
    expect(rt.role).toBe("portal");
    expect(rt.scopeIds).toHaveLength(1);
    expect(out["Active projects"]).toMatchObject({ value: 2 });
    expect(out["Amount due"]).toMatchObject({ value: 8000 });
    const projects = out["Your projects"] as { rows: { id: string; values: Record<string, unknown> }[] };
    expect(projects.rows).toHaveLength(2);
    // Another client's project: detail page must refuse it.
    const all = await runView(owner, "owner", rt.config.pages.find((p) => p.slug === "project")!.tableId!, {}, {});
    const theirs = all.rows.find((r) => !projects.rows.some((p) => p.id === r.id))!;
    const detail = rt.config.pages.find((p) => p.slug === "project")!;
    const { assertRecordInScope } = await import("@/server/apps/data");
    await expect(assertRecordInScope({ ctx: portal, rt, page: detail }, detail.tableId!, theirs.id)).rejects.toThrow(/isn't available/);
    await expect(assertRecordInScope({ ctx: portal, rt, page: detail }, detail.tableId!, projects.rows[0].id)).resolves.toBeUndefined();
  });
  it("portal forms are stamped with the visitor's client; portal users can't open the workspace base or other apps", async () => {
    const rt = await resolveRuntime(portal, slug);
    const home = findPage(rt)!;
    const form = home.components.find((c) => c.type === "form")!;
    const reqField = form.props.fieldIds![0];
    const { id } = await submitAppForm(portal, slug, home.id, form.id, { [reqField]: "Please add subtitles" });
    const rows = await runView(owner, "owner", form.props.data!.tableId, {}, { recordIds: [id] });
    const link = rows.rows[0].values[form.props.data!.scopeLinkFieldId!] as { id: string }[];
    expect(link.map((x) => x.id)).toEqual(rt.scopeIds);
    const { baseAccess } = await import("@/server/platform/access");
    await expect(baseAccess(portal, rt.app.baseId)).rejects.toThrow();
    const crm = await createAppFromTemplate(owner, "agency-crm");
    await expect(resolveRuntime(portal, crm.slug)).rejects.toThrow(/not found/i);
  });
});

describe("Production OS template", () => {
  it("is built by the same engine and renders with role-gated pages", async () => {
    const r = await createAppFromTemplate(owner, "production-os");
    const { out } = await pageData(owner, r.slug);
    expect(out.Productions).toMatchObject({ kind: "kpi", value: 1 });
    expect(out.Scenes).toMatchObject({ kind: "kpi", value: 1 });
    const rt = await resolveRuntime(reader, r.slug);
    expect(findPage(rt, "budget")).toBeUndefined();
    expect(findPage(rt, "productions")).toBeDefined();
  });
});

describe("AI full-system planner (MOCK-ONLY model)", () => {
  it("plans, flags inconsistencies, revises, and applies through the shared builder path", async () => {
    const { __setAiClient } = await import("@/server/platform/ai");
    const { planSystem, applyPlan, checkPlan } = await import("@/server/apps/ai-plan");
    const comp = (o: Record<string, unknown>) => ({ width: 12, title: "", table: "", aggregation: "count", field: "", groupBy: "", chart: "bar", format: "number", fields: [], filter: [], relatedVia: "", opensPage: "", text: "", buttonAction: "none", buttonPage: "", buttonSet: [], ...o });
    const plan = (bad: boolean) => ({
      name: "Studio Ops", description: "Fictional demo", color: "purple", summary: "Jobs and crew.",
      tables: [
        { name: "Jobs", description: "", fields: [{ name: "Job", type: "singleLineText", choices: [], linkTo: "", via: "", target: "", fn: "", formula: "" }, { name: "Status", type: "singleSelect", choices: ["Open", "Done"], linkTo: "", via: "", target: "", fn: "", formula: "" }, { name: "Fee", type: "currency", choices: [], linkTo: "", via: "", target: "", fn: "", formula: "" }], sampleRows: [[{ field: "Job", value: "Example shoot" }, { field: "Status", value: "Open" }, { field: "Fee", value: "1200" }]] },
        { name: "Crew", description: "", fields: [{ name: "Name", type: "singleLineText", choices: [], linkTo: "", via: "", target: "", fn: "", formula: "" }, { name: "Job", type: "link", choices: [], linkTo: "Jobs", via: "", target: "", fn: "", formula: "" }], sampleRows: [[{ field: "Name", value: "Example camera op" }, { field: "Job", value: "Example shoot" }]] },
      ],
      pages: [
        { key: "home", title: "Dashboard", heading: "Studio Ops", icon: "dashboard", kind: "dashboard", table: "", components: [comp({ type: "kpi", width: 3, title: "Open jobs", table: "Jobs", filter: [{ field: "Status", op: "is", value: "Open" }] }), comp({ type: "kpi", width: 3, title: "Fees", table: "Jobs", aggregation: "sum", field: bad ? "Revenue" : "Fee", format: "currency" }), comp({ type: "table", title: "Jobs", table: "Jobs", fields: ["Job", "Status"], opensPage: "job" })] },
        { key: "job", title: "Job", heading: "", icon: "file", kind: "detail", table: "Jobs", components: [comp({ type: "record", title: "Job" }), comp({ type: "table", title: "Crew", table: "Crew", fields: ["Name"], relatedVia: "Job" })] },
      ],
      automations: [{ name: "Comment on done", table: "Jobs", when: "record_updated", watchField: "Status", filter: [], action: "add_comment", comment: "{Job} done", createIn: "", linkVia: "", set: [] }],
    });
    let call = 0; const prompts: string[] = [];
    __setAiClient({ messages: { parse: async (body: { messages: { content: string }[] }) => { prompts.push(body.messages.at(-1)!.content); call++; return { stop_reason: "end_turn", parsed_output: plan(call === 1) }; } } });
    const r = await planSystem("A studio operations system");
    expect(call).toBe(2); // first plan had a bad field reference → one automatic repair round
    expect(prompts[1]).toMatch(/unknown field “Jobs.Revenue”/);
    expect(checkPlan(r.plan)).toEqual([]);
    const rev = await planSystem("A studio operations system", r.plan, "Add a Fee KPI");
    expect(prompts.at(-1)).toMatch(/Revise the plan with this change/);
    const built = await applyPlan(owner, rev.plan);
    const { out } = await pageData(owner, built.slug);
    expect(out["Open jobs"]).toMatchObject({ value: 1 });
    expect(out.Fees).toMatchObject({ value: 1200 });
    const rt = await resolveRuntime(owner, built.slug);
    const job = rt.config.pages.find((p) => p.slug === "job")!;
    const jobId = ((out.Jobs as { rows: { id: string }[] }).rows[0]).id;
    const detail = await componentData({ ctx: owner, rt, page: job, recordId: jobId }, job.components[1]);
    expect((detail as { rows: unknown[] }).rows).toHaveLength(1);
    const { listAutomations } = await import("@/server/platform/automations");
    expect((await listAutomations(owner, built.baseId)).every((a) => !a.isEnabled)).toBe(true);
    __setAiClient(null);
  });
});
