/**
 * Interfaces: dashboards of widgets computed server-side from live records, through the same view
 * engine and permission checks as the grid (role-hidden fields are never aggregated for that user).
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { baseInterfaces, baseViews } from "@/db/schema";
import { cellText } from "@/lib/platform/cell-text";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { invalid, notFound } from "../errors";
import { baseAccess, requireRole } from "./access";
import { runView } from "./query";

export type Widget = {
  id: string; type: "number" | "bar" | "line" | "pie" | "list"; title: string; tableId: string; viewId?: string;
  agg?: "count" | "sum" | "avg" | "min" | "max"; fieldId?: string; groupFieldId?: string; dateUnit?: "day" | "week" | "month"; limit?: number; width?: 1 | 2 | 3;
};
export type WidgetData = { id: string; value?: number | null; series?: { label: string; value: number; color?: string }[]; rows?: { id: string; cells: string[] }[]; columns?: string[]; error?: string };

export async function listInterfaces(ctx: Ctx, baseId: string) {
  await baseAccess(ctx, baseId);
  return db.select().from(baseInterfaces).where(and(eq(baseInterfaces.baseId, baseId), eq(baseInterfaces.orgId, ctx.orgId), isNull(baseInterfaces.archivedAt))).orderBy(baseInterfaces.sortOrder, baseInterfaces.createdAt);
}

export async function saveInterface(ctx: Ctx, baseId: string, input: { id?: string; name: string; widgets: Widget[] }) {
  requireRole(await baseAccess(ctx, baseId), "creator", "edit interfaces");
  if (!input.name?.trim()) throw invalid("Name the interface.");
  if (!Array.isArray(input.widgets) || input.widgets.length > 40) throw invalid("Interfaces hold up to 40 widgets.");
  const widgets = input.widgets.map((w) => ({ ...w, title: String(w.title ?? "").slice(0, 120) })) as unknown as Record<string, unknown>[];
  if (input.id) {
    const [row] = await db.update(baseInterfaces).set({ name: input.name.trim(), widgets, updatedAt: new Date() }).where(and(eq(baseInterfaces.id, input.id), eq(baseInterfaces.baseId, baseId), eq(baseInterfaces.orgId, ctx.orgId))).returning();
    if (!row) throw notFound(); return row;
  }
  const [row] = await db.insert(baseInterfaces).values({ orgId: ctx.orgId, baseId, name: input.name.trim(), widgets, createdBy: ctx.userId }).returning();
  await audit(db, ctx, "create_interface", "base_interfaces", row.id, { meta: { name: row.name } });
  return row;
}

export async function deleteInterface(ctx: Ctx, id: string) {
  const [row] = await db.select().from(baseInterfaces).where(and(eq(baseInterfaces.id, id), eq(baseInterfaces.orgId, ctx.orgId))).limit(1);
  if (!row) throw notFound();
  requireRole(await baseAccess(ctx, row.baseId), "creator", "delete interfaces");
  await db.update(baseInterfaces).set({ archivedAt: new Date() }).where(eq(baseInterfaces.id, id));
}

function bucket(d: Date, unit: "day" | "week" | "month") {
  if (unit === "month") return d.toISOString().slice(0, 7);
  if (unit === "week") { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); }
  return d.toISOString().slice(0, 10);
}

export async function computeWidgets(ctx: Ctx, baseId: string, widgets: Widget[]): Promise<WidgetData[]> {
  const { role } = await baseAccess(ctx, baseId);
  const cache = new Map<string, Awaited<ReturnType<typeof runView>>>();
  const out: WidgetData[] = [];
  for (const w of widgets) {
    try {
      let config = {};
      if (w.viewId) {
        const [v] = await db.select().from(baseViews).where(and(eq(baseViews.id, w.viewId), eq(baseViews.orgId, ctx.orgId), isNull(baseViews.archivedAt))).limit(1);
        if (v && v.tableId === w.tableId && (!v.ownerUserId || v.ownerUserId === ctx.userId)) config = v.config;
      }
      const k = `${w.tableId}:${w.viewId ?? ""}`;
      if (!cache.has(k)) cache.set(k, await runView(ctx, role, w.tableId, config, {}));
      const r = cache.get(k)!;
      const f = w.fieldId ? r.fields.find((x) => x.id === w.fieldId) : undefined;
      const g = w.groupFieldId ? r.fields.find((x) => x.id === w.groupFieldId) : undefined;
      if ((w.fieldId && !f) || (w.groupFieldId && !g)) { out.push({ id: w.id, error: "A field this widget uses is missing or hidden from you." }); continue; }
      const agg = (rows: typeof r.rows) => {
        if (!w.agg || w.agg === "count" || !f) return rows.length;
        const nums = rows.map((x) => Number(Array.isArray(x.values[f.id]) ? NaN : x.values[f.id])).filter((n) => Number.isFinite(n));
        if (!nums.length) return 0;
        if (w.agg === "sum") return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
        if (w.agg === "avg") return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
        return w.agg === "min" ? Math.min(...nums) : Math.max(...nums);
      };
      if (w.type === "number") { out.push({ id: w.id, value: agg(r.rows) }); continue; }
      if (w.type === "list") {
        const cols = r.fields.filter((x) => !(config as { hidden?: string[] }).hidden?.includes(x.id)).slice(0, 5);
        out.push({ id: w.id, columns: cols.map((c) => c.name), rows: r.rows.slice(0, Math.min(w.limit ?? 10, 50)).map((x) => ({ id: x.id, cells: cols.map((c) => cellText(c, x.values[c.id])) })) });
        continue;
      }
      if (!g) { out.push({ id: w.id, error: "Choose a field to group by." }); continue; }
      const groups = new Map<string, typeof r.rows>();
      const isDate = ["date", "dateTime", "createdTime", "lastModifiedTime"].includes(g.type);
      for (const row of r.rows) {
        const v = row.values[g.id];
        const keys = isDate ? (v ? [bucket(new Date(String(v)), w.dateUnit ?? "month")] : []) : g.type === "multipleSelects" && Array.isArray(v) ? (v as string[]).map((id) => g.options.choices?.find((c) => c.id === id)?.name ?? "") : [cellText(g, v) || "(Empty)"];
        for (const key of keys) groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      let series = [...groups.entries()].map(([label, rows]) => ({ label, value: agg(rows), color: g.options.choices?.find((c) => c.name === label)?.color }));
      if (isDate || w.type === "line") series.sort((a, b) => a.label.localeCompare(b.label));
      else if (g.options.choices?.length) series.sort((a, b) => (g.options.choices!.findIndex((c) => c.name === a.label) + 1 || 999) - (g.options.choices!.findIndex((c) => c.name === b.label) + 1 || 999));
      else series.sort((a, b) => b.value - a.value);
      series = series.slice(0, 50);
      out.push({ id: w.id, series });
    } catch (err) {
      out.push({ id: w.id, error: String((err as Error)?.message ?? err) });
    }
  }
  return out;
}
