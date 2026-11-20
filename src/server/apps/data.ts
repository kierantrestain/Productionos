/**
 * Runtime data for app components, computed on the server from the stored (or, for builders, draft)
 * configuration. Enforced here, never in the browser:
 *  • every bound table must belong to the app's base;
 *  • field visibility follows the viewer's role (portal visitors read as "reader");
 *  • portal visitors only ever see rows of their scope (their own portal records, or rows linked to them);
 *  • detail pages scope related components to the current record.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { baseFields, baseTables, baseViews, type ViewConfig } from "@/db/schema";
import { fieldVisible } from "../platform/access";
import { asLite } from "../platform/schema";
import { cellText } from "@/lib/platform/cell-text";
import type { Component, DataBinding, Page } from "@/lib/apps/types";
import type { Ctx } from "../auth/context";
import { forbidden, invalid } from "../errors";
import { runView, type ViewRow } from "../platform/query";
import { listComments } from "../platform/records";
import type { Runtime } from "./apps";

export type FieldLite = { id: string; name: string; type: string; options: Record<string, unknown>; isPrimary?: boolean };
export type ComponentData =
  | { kind: "none" } | { kind: "error"; message: string }
  | { kind: "kpi"; value: number; count: number }
  | { kind: "series"; series: { label: string; value: number; color?: string }[] }
  | { kind: "rows"; fields: FieldLite[]; rows: ViewRow[]; total: number; primaryFieldId: string | null; tableName: string }
  | { kind: "record"; fields: FieldLite[]; row: ViewRow | null; tableName: string; related: { fieldId: string; name: string; tableId: string; rows: { id: string; title: string }[] }[]; comments: { id: string; body: string; author: string | null; createdAt: string }[] }
  | { kind: "form"; fields: FieldLite[]; tableName: string }
  | { kind: "filter"; fields: FieldLite[]; active: Record<string, string>; tableName: string };

type Ctx2 = { ctx: Ctx; rt: Pick<Runtime, "app" | "config" | "role" | "scopeIds">; page: Page; recordId?: string;
  /** Filter-bar choices from the page URL (fieldId → value, or "q" → text). They only ever narrow results. */
  pageFilters?: Record<string, string> };
const FILTERABLE = ["singleSelect", "multipleSelects", "checkbox"];

async function tableOfBase(baseId: string, tableId: string) {
  const [t] = await db.select().from(baseTables).where(and(eq(baseTables.id, tableId), eq(baseTables.baseId, baseId), isNull(baseTables.archivedAt))).limit(1);
  if (!t) throw forbidden("This component is bound to a table outside the app.");
  return t;
}
const viewRole = (role: string) => (role === "portal" ? "reader" : role);

/** Build the effective view config + record restriction for a binding, applying detail and portal scope. */
export async function effectiveQuery(c: Ctx2, b: DataBinding) {
  const table = await tableOfBase(c.rt.app.baseId, b.tableId);
  let config: ViewConfig = {};
  if (b.viewId) {
    const [v] = await db.select().from(baseViews).where(and(eq(baseViews.id, b.viewId), eq(baseViews.tableId, table.id), isNull(baseViews.archivedAt))).limit(1);
    if (v && !v.ownerUserId) config = { filters: v.config.filters, sorts: v.config.sorts };
  }
  const conds = [...(config.filters?.conjunction === "or" ? [] : config.filters?.conditions ?? []), ...(b.filter?.conditions ?? [])];
  let recordIds: string[] | undefined;
  // Detail pages: related components show rows linked to the current record.
  if (c.page.kind === "detail" && c.recordId && b.relationFieldId) conds.push({ fieldId: b.relationFieldId, op: "hasAnyOf", value: [c.recordId] });
  if (c.page.kind === "detail" && c.recordId && b.tableId === c.page.tableId && !b.relationFieldId) recordIds = [c.recordId];
  // Portal visitors: hard scope to their records.
  if (c.rt.scopeIds) {
    const portal = c.rt.config.portal!;
    if (b.tableId === portal.tableId) recordIds = (recordIds ?? c.rt.scopeIds).filter((id) => c.rt.scopeIds!.includes(id));
    else if (b.scopeLinkFieldId) conds.push({ fieldId: b.scopeLinkFieldId, op: "hasAnyOf", value: c.rt.scopeIds });
    else throw forbidden("This component isn't scoped to the signed-in client.");
    if (!c.rt.scopeIds.length) recordIds = [];
  }
  // Page filter bar: applies to every component bound to the same table; only visible, filterable fields.
  if (c.pageFilters && Object.keys(c.pageFilters).length) {
    const fs = (await db.select().from(baseFields).where(and(eq(baseFields.tableId, table.id), isNull(baseFields.archivedAt)))).map(asLite);
    const role = c.rt.role === "portal" ? "reader" : c.rt.role;
    for (const [fid, val] of Object.entries(c.pageFilters)) {
      if (!val) continue;
      if (fid === "q") { if (table.primaryFieldId) conds.push({ fieldId: table.primaryFieldId, op: "contains", value: val.slice(0, 100) }); continue; }
      const f = fs.find((x) => x.id === fid);
      if (!f || !FILTERABLE.includes(f.type) || !fieldVisible(role, f)) continue;
      conds.push(f.type === "singleSelect" ? { fieldId: f.id, op: "is", value: val } : f.type === "multipleSelects" ? { fieldId: f.id, op: "hasAnyOf", value: [val] } : { fieldId: f.id, op: val === "true" ? "isChecked" : "isNotChecked" });
    }
  }
  const sorts = b.sortFieldId ? [{ fieldId: b.sortFieldId, dir: b.sortDir ?? "asc" }] : config.sorts;
  const vc: ViewConfig = { ...(conds.length ? { filters: { conjunction: config.filters?.conjunction === "or" && !b.filter?.conditions?.length ? "or" : "and", conditions: conds } } : {}), ...(sorts ? { sorts } : {}) };
  return { table, vc, recordIds };
}

async function query(c: Ctx2, b: DataBinding) {
  const { table, vc, recordIds } = await effectiveQuery(c, b);
  if (recordIds && !recordIds.length) return { table, fields: [], rows: [] as ViewRow[], total: 0 };
  const r = await runView(c.ctx, viewRole(c.rt.role), table.id, vc, recordIds ? { recordIds } : {});
  let rows = r.rows;
  if (b.sortDir === "desc" && !b.sortFieldId) rows = [...rows].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  return { table, fields: r.fields, rows, total: rows.length };
}

const lite = (fields: { id: string; name: string; type: string; options: unknown }[], primary: string | null): FieldLite[] => fields.map((f) => ({ id: f.id, name: f.name, type: f.type, options: (f.options ?? {}) as Record<string, unknown>, isPrimary: f.id === primary }));

function aggregate(rows: ViewRow[], agg: string | undefined, fieldId?: string) {
  if (!agg || agg === "count" || !fieldId) return rows.length;
  const nums = rows.map((r) => Number(Array.isArray(r.values[fieldId]) ? NaN : r.values[fieldId])).filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  const sum = nums.reduce((a, b) => a + b, 0);
  return Math.round((agg === "sum" ? sum : agg === "avg" ? sum / nums.length : agg === "min" ? Math.min(...nums) : Math.max(...nums)) * 100) / 100;
}
function bucket(d: Date, unit: string) {
  if (unit === "day") return d.toISOString().slice(0, 10);
  if (unit === "week") { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); }
  return d.toISOString().slice(0, 7);
}

export async function componentData(c: Ctx2, comp: Component): Promise<ComponentData> {
  const p = comp.props;
  try {
    switch (comp.type) {
      case "kpi": case "progress": {
        if (!p.data?.tableId) return { kind: "none" };
        const q = await query(c, p.data);
        return { kind: "kpi", value: aggregate(q.rows, p.agg, p.fieldId), count: q.rows.length };
      }
      case "chart": {
        if (!p.data?.tableId || !p.groupFieldId) return { kind: "none" };
        const q = await query(c, p.data);
        const g = q.fields.find((f) => f.id === p.groupFieldId);
        if (!g) return { kind: "error", message: "The group-by field is missing or hidden from you." };
        const isDate = ["date", "dateTime", "createdTime", "lastModifiedTime"].includes(g.type);
        const groups = new Map<string, ViewRow[]>();
        for (const r of q.rows) {
          const v = r.values[g.id];
          const keys = isDate ? (v ? [bucket(new Date(String(v)), p.dateUnit ?? "month")] : []) : g.type === "multipleSelects" && Array.isArray(v) ? (v as string[]).map((id) => g.options.choices?.find((ch) => ch.id === id)?.name ?? "") : [cellText(g, v) || "(Empty)"];
          for (const k of keys) groups.set(k, [...(groups.get(k) ?? []), r]);
        }
        let series = [...groups.entries()].map(([label, rows]) => ({ label, value: aggregate(rows, p.agg, p.fieldId), color: g.options.choices?.find((ch) => ch.name === label)?.color as string | undefined }));
        const order = g.options.choices?.map((ch) => ch.name) ?? [];
        series.sort((a, b) => (isDate ? a.label.localeCompare(b.label) : order.length ? (order.indexOf(a.label) + 1 || 999) - (order.indexOf(b.label) + 1 || 999) : b.value - a.value));
        series = series.slice(0, 40);
        return { kind: "series", series };
      }
      case "table": case "kanban": case "activity": case "calendar": case "gallery": {
        if (!p.data?.tableId) return { kind: "none" };
        const q = await query(c, p.data);
        const big = comp.type === "kanban" || comp.type === "calendar";
        const limit = Math.min(Math.max(p.limit ?? (big ? 500 : 25), 1), big ? 1000 : 200);
        return { kind: "rows", fields: lite(q.fields, q.table.primaryFieldId), rows: q.rows.slice(0, limit), total: q.total, primaryFieldId: q.table.primaryFieldId, tableName: q.table.name };
      }
      case "form": {
        if (!p.data?.tableId) return { kind: "none" };
        const table = await tableOfBase(c.rt.app.baseId, p.data.tableId);
        const r = await runView(c.ctx, viewRole(c.rt.role), table.id, {}, { recordIds: [] });
        const writable = r.fields.filter((f) => !["lookup", "rollup", "count", "formula", "autonumber", "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy", "button", "attachment", "aiText", "link", "user"].includes(f.type) && f.permissions?.edit !== "owner" && f.permissions?.edit !== "creator");
        const chosen = p.fieldIds?.length ? p.fieldIds.map((id) => writable.find((f) => f.id === id)).filter(Boolean) as typeof writable : writable.slice(0, 8);
        return { kind: "form", fields: lite(chosen, table.primaryFieldId), tableName: table.name };
      }
      case "filter": {
        if (!p.data?.tableId) return { kind: "none" };
        const table = await tableOfBase(c.rt.app.baseId, p.data.tableId);
        const r = await runView(c.ctx, viewRole(c.rt.role), table.id, {}, { recordIds: [] });
        const usable = r.fields.filter((f) => FILTERABLE.includes(f.type));
        const chosen = p.fieldIds?.length ? usable.filter((f) => p.fieldIds!.includes(f.id)) : usable.slice(0, 3);
        return { kind: "filter", fields: lite(chosen, table.primaryFieldId), active: c.pageFilters ?? {}, tableName: table.name };
      }
      case "record": {
        const tableId = c.page.tableId;
        if (c.page.kind !== "detail" || !tableId || !c.recordId) return { kind: "none" };
        const q = await query(c, { tableId, scopeLinkFieldId: c.page.scopeLinkFieldId });
        const row = q.rows.find((r) => r.id === c.recordId) ?? null;
        if (!row) return { kind: "error", message: "This record doesn't exist or isn't available to you." };
        const fields = lite(q.fields, q.table.primaryFieldId);
        const related = p.showRelated ? fields.filter((f) => f.type === "link").map((f) => ({ fieldId: f.id, name: f.name, tableId: String(f.options.linkedTableId), rows: ((row.values[f.id] as { id: string; title: string }[] | null) ?? []).slice(0, 50) })) : [];
        const comments = p.showComments && c.rt.role !== "portal" ? (await listComments(c.ctx, row.id)).map((x) => ({ id: x.id, body: x.body, author: x.author, createdAt: x.createdAt.toISOString() })) : [];
        return { kind: "record", fields, row, tableName: q.table.name, related, comments };
      }
      default: return { kind: "none" };
    }
  } catch (e) {
    return { kind: "error", message: (e as Error).message ?? "Couldn't load this component." };
  }
}

/** Is `recordId` visible to this viewer on this detail page (portal scope, role)? */
export async function assertRecordInScope(c: Ctx2, tableId: string, recordId: string) {
  const q = await query({ ...c, page: { ...c.page, kind: "blank" } }, { tableId, scopeLinkFieldId: c.page.scopeLinkFieldId });
  if (!q.rows.some((r) => r.id === recordId)) throw invalid("That record isn't available.");
}
