"use server";
/** Server actions for apps: builder (creator+) and runtime (viewer, re-validated from stored config). */
import { revalidatePath } from "next/cache";
import { requireContext } from "@/server/auth/request";
import { toResult } from "@/server/errors";
import type { AppConfig, Component, Page } from "@/lib/apps/types";
import * as A from "@/server/apps/apps";
import { componentData } from "@/server/apps/data";
import { runButton, submitAppForm, updateFromApp } from "@/server/apps/runtime-actions";
import { createInterfaceApp, type Layout } from "@/server/apps/presets";

const done = () => revalidatePath("/", "layout");

export async function createInterfaceAppAction(input: { baseId: string; name: string; layout: Layout; tableId?: string }) {
  return toResult(async () => { const a = await createInterfaceApp(await requireContext(), input); done(); return { id: a.id, slug: a.slug }; });
}
export async function createAppAction(input: { baseId: string; name: string; audience?: "workspace" | "portal" }) {
  return toResult(async () => { const a = await A.createApp(await requireContext(), input); done(); return { id: a.id, slug: a.slug }; });
}
export async function saveDraftAction(appId: string, config: AppConfig, revision: number) {
  return toResult(async () => A.saveDraft(await requireContext(), appId, config, revision));
}
export async function publishAppAction(appId: string, note?: string) {
  return toResult(async () => { const v = await A.publishApp(await requireContext(), appId, note); done(); return { version: v.version }; });
}
export async function rollbackAppAction(appId: string, versionId: string) {
  return toResult(async () => { const v = await A.rollbackApp(await requireContext(), appId, versionId); done(); return { version: v.version }; });
}
export async function listVersionsAction(appId: string) {
  return toResult(async () => (await A.listVersions(await requireContext(), appId)).map((v) => ({ ...v, publishedAt: v.publishedAt.toISOString() })));
}
export async function updateAppMetaAction(appId: string, patch: { name?: string; description?: string | null; icon?: string; color?: string }) {
  return toResult(async () => { await A.updateAppMeta(await requireContext(), appId, patch); done(); });
}
export async function archiveAppAction(appId: string) {
  return toResult(async () => { await A.archiveApp(await requireContext(), appId); done(); });
}

/** Builder live data: compute components from the *draft* the builder is editing (creator only). */
export async function previewDataAction(appId: string, page: Page, components: Component[], recordId?: string) {
  return toResult(async () => {
    const ctx = await requireContext();
    const { app, role } = await A.getAppForBuilder(ctx, appId);
    const rt = { app, config: app.draft as unknown as AppConfig, role: role as never, scopeIds: null };
    const out: Record<string, unknown> = {};
    for (const c of components.slice(0, 80)) out[c.id] = await componentData({ ctx, rt, page, recordId }, c);
    return out;
  });
}
/** Sample record ids for previewing detail pages in the builder. */
export async function sampleRecordsAction(appId: string, tableId: string) {
  return toResult(async () => {
    const ctx = await requireContext();
    const { app } = await A.getAppForBuilder(ctx, appId);
    const { runView } = await import("@/server/platform/query");
    const { cellText } = await import("@/lib/platform/cell-text");
    const { db } = await import("@/db"); const { baseTables } = await import("@/db/schema"); const { and, eq } = await import("drizzle-orm");
    const [t] = await db.select().from(baseTables).where(and(eq(baseTables.id, tableId), eq(baseTables.baseId, app.baseId))).limit(1);
    if (!t) throw new Error("Table not in this app's base.");
    const v = await runView(ctx, "owner", tableId, {}, {});
    const pf = v.fields.find((f) => f.id === t.primaryFieldId) ?? v.fields[0];
    return v.rows.slice(0, 30).map((r) => ({ id: r.id, title: cellText(pf, r.values[pf.id]) || "Unnamed" }));
  });
}

// ───────── Runtime ─────────
export async function appFormAction(slug: string, pageId: string, componentId: string, values: Record<string, unknown>, opts: { preview?: boolean; recordId?: string } = {}) {
  return toResult(async () => submitAppForm(await requireContext(), slug, pageId, componentId, values, opts));
}
export async function appUpdateAction(slug: string, pageId: string, componentId: string, recordId: string, values: Record<string, unknown>, preview = false) {
  return toResult(async () => updateFromApp(await requireContext(), slug, pageId, componentId, recordId, values, preview));
}
export async function appButtonAction(slug: string, pageId: string, componentId: string, recordId?: string, preview = false) {
  return toResult(async () => runButton(await requireContext(), slug, pageId, componentId, recordId, preview));
}
export async function appCommentAction(slug: string, pageId: string, componentId: string, recordId: string, body: string, preview = false) {
  return toResult(async () => {
    const ctx = await requireContext();
    const rt = await A.resolveRuntime(ctx, slug, preview);
    if (rt.role === "portal") throw new Error("Comments aren't available to clients.");
    const page = rt.config.pages.find((p) => p.id === pageId); const comp = page && A.findComponent(page, componentId);
    if (!page || !comp || comp.type !== "record" || !comp.props.showComments) throw new Error("Comments aren't enabled here.");
    const { addComment } = await import("@/server/platform/records");
    await addComment(ctx, recordId, body); return true;
  });
}

export async function createAppFromTemplateAction(key: string) {
  return toResult(async () => { const { createAppFromTemplate } = await import("@/server/apps/templates"); const r = await createAppFromTemplate(await requireContext(), key); done(); return r; });
}

// ───────── AI full-system planner ─────────
export async function planSystemAction(description: string, previous?: import("@/server/apps/ai-plan").Plan, change?: string) {
  return toResult(async () => {
    const ctx = await requireContext();
    if (!["owner", "creator"].includes(ctx.platformRole)) throw new Error("Only owners and creators can design systems.");
    const { planSystem } = await import("@/server/apps/ai-plan");
    return planSystem(description, previous, change);
  });
}
export async function applyPlanAction(plan: import("@/server/apps/ai-plan").Plan) {
  return toResult(async () => { const { applyPlan } = await import("@/server/apps/ai-plan"); const r = await applyPlan(await requireContext(), plan); done(); return r; });
}
