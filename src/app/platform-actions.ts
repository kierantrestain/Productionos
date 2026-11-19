"use server";
/**
 * Server actions for the base platform. Every call resolves the session server-side and goes through
 * permission-checked services; results are serialisable ActionResults.
 */
import { revalidatePath } from "next/cache";
import { requireContext } from "@/server/auth/request";
import { toResult } from "@/server/errors";
import * as S from "@/server/platform/schema";
import * as R from "@/server/platform/records";
import { runView, searchTitles } from "@/server/platform/query";
import type { ViewConfig } from "@/db/schema";
import type { FieldOptions, FieldType } from "@/lib/platform/fields";
import { kickOutbox } from "@/server/workflows/engine";

const done = () => revalidatePath("/", "layout");

// ───────────── Bases / tables ─────────────
export async function createBaseAction(input: { name: string; icon?: string; color?: string }) {
  return toResult(async () => { const b = await S.createBase(await requireContext(), input); done(); return { id: b.id }; });
}
export async function createBaseFromTemplateAction(key: string, name?: string) {
  return toResult(async () => {
    const ctx = await requireContext();
    const { templateSpec } = await import("@/server/platform/templates");
    const { createBaseFromSpec } = await import("@/server/platform/spec");
    const spec = templateSpec(key); if (name?.trim()) spec.name = name.trim();
    const r = await createBaseFromSpec(ctx, spec); done(); return { id: r.baseId };
  });
}
export async function updateBaseAction(baseId: string, patch: { name?: string; icon?: string; color?: string; description?: string | null }) {
  return toResult(async () => { await S.updateBase(await requireContext(), baseId, patch); done(); });
}
export async function archiveBaseAction(baseId: string) {
  return toResult(async () => { await S.archiveBase(await requireContext(), baseId); done(); });
}
export async function createTableAction(baseId: string, name: string) {
  return toResult(async () => { const t = await S.createTable(await requireContext(), baseId, name); done(); return { id: t.id }; });
}
export async function updateTableAction(tableId: string, patch: Parameters<typeof S.updateTable>[2]) {
  return toResult(async () => { await S.updateTable(await requireContext(), tableId, patch); done(); });
}
export async function archiveTableAction(tableId: string) {
  return toResult(async () => { await S.archiveTable(await requireContext(), tableId); done(); });
}

// ───────────── Fields ─────────────
export async function createFieldAction(tableId: string, input: { name: string; type: FieldType; options?: FieldOptions; description?: string | null; afterFieldId?: string }) {
  return toResult(async () => { const f = await S.createField(await requireContext(), tableId, input); done(); return { id: f.id }; });
}
export async function updateFieldAction(fieldId: string, patch: Parameters<typeof S.updateField>[2]) {
  return toResult(async () => { await S.updateField(await requireContext(), fieldId, patch); done(); });
}
export async function archiveFieldAction(fieldId: string) {
  return toResult(async () => { await S.archiveField(await requireContext(), fieldId); done(); });
}
export async function reorderFieldsAction(tableId: string, ids: string[]) {
  return toResult(async () => { await S.reorderFields(await requireContext(), tableId, ids); done(); });
}

// ───────────── Views ─────────────
export async function createViewAction(tableId: string, input: { name: string; type: string; personal?: boolean; copyFromViewId?: string }) {
  return toResult(async () => { const v = await S.createView(await requireContext(), tableId, input); done(); return { id: v.id }; });
}
export async function updateViewConfigAction(viewId: string, patch: ViewConfig) {
  return toResult(async () => S.updateViewConfig(await requireContext(), viewId, patch));
}
export async function updateViewAction(viewId: string, patch: Parameters<typeof S.updateView>[2]) {
  return toResult(async () => { const v = await S.updateView(await requireContext(), viewId, patch); done(); return { shareToken: v.shareToken }; });
}
export async function archiveViewAction(viewId: string) {
  return toResult(async () => { await S.archiveView(await requireContext(), viewId); done(); });
}
/** Fresh computed rows for a view (after edits, or with a search term). */
export async function loadViewAction(viewId: string, search?: string) {
  return toResult(async () => {
    const ctx = await requireContext();
    const { view, access } = await S.viewContext(ctx, viewId);
    const r = await runView(ctx, access.role, view.tableId, view.config, { search });
    const counts = await R.commentCounts(ctx, r.rows.map((x) => x.id));
    return { rows: r.rows, total: r.total, commentCounts: counts };
  });
}

// ───────────── Records ─────────────
export async function createRecordsAction(tableId: string, rows: Record<string, unknown>[], afterRecordId?: string) {
  return toResult(async () => { const ctx = await requireContext(); const ids = await R.createRecords(ctx, tableId, rows, { afterRecordId }); await kickOutbox(ctx.orgId); return ids; });
}
export async function updateCellsAction(cells: { recordId: string; fieldId: string; value: unknown }[]) {
  return toResult(async () => { const ctx = await requireContext(); const n = await R.updateCells(ctx, cells); await kickOutbox(ctx.orgId); return n; });
}
export async function updateRecordAction(recordId: string, patch: Record<string, unknown>) {
  return toResult(async () => { const ctx = await requireContext(); const r = await R.updateRecord(ctx, recordId, patch); await kickOutbox(ctx.orgId); return { version: r.version }; });
}
export async function deleteRecordsAction(ids: string[], restore = false) {
  return toResult(async () => R.deleteRecords(await requireContext(), ids, restore));
}
export async function setRowColorAction(ids: string[], color: string | null) {
  return toResult(async () => R.setRowColor(await requireContext(), ids, color));
}
export async function moveRecordAction(recordId: string, beforeId: string | null, afterId: string | null) {
  return toResult(async () => R.moveRecord(await requireContext(), recordId, beforeId, afterId));
}
export async function searchLinkAction(tableId: string, q: string) {
  return toResult(async () => { const ctx = await requireContext(); await S.tableContext(ctx, tableId); return searchTitles(ctx, tableId, q); });
}
export async function recordDetailAction(tableId: string, recordId: string) {
  return toResult(async () => {
    const ctx = await requireContext();
    const { access } = await S.tableContext(ctx, tableId);
    const r = await runView(ctx, access.role, tableId, {}, { recordIds: [recordId] });
    const [comments, history] = await Promise.all([R.listComments(ctx, recordId), R.recordHistory(ctx, recordId)]);
    return { row: r.rows[0] ?? null, comments: comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString(), editedAt: c.editedAt?.toISOString() ?? null })), history };
  });
}
export async function addCommentAction(recordId: string, body: string) {
  return toResult(async () => { const c = await R.addComment(await requireContext(), recordId, body); return { id: c.id }; });
}
export async function deleteCommentAction(id: string) {
  return toResult(async () => R.deleteComment(await requireContext(), id));
}

// ───────────── Import ─────────────
/** Import a CSV/Excel file as a new base, or as a new table in an existing base. */
export async function importSpreadsheetAction(form: FormData) {
  return toResult(async () => {
    const ctx = await requireContext();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a CSV or Excel file.");
    if (file.size > 20 * 1024 * 1024) throw new Error("Files must be 20 MB or smaller.");
    const { parseCsv, parseXlsx, inferTable } = await import("@/server/platform/importer");
    const { createBaseFromSpec } = await import("@/server/platform/spec");
    const buf = Buffer.from(await file.arrayBuffer());
    const rows = /\.xlsx$/i.test(file.name) ? await parseXlsx(buf) : parseCsv(buf.toString("utf8"));
    const name = String(form.get("name") || file.name.replace(/\.(csv|xlsx|tsv|txt)$/i, ""));
    const table = inferTable(name, rows);
    const baseId = String(form.get("baseId") || "");
    const r = await createBaseFromSpec(ctx, { name, icon: "database", color: "teal", tables: [table] }, baseId ? { intoBaseId: baseId } : {});
    done();
    return { baseId: r.baseId, tableId: Object.values(r.tableIds)[0], rows: table.records?.length ?? 0, fields: table.fields.length };
  });
}

// ───────────── AI ─────────────
export async function aiStatusAction() {
  const { aiConfigured } = await import("@/server/platform/ai");
  return { configured: aiConfigured() };
}
/** Describe a system in plain English → Claude designs the base → built in one transaction. */
export async function aiBuildBaseAction(description: string, preview = false) {
  return toResult(async () => {
    const ctx = await requireContext();
    if (!["owner", "creator"].includes(ctx.platformRole)) throw new Error("Only owners and creators can create bases.");
    const { generateBaseSpec } = await import("@/server/platform/ai");
    const spec = await generateBaseSpec(description);
    const summary = { name: spec.name, tables: spec.tables.map((t) => ({ name: t.name, fields: t.fields.map((f) => `${f.name} · ${f.type}`), rows: t.records?.length ?? 0 })) };
    if (preview) return { spec, summary, baseId: null as string | null };
    const { createBaseFromSpec } = await import("@/server/platform/spec");
    const r = await createBaseFromSpec(ctx, spec); done();
    return { spec, summary, baseId: r.baseId as string | null };
  });
}
/** Build from a previously previewed spec (re-validated server-side). */
export async function aiCreateFromSpecAction(spec: import("@/server/platform/spec").BaseSpec) {
  return toResult(async () => {
    const ctx = await requireContext();
    const { createBaseFromSpec } = await import("@/server/platform/spec");
    const r = await createBaseFromSpec(ctx, spec); done(); return { baseId: r.baseId };
  });
}
/** Generate AI text cells for a field (max 25 records per call). */
export async function aiFillFieldAction(fieldId: string, recordIds: string[]) {
  return toResult(async () => {
    const ctx = await requireContext();
    const { generateAiText, renderPrompt } = await import("@/server/platform/ai");
    const { db } = await import("@/db");
    const { baseFields } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [field] = await db.select().from(baseFields).where(eq(baseFields.id, fieldId));
    if (!field || field.type !== "aiText" || !field.options?.prompt) throw new Error("This field has no AI prompt configured.");
    const { access } = await S.tableContext(ctx, field.tableId);
    const r = await runView(ctx, access.role, field.tableId, {}, { recordIds: recordIds.slice(0, 25) });
    const lite = r.fields.map((f) => ({ ...f, options: f.options ?? {} }));
    const cells: { recordId: string; fieldId: string; value: unknown }[] = [];
    for (const row of r.rows) cells.push({ recordId: row.id, fieldId, value: await generateAiText(renderPrompt(field.options.prompt, lite as never, row.values)) });
    await R.updateCells(ctx, cells);
    return cells.length;
  });
}
export async function aiFilterAction(viewId: string, query: string) {
  return toResult(async () => {
    const ctx = await requireContext();
    const { view, access } = await S.viewContext(ctx, viewId);
    const st = await S.loadBaseStructure(ctx, access.base.id);
    const fields = st.fields.filter((f) => f.tableId === view.tableId).map(S.asLite);
    const { naturalLanguageFilter } = await import("@/server/platform/ai");
    return naturalLanguageFilter(query, fields);
  });
}
