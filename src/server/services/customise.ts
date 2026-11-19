/**
 * Organisation customisation: settings, terminology, option lists and custom fields.
 * Settings are admin-only writes; custom field values follow the parent record's permissions.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { customFieldDefs, customFieldValues, organisations } from "@/db/schema";
import { CUSTOM_FIELD_TYPES, type CustomFieldDefShape, type OrgSettingsShape, isExtensible, toOptionValue } from "@/lib/customise";
import { ENTITIES, getEntity, isEntityKey } from "@/lib/entities";
import { canWrite } from "@/lib/permissions";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { def, getEntityRow } from "../entities/crud";
import { forbidden, invalid, notFound } from "../errors";

const requireAdmin = (ctx: Ctx) => { if (ctx.role !== "org_admin") throw forbidden("Only organisation admins can change customisation."); };

// ───────────── Settings ─────────────

const SettingsSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code").optional(),
  timezone: z.string().min(3).max(60).refine((tz) => { try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; } }, "Unknown timezone").optional(),
  defaultVatBp: z.number().int().min(0).max(10000).optional(),
  approval: z.object({ pmLimitMinor: z.number().int().min(0), producerLimitMinor: z.number().int().min(0) })
    .refine((a) => a.producerLimitMinor >= a.pmLimitMinor, "Producer limit must be at least the PM limit").optional(),
  callSheetContactPolicy: z.string().max(1000).optional(),
  terminology: z.record(z.string(), z.object({ label: z.string().max(60).optional(), plural: z.string().max(60).optional() })).optional(),
  options: z.record(z.string(), z.array(z.string().min(1).max(60)).max(100)).optional(),
  departments: z.array(z.string().min(1).max(60)).max(100).optional(),
}).strict();

export async function getSettings(ctx: Ctx): Promise<OrgSettingsShape> {
  const [o] = await db.select({ s: organisations.settings }).from(organisations).where(eq(organisations.id, ctx.orgId));
  return o?.s ?? {};
}

/** Merge-update settings. Option additions are normalised and only accepted for extensible selects. */
export async function updateSettings(ctx: Ctx, patch: unknown) {
  requireAdmin(ctx);
  const p = SettingsSchema.safeParse(patch);
  if (!p.success) throw invalid(p.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`).join("; "));
  const next: OrgSettingsShape = { ...(await getSettings(ctx)), ...p.data };
  if (p.data.terminology) for (const k of Object.keys(p.data.terminology)) if (!isEntityKey(k)) throw invalid(`Unknown record type "${k}"`);
  if (p.data.options) {
    const clean: Record<string, string[]> = {};
    for (const [k, vals] of Object.entries(p.data.options)) {
      const [entity, field] = k.split(".");
      const f = getEntity(entity)?.fields.find((x) => x.key === field);
      if (!f || !isExtensible(f)) throw invalid(`"${k}" is not an extensible option list`);
      clean[k] = [...new Set(vals.map(toOptionValue).filter(Boolean))].filter((v) => !f.options!.includes(v));
    }
    next.options = clean;
  }
  await db.transaction(async (tx) => {
    const before = await getSettings(ctx);
    await tx.update(organisations).set({ settings: next }).where(eq(organisations.id, ctx.orgId));
    await audit(tx, ctx, "update_settings", "organisations", ctx.orgId, { before: before as Record<string, unknown>, after: next as Record<string, unknown> });
  });
  ctx.settings = next;
  return next;
}

export function extensibleSelects() {
  const out: { key: string; entity: string; entityLabel: string; field: string; label: string; builtIn: string[] }[] = [];
  for (const d of Object.values(ENTITIES)) for (const f of d.fields) if (isExtensible(f as never)) out.push({ key: `${d.key}.${f.key}`, entity: d.key, entityLabel: d.plural, field: f.key, label: f.label, builtIn: [...((f as { options?: readonly string[] }).options ?? [])] });
  return out;
}

// ───────────── Custom field definitions ─────────────

const DefSchema = z.object({
  entity: z.string(),
  label: z.string().trim().min(1).max(60),
  type: z.enum(CUSTOM_FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
  required: z.boolean().default(false),
  showInList: z.boolean().default(true),
  help: z.string().max(200).nullable().optional(),
});

export async function listFieldDefs(ctx: Ctx, entity?: string): Promise<CustomFieldDefShape[]> {
  const rows = await db.select().from(customFieldDefs).where(and(eq(customFieldDefs.orgId, ctx.orgId), sql`${customFieldDefs.archivedAt} is null`, entity ? eq(customFieldDefs.entity, entity) : undefined))
    .orderBy(asc(customFieldDefs.entity), asc(customFieldDefs.sortOrder), asc(customFieldDefs.label));
  return rows.map((r) => ({ id: r.id, entity: r.entity, key: r.key, label: r.label, type: r.type as CustomFieldDefShape["type"], options: r.options, required: r.required, showInList: r.showInList, sortOrder: r.sortOrder, help: r.help }));
}

export async function createFieldDef(ctx: Ctx, input: unknown) {
  requireAdmin(ctx);
  const p = DefSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  if (!isEntityKey(p.data.entity)) throw invalid("Unknown record type");
  if (p.data.type === "select" && p.data.options.length < 1) throw invalid("A choice field needs at least one option");
  const key = toOptionValue(p.data.label);
  if (!key) throw invalid("Label must contain letters or numbers");
  if (getEntity(p.data.entity)!.fields.some((f) => f.key.toLowerCase() === key.replace(/_/g, ""))) throw invalid("That name clashes with a built-in field");
  const existing = await listFieldDefs(ctx, p.data.entity);
  const [row] = await db.insert(customFieldDefs).values({ orgId: ctx.orgId, createdBy: ctx.userId, entity: p.data.entity, key, label: p.data.label, type: p.data.type,
    options: p.data.type === "select" ? [...new Set(p.data.options)] : [], required: p.data.required, showInList: p.data.showInList, help: p.data.help ?? null, sortOrder: existing.length * 10 }).returning();
  await audit(db, ctx, "create_custom_field", "custom_field_defs", row.id, { after: row as never });
  return row;
}

export async function updateFieldDef(ctx: Ctx, id: string, patch: { label?: string; options?: string[]; required?: boolean; showInList?: boolean; help?: string | null }) {
  requireAdmin(ctx);
  const [cur] = await db.select().from(customFieldDefs).where(and(eq(customFieldDefs.id, id), eq(customFieldDefs.orgId, ctx.orgId))).limit(1);
  if (!cur) throw notFound();
  if (patch.options && cur.type === "select") {
    const removed = cur.options.filter((o) => !patch.options!.includes(o));
    if (removed.length) {
      const [{ n }] = (await db.execute(sql`select count(*)::int as n from custom_field_values where field_id = ${id} and value #>> '{}' in ${removed}`)) as unknown as { n: number }[];
      if (n > 0) throw invalid(`Can't remove ${removed.join(", ")}: ${n} record(s) still use it.`);
    }
  }
  const [row] = await db.update(customFieldDefs).set({ ...patch, options: patch.options ?? cur.options, updatedAt: new Date() }).where(eq(customFieldDefs.id, id)).returning();
  await audit(db, ctx, "update_custom_field", "custom_field_defs", id, { before: cur as never, after: row as never });
  return row;
}

export async function archiveFieldDef(ctx: Ctx, id: string) {
  requireAdmin(ctx);
  const [row] = await db.update(customFieldDefs).set({ archivedAt: new Date() }).where(and(eq(customFieldDefs.id, id), eq(customFieldDefs.orgId, ctx.orgId))).returning();
  if (!row) throw notFound();
  await audit(db, ctx, "archive_custom_field", "custom_field_defs", id);
}

// ───────────── Values ─────────────

export function coerceCustom(defn: CustomFieldDefShape, v: unknown): unknown {
  if (v === "" || v === undefined || v === null) {
    if (defn.required) throw invalid(`${defn.label} is required`, { [`cf.${defn.key}`]: "Required" });
    return null;
  }
  const bad = (m: string) => invalid(`${defn.label}: ${m}`, { [`cf.${defn.key}`]: m });
  switch (defn.type) {
    case "text": { const s = String(v).trim(); if (s.length > 500) throw bad("too long"); return s; }
    case "textarea": { const s = String(v); if (s.length > 20000) throw bad("too long"); return s; }
    case "number": { const n = Number(v); if (!Number.isFinite(n)) throw bad("must be a number"); return n; }
    case "money": { const n = Number(v); if (!Number.isInteger(n)) throw bad("must be whole pence"); return n; }
    case "date": { const s = String(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad("use YYYY-MM-DD"); return s; }
    case "bool": return v === true || v === "true";
    case "select": { const s = String(v); if (!defn.options.includes(s)) throw bad("not one of the options"); return s; }
    case "url": { const s = String(v).trim(); if (!/^https?:\/\//i.test(s)) throw bad("must start with http(s)://"); return s; }
  }
}

/** Values for a set of rows the caller has already been authorised to read. */
export async function customValuesFor(ctx: Ctx, entity: string, recordIds: string[]) {
  const out: Record<string, Record<string, unknown>> = {};
  if (!recordIds.length) return out;
  const rows = await db.select({ recordId: customFieldValues.recordId, key: customFieldDefs.key, value: customFieldValues.value })
    .from(customFieldValues).innerJoin(customFieldDefs, eq(customFieldDefs.id, customFieldValues.fieldId))
    .where(and(eq(customFieldValues.orgId, ctx.orgId), eq(customFieldValues.entity, entity), inArray(customFieldValues.recordId, recordIds)));
  for (const r of rows) (out[r.recordId] ??= {})[r.key] = r.value;
  return out;
}

/** Validate then upsert custom values for one record. Pass `tx` to share the record's transaction. */
export async function setCustomValues(ctx: Ctx, entity: string, recordId: string, values: Record<string, unknown>, opts: { tx?: DbOrTx; creating?: boolean } = {}) {
  const d = def(entity);
  if (!canWrite(ctx.role, d.domain, d.key)) throw forbidden();
  const run = async (tx: DbOrTx) => {
    const row = await getEntityRow(ctx, entity, recordId, tx);
    const defs = await listFieldDefs(ctx, entity);
    const changed: Record<string, unknown> = {};
    for (const defn of defs) {
      if (!(defn.key in values)) { if (opts.creating && defn.required) coerceCustom(defn, null); continue; }
      const v = coerceCustom(defn, values[defn.key]);
      await tx.insert(customFieldValues).values({ orgId: ctx.orgId, entity, recordId, fieldId: defn.id, value: v as never, updatedBy: ctx.userId })
        .onConflictDoUpdate({ target: [customFieldValues.recordId, customFieldValues.fieldId], set: { value: v as never, updatedAt: new Date(), updatedBy: ctx.userId } });
      changed[`cf.${defn.key}`] = v;
    }
    for (const k of Object.keys(values)) if (!defs.some((x) => x.key === k)) throw invalid(`Unknown custom field "${k}"`);
    if (Object.keys(changed).length) await audit(tx, ctx, "set_custom_fields", entity, recordId, { productionId: (row.productionId as string) ?? null, after: changed });
    return changed;
  };
  return opts.tx ? run(opts.tx) : db.transaction(run);
}

/** SQL condition: record has custom field `fieldId` equal to `value` (text comparison). */
export function customFilterSql(table: { id: unknown }, fieldId: string, value: string) {
  return sql`exists (select 1 from custom_field_values v where v.record_id = ${table.id} and v.field_id = ${fieldId} and v.value #>> '{}' = ${value})`;
}
