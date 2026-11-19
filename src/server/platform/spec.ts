/**
 * Build a base from a declarative spec in ONE transaction. Used by templates, the AI base builder and
 * CSV/Excel import. Specs reference tables and fields by name; links, lookups, rollups and formulas
 * are resolved to ids here. Seed records never trigger automations (origin = import).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { baseFields, baseRecords, baseViews, type ViewConfig } from "@/db/schema";
import { FIELD_TYPES, newChoiceId, type FieldOptions, type FieldType, COLORS } from "@/lib/platform/fields";
import type { Ctx } from "../auth/context";
import { invalid } from "../errors";
import { createBase, createTableTx, normaliseOptions, validateComputed } from "./schema";
import { baseAccess, requireRole } from "./access";
import { createRecords } from "./records";

export interface SpecField {
  name: string; type: FieldType; description?: string;
  choices?: (string | { name: string; color?: string })[];
  linkTo?: string; inverseName?: string; singleRecord?: boolean;
  via?: string; target?: string; fn?: string;          // lookup / rollup / count
  formula?: string; options?: FieldOptions;
}
export interface SpecView { name: string; type: string; groupBy?: string; kanbanBy?: string; dateField?: string; sortBy?: string; filter?: { field: string; op: string; value?: unknown } }
export interface SpecTable { name: string; description?: string; fields: SpecField[]; records?: Record<string, unknown>[]; views?: SpecView[] }
export interface BaseSpec { name: string; icon?: string; color?: string; description?: string; templateKey?: string; tables: SpecTable[] }

const PLAIN = (t: FieldType) => !["link", "lookup", "rollup", "count", "formula"].includes(t);

export function validateSpec(spec: BaseSpec) {
  if (!spec?.name?.trim()) throw invalid("Spec needs a base name");
  if (!Array.isArray(spec.tables) || !spec.tables.length || spec.tables.length > 30) throw invalid("Spec needs 1–30 tables");
  const names = new Set<string>();
  for (const t of spec.tables) {
    if (!t.name?.trim() || names.has(t.name.toLowerCase())) throw invalid(`Bad or duplicate table name “${t.name}”`);
    names.add(t.name.toLowerCase());
    if (!t.fields?.length || t.fields.length > 200) throw invalid(`Table ${t.name} needs 1–200 fields`);
    if (!PLAIN(t.fields[0].type)) throw invalid(`The first field of ${t.name} must be a plain field (it becomes the primary field)`);
    const fn = new Set<string>();
    for (const f of t.fields) {
      if (!FIELD_TYPES.includes(f.type)) throw invalid(`Unknown field type ${f.type} in ${t.name}`);
      if (!f.name?.trim() || fn.has(f.name.toLowerCase())) throw invalid(`Bad or duplicate field “${f.name}” in ${t.name}`);
      fn.add(f.name.toLowerCase());
      if (f.type === "link" && !spec.tables.some((x) => x.name === f.linkTo)) throw invalid(`${t.name}.${f.name} links to unknown table ${f.linkTo}`);
    }
    if ((t.records?.length ?? 0) > 5000) throw invalid(`Too many seed records in ${t.name}`);
  }
}

/** Build a new base from a spec — or, with `intoBaseId`, add the spec's tables to an existing base. */
export async function createBaseFromSpec(ctx: Ctx, spec: BaseSpec, opts: { intoBaseId?: string } = {}) {
  validateSpec(spec);
  return db.transaction(async (tx) => {
    let base: { id: string };
    if (opts.intoBaseId) { const a = await baseAccess(ctx, opts.intoBaseId, tx); requireRole(a, "creator", "add tables"); base = a.base; }
    else base = await createBase(ctx, { name: spec.name, icon: spec.icon, color: spec.color, description: spec.description, blank: false }, tx);
    const tableIds = new Map<string, string>();
    const fieldIds = new Map<string, string>(); // "Table.Field" → id
    const key = (t: string, f: string) => `${t}\u0000${f}`;
    const linkTarget = new Map<string, string>(); // "Table.LinkField" → linked table name (declared and inverse links)
    const choiceOpts = (f: SpecField): FieldOptions => ({ ...(f.options ?? {}), choices: (f.choices ?? []).map((c, i) => typeof c === "string" ? { id: newChoiceId(), name: c, color: COLORS[i % COLORS.length] } : { id: newChoiceId(), name: c.name, color: (COLORS.includes(c.color as never) ? c.color : COLORS[i % COLORS.length]) as never }) });
    // 1. Tables with their primary field.
    for (const t of spec.tables) {
      const p = t.fields[0];
      const tbl = await createTableTx(tx, ctx, base.id, t.name, [{ name: p.name, type: p.type, options: p.choices ? choiceOpts(p) : p.options }]);
      tableIds.set(t.name, tbl.id);
      fieldIds.set(key(t.name, p.name), tbl.primaryFieldId!);
    }
    const insertField = async (tableName: string, f: SpecField, options: FieldOptions, sortOrder: number) => {
      const [row] = await tx.insert(baseFields).values({ orgId: ctx.orgId, createdBy: ctx.userId, tableId: tableIds.get(tableName)!, name: f.name, type: f.type, options, description: f.description ?? null, sortOrder }).returning();
      fieldIds.set(key(tableName, f.name), row.id);
      return row;
    };
    // 2. Plain fields, 3. links (+ inverse), keeping declared order.
    for (const t of spec.tables) for (const [i, f] of t.fields.entries()) {
      if (i === 0 || !PLAIN(f.type)) continue;
      await insertField(t.name, f, normaliseOptions(f.type, f.choices ? choiceOpts(f) : f.options ?? {}), i * 2);
    }
    for (const t of spec.tables) for (const [i, f] of t.fields.entries()) {
      if (f.type !== "link" || fieldIds.has(key(t.name, f.name))) continue;
      const target = f.linkTo!;
      const row = await insertField(t.name, f, { linkedTableId: tableIds.get(target)!, singleRecord: f.singleRecord }, i * 2);
      linkTarget.set(key(t.name, f.name), target);
      const declaredInverse = spec.tables.find((x) => x.name === target)?.fields.find((x) => x.type === "link" && x.linkTo === t.name && (f.inverseName ? x.name === f.inverseName : true) && !fieldIds.has(key(target, x.name)));
      const invName = declaredInverse?.name ?? f.inverseName ?? t.name;
      const pos = declaredInverse ? spec.tables.find((x) => x.name === target)!.fields.indexOf(declaredInverse) * 2 : 999;
      const inv = await insertField(target, { name: invName, type: "link" }, { linkedTableId: tableIds.get(t.name)!, inverseFieldId: row.id }, pos);
      linkTarget.set(key(target, invName), t.name);
      await tx.update(baseFields).set({ options: { linkedTableId: tableIds.get(target)!, inverseFieldId: inv.id, singleRecord: f.singleRecord } }).where(eq(baseFields.id, row.id));
    }
    // 4. Seed records (plain values), remembering primary text → id for link resolution.
    const byTitle = new Map<string, Map<string, string>>();
    for (const t of spec.tables) {
      if (!t.records?.length) continue;
      const rows = t.records.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => { const f = t.fields.find((x) => x.name === k); return f && PLAIN(f.type); }).map(([k, v]) => [fieldIds.get(key(t.name, k))!, v])));
      const ids = await createRecords(ctx, tableIds.get(t.name)!, rows, { tx, origin: "import", skipPermission: true });
      byTitle.set(t.name, new Map(ids.map((id, i) => [String(t.records![i][t.fields[0].name] ?? ""), id])));
    }
    // 5. Link values by primary text (both sides kept in sync).
    for (const t of spec.tables) for (const r of t.records ?? []) {
      // Declared links plus auto-created inverse links (seed data may set either side).
      const linkKeys = Object.keys(r).filter((k) => linkTarget.has(key(t.name, k)));
      for (const f of linkKeys.map((k) => ({ name: k, linkTo: linkTarget.get(key(t.name, k))! }))) {
        const titles = (Array.isArray(r[f.name]) ? r[f.name] as string[] : [r[f.name] as string]).map(String);
        const ids = titles.map((ti) => byTitle.get(f.linkTo)?.get(ti)).filter(Boolean) as string[];
        if (!ids.length) continue;
        const recId = byTitle.get(t.name)!.get(String(r[t.fields[0].name] ?? ""))!;
        const fid = fieldIds.get(key(t.name, f.name))!;
        const [cur] = await tx.select({ data: baseRecords.data }).from(baseRecords).where(eq(baseRecords.id, recId));
        await tx.update(baseRecords).set({ data: { ...cur.data, [fid]: ids } }).where(eq(baseRecords.id, recId));
        const [lf] = await tx.select().from(baseFields).where(eq(baseFields.id, fid));
        const inv = (lf.options as FieldOptions).inverseFieldId!;
        for (const id of ids) {
          const [o] = await tx.select({ data: baseRecords.data }).from(baseRecords).where(eq(baseRecords.id, id));
          const list = new Set([...((o.data[inv] as string[]) ?? []), recId]);
          await tx.update(baseRecords).set({ data: { ...o.data, [inv]: [...list] } }).where(eq(baseRecords.id, id));
        }
      }
    }
    // 6. Computed fields (validated exactly as if created in the UI), in dependency order — a rollup can
    //    target, and a formula can reference, a calculated field that another table defines.
    let pending = spec.tables.flatMap((t) => t.fields.map((f, i) => ({ t, f, i }))).filter((x) => ["lookup", "rollup", "count", "formula"].includes(x.f.type));
    const ready = ({ t, f }: (typeof pending)[number]) => {
      if (f.type === "formula") return [...(f.formula ?? "").matchAll(/\{([^}]+)\}/g)].every((m) => fieldIds.has(key(t.name, m[1])));
      if (!fieldIds.has(key(t.name, f.via ?? ""))) return false;
      return f.type === "count" || fieldIds.has(key(linkTarget.get(key(t.name, f.via!)) ?? "", f.target ?? ""));
    };
    while (pending.length) {
      const now = pending.filter(ready);
      if (!now.length) { const x = pending[0]; throw invalid(`${x.t.name}.${x.f.name} refers to a field that doesn't exist (or a circular reference).`); }
      for (const { t, f, i } of now) {
        const tid = tableIds.get(t.name)!;
        let opts: FieldOptions = { ...(f.options ?? {}) };
        if (f.type !== "formula") {
          const linked = linkTarget.get(key(t.name, f.via!))!;
          opts.linkFieldId = fieldIds.get(key(t.name, f.via!));
          if (f.type !== "count") opts.targetFieldId = fieldIds.get(key(linked, f.target ?? ""));
          if (f.type === "rollup") opts.rollupFn = (f.fn as FieldOptions["rollupFn"]) ?? "sum";
        } else opts.formula = f.formula;
        opts = await validateComputed(tx, tid, f.type, opts);
        await insertField(t.name, f, opts, i * 2);
      }
      pending = pending.filter((x) => !now.includes(x));
    }
    // 7. Extra views.
    for (const t of spec.tables) for (const v of t.views ?? []) {
      const fid = (n?: string) => (n ? fieldIds.get(key(t.name, n)) : undefined);
      const config: ViewConfig = {};
      if (v.groupBy) config.groups = [{ fieldId: fid(v.groupBy)!, dir: "asc" }];
      if (v.sortBy) config.sorts = [{ fieldId: fid(v.sortBy)!, dir: "asc" }];
      if (v.kanbanBy) config.kanbanFieldId = fid(v.kanbanBy);
      if (v.dateField) config.dateFieldId = fid(v.dateField);
      if (v.filter && fid(v.filter.field)) config.filters = { conjunction: "and", conditions: [{ fieldId: fid(v.filter.field)!, op: v.filter.op, value: v.filter.value }] };
      if (v.type === "form") config.form = { title: v.name, fields: t.fields.filter((f) => PLAIN(f.type) || f.type === "link").map((f) => ({ fieldId: fid(f.name)! })) };
      await tx.insert(baseViews).values({ orgId: ctx.orgId, createdBy: ctx.userId, tableId: tableIds.get(t.name)!, name: v.name, type: v.type, config, sortOrder: 10 });
    }
    return { baseId: base.id, tableIds: Object.fromEntries(tableIds) };
  });
}
