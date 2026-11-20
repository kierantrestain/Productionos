/**
 * Idempotent, resumable importer for a read-only Airtable export pack.
 *
 * Guarantees
 *  - Creates NEW native bases; never touches existing bases or Airtable itself.
 *  - Identity: bases/tables/fields/views/forms/automations are tracked in `migration_map`
 *    (org, "airtable", kind, sourceId) → targetId; records by base_records.source_ref
 *    `${baseId}/${tableId}/${recordId}`. Re-running only creates what is missing and updates changed
 *    values — it never duplicates. A partial run can be resumed by running again.
 *  - Original record creation time is preserved natively in base_records.created_at (so Airtable
 *    "Created time" fields map to our native createdTime field).
 *  - Writes are import-origin: no outbox events, no automations, no AI, no external calls.
 *    Imported automations are ALWAYS created disabled.
 *  - Nothing is invented: unresolvable links, unexported view settings, page layouts, rollup
 *    functions and attachment bytes are reported, not fabricated.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { baseAutomations, baseFields, baseRecords, baseTables, baseViews, bases, migrationMap, type ViewConfig } from "@/db/schema";
import type { FieldOptions } from "@/lib/platform/fields";
import type { Ctx } from "@/server/auth/context";
import { audit } from "@/server/audit";
import { runView } from "@/server/platform/query";
import { normaliseOptions, validateComputed } from "@/server/platform/schema";
import { comparable, convertCell, planField, type FieldPlan } from "./mapping";
import type { AtField, AtNode, AtTable, Pack, PackBase } from "./reader";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Kind = "base" | "table" | "field" | "view" | "form" | "automation";
const SYS = "airtable";
const VIEW_TYPES = new Set(["grid", "kanban", "calendar", "gallery", "form", "timeline", "list"]);
const COMPUTED_TARGET = new Set<string>(["formula", "lookup", "rollup", "count", "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy", "autonumber", "button"]);

export interface Warning { scope: string; sourceId: string; name: string; category: string; message: string }
export interface TableReport { sourceTableId: string; name: string; targetTableId: string | null; sourceRecords: number; manifestRecords: number | null; created: number; updated: number; unchanged: number; afterImport: number | null }
export interface BaseReport {
  baseId: string; baseName: string; targetBaseId: string | null;
  tables: TableReport[];
  counts: Record<string, { source: number; created: number; existing: number; skipped?: number }>;
  fieldMapping: Record<string, Record<string, number>>; // airtable type → our type → count
  links: { valuesInRecords: number; resolved: number; unresolved: { tableId: string; recordId: string; fieldId: string; targetRecordId: string }[]; edgesInManifest: number };
  formulaFidelity: { fields: number; compared: number; matched: number; explained: Record<string, number>; mismatched: number; mismatchedFields: { fieldId: string; name: string; mismatches: number; reason: string; sample?: { recordId: string; exported: string; recomputed: string } }[] };
  forms: { sourceId: string; name: string; status: string; elements: number; mappedElements: number; notes: string[] }[];
  pages: { sourceId: string; name: string; kind: string; pageType?: string; interface?: string; status: string; targetTableId?: string | null }[];
  automations: { sourceId: string; name: string; sourceStatus: string; created: boolean; targetId?: string; trigger: string; translatedSteps: number; untranslated: string[] }[];
  attachments: { references: number; pendingTransfer: number };
  warnings: Warning[];
}
export interface ImportReport { generatedAt: string; mode: "dry-run" | "apply"; pack: { dir: string; exportDateUTC?: string; issues: string[] }; orgId: string; bases: BaseReport[]; totals: Record<string, number> }

// ───────── identity map ─────────
class IdMap {
  private m = new Map<string, string>();
  constructor(private orgId: string) {}
  async load() {
    const rows = await db.select().from(migrationMap).where(and(eq(migrationMap.orgId, this.orgId), eq(migrationMap.sourceSystem, SYS)));
    for (const r of rows) this.m.set(`${r.sourceKind}:${r.sourceId}`, r.targetId);
    return this;
  }
  get(kind: Kind, id: string) { return this.m.get(`${kind}:${id}`); }
  async put(tx: Tx, kind: Kind, sourceId: string, targetId: string, meta?: Record<string, unknown>) {
    await tx.insert(migrationMap).values({ orgId: this.orgId, sourceSystem: SYS, sourceKind: kind, sourceId, targetId, meta: meta ?? null }).onConflictDoNothing();
    this.m.set(`${kind}:${sourceId}`, targetId);
  }
}

const sourceRef = (b: PackBase, tableId: string, recordId: string) => `${b.baseId}/${tableId}/${recordId}`;
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** Run the import. With apply=false nothing is written; the report shows what would happen. */
export async function importPack(ctx: Ctx, pack: Pack, opts: { apply: boolean }): Promise<ImportReport> {
  const map = await new IdMap(ctx.orgId).load();
  const report: ImportReport = { generatedAt: new Date().toISOString(), mode: opts.apply ? "apply" : "dry-run", pack: { dir: pack.dir, exportDateUTC: pack.exportDateUTC, issues: pack.issues }, orgId: ctx.orgId, bases: [], totals: {} };
  for (const b of pack.bases) report.bases.push(await importBase(ctx, pack, b, map, opts.apply));
  const sum = (f: (b: BaseReport) => number) => report.bases.reduce((n, b) => n + f(b), 0);
  report.totals = {
    tables: sum((b) => b.counts.tables.source), fields: sum((b) => b.counts.fields.source), records: sum((b) => b.tables.reduce((n, t) => n + t.sourceRecords, 0)),
    recordsCreated: sum((b) => b.tables.reduce((n, t) => n + t.created, 0)), recordsUpdated: sum((b) => b.tables.reduce((n, t) => n + t.updated, 0)), recordsUnchanged: sum((b) => b.tables.reduce((n, t) => n + t.unchanged, 0)),
    linkValues: sum((b) => b.links.valuesInRecords), linksResolved: sum((b) => b.links.resolved), linksUnresolved: sum((b) => b.links.unresolved.length), linkEdgesInPack: sum((b) => b.links.edgesInManifest),
    views: sum((b) => b.counts.views.source), forms: sum((b) => b.forms.length), formsImportedAsFormViews: sum((b) => b.forms.filter((f) => f.status.startsWith("form view")).length),
    pages: sum((b) => b.pages.length), automations: sum((b) => b.automations.length), automationsImportedDisabled: sum((b) => b.automations.filter((a) => a.created).length),
    attachmentsPendingTransfer: sum((b) => b.attachments.pendingTransfer), warnings: sum((b) => b.warnings.length),
    formulaFields: sum((b) => b.formulaFidelity.fields), formulaValuesMatched: sum((b) => b.formulaFidelity.matched), formulaValuesExplainedDifferences: sum((b) => Object.values(b.formulaFidelity.explained).reduce((n, x) => n + x, 0)), formulaValuesUnexplained: sum((b) => b.formulaFidelity.mismatched),
  };
  if (opts.apply) await audit(db, ctx, "airtable_pack_import", "organisations", ctx.orgId, { meta: { bases: pack.bases.map((b) => b.baseId), totals: report.totals } });
  return report;
}

async function importBase(ctx: Ctx, pack: Pack, b: PackBase, map: IdMap, apply: boolean): Promise<BaseReport> {
  const mb = pack.manifest.bases.find((m) => m.baseId === b.baseId);
  const warnings: Warning[] = [];
  const warn = (scope: string, sourceId: string, name: string, category: string, message: string) => warnings.push({ scope, sourceId, name, category, message });
  const r: BaseReport = {
    baseId: b.baseId, baseName: b.baseName, targetBaseId: map.get("base", b.baseId) ?? null, tables: [],
    counts: { tables: { source: b.tables.length, created: 0, existing: 0 }, fields: { source: 0, created: 0, existing: 0 }, views: { source: 0, created: 0, existing: 0 } },
    fieldMapping: {}, links: { valuesInRecords: 0, resolved: 0, unresolved: [], edgesInManifest: b.edges.length },
    formulaFidelity: { fields: 0, compared: 0, matched: 0, explained: {}, mismatched: 0, mismatchedFields: [] },
    forms: [], pages: [], automations: [], attachments: { references: b.attachments.length, pendingTransfer: 0 }, warnings,
  };
  // Plans for every field (pure).
  const plans = new Map<string, FieldPlan>();
  const fieldById = new Map<string, { f: AtField; t: AtTable }>();
  for (const t of b.tables) for (const f of t.fields) {
    const p = planField(f, t.fields); plans.set(f.id, p); fieldById.set(f.id, { f, t });
    r.fieldMapping[f.type] ??= {}; r.fieldMapping[f.type][p.type] = (r.fieldMapping[f.type][p.type] ?? 0) + 1;
    if (p.warning) warn("field", f.id, `${t.name}.${f.name}`, p.category ?? "field", p.warning);
    r.counts.fields.source++;
  }

  // ───── Structure (one transaction; idempotent via the id map) ─────
  const structure = async (tx: Tx) => {
    let baseId = map.get("base", b.baseId);
    if (!baseId) {
      r.counts.base = { source: 1, created: 1, existing: 0 };
      if (apply) {
        const [row] = await tx.insert(bases).values({ orgId: ctx.orgId, createdBy: ctx.userId, name: b.baseName.slice(0, 120), icon: "database", color: "teal", templateKey: `airtable:${b.baseId}`,
          description: `Imported from Airtable base ${b.baseId} (read-only export ${pack.exportDateUTC ?? "unknown date"}). Source IDs are preserved in table/field descriptions and record source references.` }).returning();
        baseId = row.id; await map.put(tx, "base", b.baseId, baseId);
      }
    } else r.counts.base = { source: 1, created: 0, existing: 1 };
    r.targetBaseId = baseId ?? null;
    // Tables (no default view — views come from the export).
    for (const [i, t] of b.tables.entries()) {
      if (map.get("table", t.id)) { r.counts.tables.existing++; continue; }
      r.counts.tables.created++;
      if (!apply) continue;
      const [row] = await tx.insert(baseTables).values({ orgId: ctx.orgId, createdBy: ctx.userId, baseId: baseId!, name: t.name.slice(0, 120), sortOrder: i, description: [t.description, `Airtable ${t.id}`].filter(Boolean).join("\n") }).returning();
      await map.put(tx, "table", t.id, row.id);
    }
    // Plain / fallback / link fields, unique names per table.
    for (const t of b.tables) {
      const tid = map.get("table", t.id);
      const used = new Set<string>();
      if (tid && apply) for (const f of await tx.select({ name: baseFields.name }).from(baseFields).where(eq(baseFields.tableId, tid))) used.add(f.name.toLowerCase());
      for (const [i, f] of t.fields.entries()) {
        const p = plans.get(f.id)!;
        if (map.get("field", f.id)) { r.counts.fields.existing++; continue; }
        if (p.kind === "computed") continue;
        r.counts.fields.created++;
        if (!apply) continue;
        const name = uniqueName(f.name, used, () => warn("field", f.id, `${t.name}.${f.name}`, "duplicate field name", "renamed to keep field names unique"));
        const options: FieldOptions = p.kind === "link" ? { ...p.options, linkedTableId: map.get("table", f.config.linkedTableId!) } : normaliseOptions(p.type, p.options);
        const [row] = await tx.insert(baseFields).values({ orgId: ctx.orgId, createdBy: ctx.userId, tableId: tid!, name, type: p.type, options, sortOrder: i * 2,
          description: [f.description, `Airtable ${f.id} (${f.type})${p.kind === "fallback" ? " — text snapshot" : ""}`].filter(Boolean).join("\n") }).returning();
        await map.put(tx, "field", f.id, row.id, { sourceType: f.type, kind: p.kind });
      }
    }
    // Link inverses (each Airtable link field is paired with its own inverse field).
    if (apply) for (const t of b.tables) for (const f of t.fields) {
      if (plans.get(f.id)?.kind !== "link") continue;
      const id = map.get("field", f.id); const inv = f.config.inverseLinkFieldId && f.config.inverseLinkFieldId !== f.id ? map.get("field", f.config.inverseLinkFieldId) : undefined;
      if (!id) continue;
      await tx.update(baseFields).set({ options: { linkedTableId: map.get("table", f.config.linkedTableId!), singleRecord: !!f.config.prefersSingleRecordLink, ...(inv ? { inverseFieldId: inv } : {}) } }).where(eq(baseFields.id, id));
    }
    // Computed fields in dependency order; anything that can't be created natively becomes a snapshot.
    let pending = b.tables.flatMap((t) => t.fields.filter((f) => plans.get(f.id)!.kind === "computed" && !map.get("field", f.id)).map((f) => ({ t, f })));
    const createSnapshot = async (t: AtTable, f: AtField, why: string) => {
      const was = plans.get(f.id)!.type;
      plans.set(f.id, { kind: "fallback", type: "longText", options: {}, deps: [], warning: why });
      warn("field", f.id, `${t.name}.${f.name}`, f.type === "formula" ? "formula fallback" : "computed fallback", `${why} — imported as a read-only text snapshot of the exported values`);
      r.fieldMapping[f.type][was] = Math.max(0, (r.fieldMapping[f.type][was] ?? 1) - 1);
      r.fieldMapping[f.type]["longText"] = (r.fieldMapping[f.type]["longText"] ?? 0) + 1;
      if (!apply) return;
      const used = new Set((await tx.select({ name: baseFields.name }).from(baseFields).where(eq(baseFields.tableId, map.get("table", t.id)!))).map((x) => x.name.toLowerCase()));
      const [row] = await tx.insert(baseFields).values({ orgId: ctx.orgId, createdBy: ctx.userId, tableId: map.get("table", t.id)!, name: uniqueName(f.name, used, () => {}), type: "longText", options: {}, sortOrder: t.fields.indexOf(f) * 2, description: `Airtable ${f.id} (${f.type}) — text snapshot: ${why}` }).returning();
      await map.put(tx, "field", f.id, row.id, { sourceType: f.type, kind: "fallback" });
    };
    if (!apply) {
      // Dry run: predict computed outcomes from plans (dependency existence only).
      r.counts.fields.created += pending.length;
    } else {
      while (pending.length) {
        const ready = pending.filter(({ f }) => plans.get(f.id)!.deps.every((d) => map.get("field", d)));
        if (!ready.length) { for (const { t, f } of pending) { await createSnapshot(t, f, "depends on fields that couldn't be created (circular or missing)"); r.counts.fields.created++; } break; }
        for (const { t, f } of ready) {
          const p = plans.get(f.id)!; const tid = map.get("table", t.id)!;
          let options: FieldOptions = {};
          try {
            if (p.type === "formula") options = await validateComputed(tx, tid, "formula", { formula: p.options.formula!.replace(/\{([^}]+)\}/g, (_m, id: string) => `{${map.get("field", id) ?? id}}`) });
            else if (p.type === "lookup" || p.type === "count") options = await validateComputed(tx, tid, p.type, { linkFieldId: map.get("field", p.deps[0]), ...(p.type === "lookup" ? { targetFieldId: map.get("field", p.deps[1]) } : {}) });
          } catch (e) { await createSnapshot(t, f, `couldn't recreate natively (${(e as Error).message})`); r.counts.fields.created++; continue; }
          const used = new Set((await tx.select({ name: baseFields.name }).from(baseFields).where(eq(baseFields.tableId, tid))).map((x) => x.name.toLowerCase()));
          const [row] = await tx.insert(baseFields).values({ orgId: ctx.orgId, createdBy: ctx.userId, tableId: tid, name: uniqueName(f.name, used, () => {}), type: p.type, options, sortOrder: t.fields.indexOf(f) * 2, description: [f.description, `Airtable ${f.id} (${f.type})`].filter(Boolean).join("\n") }).returning();
          await map.put(tx, "field", f.id, row.id, { sourceType: f.type, kind: "computed" });
          r.counts.fields.created++;
        }
        pending = pending.filter((x) => !ready.includes(x));
      }
      // Primary fields.
      for (const t of b.tables) { const tid = map.get("table", t.id); const pf = map.get("field", t.primaryFieldId); if (tid && pf) await tx.update(baseTables).set({ primaryFieldId: pf }).where(eq(baseTables.id, tid)); }
    }
    // Views (name + type only — saved filters/sorts/layout aren't in the export).
    for (const t of b.tables) {
      const vs = b.views[t.id] ?? [];
      r.counts.views.source += vs.length;
      const list = vs.length ? vs : [{ id: `default:${t.id}`, name: "Grid view", type: "grid" }];
      for (const [i, v] of list.entries()) {
        if (map.get("view", v.id)) { r.counts.views.existing++; continue; }
        const type = VIEW_TYPES.has(v.type) ? v.type : "grid";
        if (type !== v.type) warn("view", v.id, `${t.name} / ${v.name}`, "view type fallback", `view type ${v.type} isn't supported — created as a grid view`);
        r.counts.views.created++;
        if (!apply) continue;
        const [row] = await tx.insert(baseViews).values({ orgId: ctx.orgId, createdBy: ctx.userId, tableId: map.get("table", t.id)!, name: v.name.slice(0, 120), type, config: {}, sortOrder: i }).returning();
        await map.put(tx, "view", v.id, row.id, { sourceType: v.type });
      }
    }
    if (vsWarned(b)) warn("base", b.baseId, b.baseName, "view settings not exported", "Airtable view filters, sorts, grouping, colours and field order are not in the export; views were created with names and types only");
    // Forms → form views.
    for (const fd of b.forms) {
      const s = fd.schema; const tid = map.get("table", s.sourceTableId);
      const elements = s.sections.flatMap((sec) => sec.rows.flatMap((row) => row.elements));
      const fields: NonNullable<NonNullable<ViewConfig["form"]>["fields"]> = [];
      const notes: string[] = [];
      for (const e of elements) {
        const target = map.get("field", e.fieldId); const p = plans.get(e.fieldId);
        if (!p) { notes.push(`element for unknown field ${e.fieldId} skipped`); continue; }
        if (e.isReadOnly) notes.push(`read-only element ${e.label ?? e.fieldId} shown as normal input`);
        if (e.prefilledValue !== undefined) notes.push(`prefilled value for ${e.label ?? e.fieldId} not applied`);
        if (target || !apply) fields.push({ fieldId: target ?? e.fieldId, required: !!e.isRequired, ...(e.helperText ? { help: e.helperText } : {}) });
      }
      if (s.sections.length > 1) notes.push(`${s.sections.length} sections flattened into one list (section titles not supported)`);
      const existing = map.get("form", fd.pageId);
      r.forms.push({ sourceId: fd.pageId, name: fd.name, status: existing ? "form view (already imported)" : tid || !apply ? "form view created" : "table missing", elements: elements.length, mappedElements: fields.length, notes });
      if (existing || !apply || !tid) continue;
      const [row] = await tx.insert(baseViews).values({ orgId: ctx.orgId, createdBy: ctx.userId, tableId: tid, name: fd.name.slice(0, 120), type: "form", sortOrder: 100,
        config: { form: { title: fd.name, description: s.description ?? undefined, fields, submitLabel: "Submit" } } }).returning();
      await map.put(tx, "form", fd.pageId, row.id, { sections: s.sections.length });
    }
    // Automations — always disabled.
    for (const a of b.automations) {
      const tr = translateAutomation(a.config, map, fieldById, b);
      const existing = map.get("automation", a.id);
      const entry = { sourceId: a.id, name: a.name, sourceStatus: a.config.deploymentStatus ?? "unknown", created: !!existing, targetId: existing, trigger: tr.triggerLabel, translatedSteps: tr.steps, untranslated: tr.untranslated };
      r.automations.push(entry);
      if (existing || !tr.trigger || !tr.actions.length) continue;
      entry.created = true;
      if (!apply) continue;
      const [row] = await tx.insert(baseAutomations).values({ orgId: ctx.orgId, createdBy: ctx.userId, baseId: baseId!, name: `[Imported] ${a.name}`.slice(0, 120), isEnabled: false,
        trigger: tr.trigger as unknown as Record<string, unknown>, actions: tr.actions as unknown as Record<string, unknown>[] }).returning();
      await map.put(tx, "automation", a.id, row.id, { sourceStatus: a.config.deploymentStatus, untranslated: tr.untranslated });
      entry.targetId = row.id;
    }
  };
  if (apply) await db.transaction(structure); else await db.transaction(async (tx) => { await structure(tx); });

  // Pages / interfaces inventory (layouts aren't exported → mapping report only).
  const formIds = new Set(b.forms.map((f) => f.pageId));
  for (const i of b.pages.interfaces ?? []) for (const pg of i.pages ?? []) r.pages.push({ sourceId: pg.id, name: pg.name, kind: "interface page", pageType: pg.pageType, interface: i.name, status: "needs manual rebuild in the app builder (element layout not exported)" });
  for (const pg of b.pages.recordDetailPages ?? []) r.pages.push({ sourceId: pg.id, name: pg.name, kind: "record detail page", status: "covered by the native record detail view", targetTableId: pg.sourceTableId ? map.get("table", pg.sourceTableId) ?? null : null });
  for (const pg of b.pages.standaloneForms ?? []) r.pages.push({ sourceId: pg.id, name: pg.name, kind: "standalone form", status: formIds.has(pg.id) ? "imported as form view" : "form layout not exported — needs manual rebuild", targetTableId: pg.sourceTableId ? map.get("table", pg.sourceTableId) ?? null : null });
  for (const pg of b.pages.embeddedForms ?? []) r.pages.push({ sourceId: pg.id, name: pg.name, kind: "embedded form", status: formIds.has(pg.id) ? "imported as form view" : "form layout not exported — needs manual rebuild", targetTableId: pg.sourceTableId ? map.get("table", pg.sourceTableId) ?? null : null });
  for (const pg of b.pages.draftPages ?? []) r.pages.push({ sourceId: pg.id, name: pg.interfaceName ?? "(draft page)", kind: "draft page", pageType: pg.pageType, status: "draft in Airtable — not migrated" });

  // ───── Records (pass 1: values; pass 2: links) ─────
  const recordMap = new Map<string, string>(); // source record id → target id
  const targetFieldMeta = new Map<string, { id: string; type: string }>();
  if (apply) for (const t of b.tables) for (const f of t.fields) {
    const id = map.get("field", f.id); if (!id) continue;
    const [row] = await db.select({ id: baseFields.id, type: baseFields.type }).from(baseFields).where(eq(baseFields.id, id)); if (row) targetFieldMeta.set(f.id, row);
  }
  for (const t of b.tables) {
    const src = b.records[t.id] ?? [];
    const tr: TableReport = { sourceTableId: t.id, name: t.name, targetTableId: map.get("table", t.id) ?? null, sourceRecords: src.length, manifestRecords: mb?.tableRecordCounts?.[t.id] ?? null, created: 0, updated: 0, unchanged: 0, afterImport: null };
    r.tables.push(tr);
    const tid = tr.targetTableId;
    const existing = tid ? await db.select({ id: baseRecords.id, ref: baseRecords.sourceRef, data: baseRecords.data }).from(baseRecords).where(and(eq(baseRecords.tableId, tid), isNull(baseRecords.deletedAt))) : [];
    const byRef = new Map(existing.filter((e) => e.ref).map((e) => [e.ref!, e]));
    for (const rec of src) { const e = byRef.get(sourceRef(b, t.id, rec.id)); if (e) recordMap.set(rec.id, e.id); }
    const plainOf = (rec: (typeof src)[number]) => {
      const out: Record<string, unknown> = {};
      for (const f of t.fields) {
        const meta = targetFieldMeta.get(f.id); const p = plans.get(f.id)!;
        if (!meta || meta.type === "link" || COMPUTED_TARGET.has(meta.type)) continue;
        const effective: FieldPlan = meta.type === "longText" && p.kind !== "plain" ? { ...p, kind: "fallback" } : p;
        const v = convertCell(f, effective, rec.cellValuesByFieldId[f.id]);
        if (v !== undefined && !(Array.isArray(v) && !v.length)) out[meta.id] = v;
        if (f.type === "multipleAttachments" && Array.isArray(v)) r.attachments.pendingTransfer += v.length;
      }
      return out;
    };
    if (!apply) { for (const rec of src) { if (byRef.has(sourceRef(b, t.id, rec.id))) tr.unchanged++; else tr.created++; for (const f of t.fields) if (f.type === "multipleAttachments" && Array.isArray(rec.cellValuesByFieldId[f.id])) r.attachments.pendingTransfer += (rec.cellValuesByFieldId[f.id] as unknown[]).length; } continue; }
    const linkTargets = new Set(t.fields.filter((f) => targetFieldMeta.get(f.id)?.type === "link").map((f) => targetFieldMeta.get(f.id)!.id));
    const toInsert: { rec: (typeof src)[number]; data: Record<string, unknown> }[] = [];
    for (const rec of src) {
      const data = plainOf(rec);
      const cur = byRef.get(sourceRef(b, t.id, rec.id));
      if (!cur) { toInsert.push({ rec, data }); continue; }
      const curPlain = Object.fromEntries(Object.entries(cur.data).filter(([k]) => !linkTargets.has(k)));
      if (stable(curPlain) === stable(data)) { tr.unchanged++; continue; }
      const links = Object.fromEntries(Object.entries(cur.data).filter(([k]) => linkTargets.has(k)));
      await db.update(baseRecords).set({ data: { ...data, ...links }, updatedAt: new Date(), updatedBy: ctx.userId, version: sql`${baseRecords.version} + 1` }).where(eq(baseRecords.id, cur.id));
      tr.updated++;
    }
    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200);
      await db.transaction(async (tx) => {
        const [{ seq }] = await tx.update(baseTables).set({ autonumberSeq: sql`${baseTables.autonumberSeq} + ${chunk.length}` }).where(eq(baseTables.id, tid!)).returning({ seq: baseTables.autonumberSeq });
        const first = seq - chunk.length + 1;
        const rows = await tx.insert(baseRecords).values(chunk.map(({ rec, data }, k) => {
          const created = rec.createdTime ? new Date(rec.createdTime) : new Date();
          return { orgId: ctx.orgId, tableId: tid!, data, autonumber: first + k, sortOrder: first + k, createdAt: created, updatedAt: created, createdBy: ctx.userId, updatedBy: ctx.userId, sourceRef: sourceRef(b, t.id, rec.id) };
        })).onConflictDoNothing({ target: [baseRecords.tableId, baseRecords.sourceRef] }).returning({ id: baseRecords.id, ref: baseRecords.sourceRef });
        for (const row of rows) recordMap.set(row.ref!.split("/")[2], row.id);
        tr.created += rows.length;
      });
    }
  }
  // Links: every Airtable link field carries its own values, so both directions are written as exported.
  for (const t of b.tables) for (const f of t.fields) {
    if (plans.get(f.id)?.kind !== "link") continue;
    for (const rec of b.records[t.id] ?? []) {
      const vals = (rec.cellValuesByFieldId[f.id] as { id: string }[] | undefined) ?? [];
      if (!Array.isArray(vals) || !vals.length) continue;
      r.links.valuesInRecords += vals.length;
      const ids: string[] = [];
      for (const v of vals) {
        const target = recordMap.get(v.id);
        const known = apply ? !!target : (b.records[f.config.linkedTableId!] ?? []).some((x) => x.id === v.id);
        if (known) { r.links.resolved++; if (target) ids.push(target); } else r.links.unresolved.push({ tableId: t.id, recordId: rec.id, fieldId: f.id, targetRecordId: v.id });
      }
      if (!apply) continue;
      const fid = targetFieldMeta.get(f.id)?.id; const rid = recordMap.get(rec.id);
      if (!fid || !rid) continue;
      const unique = [...new Set(ids)];
      await db.execute(sql`update base_records set data = jsonb_set(data, ${`{${fid}}`}::text[], ${JSON.stringify(unique)}::jsonb) where id = ${rid} and (data -> ${fid}) is distinct from ${JSON.stringify(unique)}::jsonb`);
    }
  }
  if (apply) {
    // Record counts after import + formula fidelity (recomputed vs exported values).
    for (const tr of r.tables) {
      if (!tr.targetTableId) continue;
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(baseRecords).where(and(eq(baseRecords.tableId, tr.targetTableId), isNull(baseRecords.deletedAt), sql`${baseRecords.sourceRef} like ${`${b.baseId}/${tr.sourceTableId}/%`}`));
      tr.afterImport = n;
    }
    for (const t of b.tables) {
      const formulas = t.fields.filter((f) => f.type === "formula" && targetFieldMeta.get(f.id)?.type === "formula");
      if (!formulas.length || !(b.records[t.id] ?? []).length) continue;
      const tid = map.get("table", t.id)!;
      let v: Awaited<ReturnType<typeof runView>>;
      try { v = await runView({ ...ctx, platformRole: "owner" }, "owner", tid, {}); } catch { continue; }
      const byId = new Map(v.rows.map((x) => [x.id, x]));
      for (const f of formulas) {
        r.formulaFidelity.fields++;
        let mism = 0; let sample: { recordId: string; exported: string; recomputed: string } | undefined;
        const src = (f.config.formula ?? "").toUpperCase();
        // Known, expected differences are classified rather than counted as errors.
        const explain = (want: string, got: string) =>
          timeDependent(f.id, t) ? "time-dependent (TODAY/NOW at export vs now, directly or via another formula)"
          : /\bRECORD_ID\s*\(/.test(src) ? "uses RECORD_ID() (new record IDs by design)"
          : ["NaN", "Infinity", "-Infinity"].includes(want) && (got === "" || got === "#ERROR") ? "Airtable NaN/Infinity vs blank"
          : want === "" && (got === "0" || got === "false") ? "blank vs 0/false (Airtable omits false values)"
          : null;
        for (const rec of b.records[t.id]) {
          const row = byId.get(recordMap.get(rec.id) ?? ""); if (!row) continue;
          const want = comparable(rec.cellValuesByFieldId[f.id]); const got = comparable(row.values[targetFieldMeta.get(f.id)!.id]);
          r.formulaFidelity.compared++;
          if (want === got || (want === "" && (got === "" || got === "#ERROR"))) { r.formulaFidelity.matched++; continue; }
          const why = explain(want, got);
          if (why) r.formulaFidelity.explained[why] = (r.formulaFidelity.explained[why] ?? 0) + 1;
          else r.formulaFidelity.mismatched++;
          mism++; sample ??= { recordId: rec.id, exported: want.slice(0, 120), recomputed: got.slice(0, 120) };
        }
        // The sample is written only to the private report, to help verify the difference by hand.
        if (mism) r.formulaFidelity.mismatchedFields.push({ fieldId: f.id, name: `${t.name}.${f.name}`, mismatches: mism, reason: explain(sample!.exported, sample!.recomputed) ?? "unexplained — verify", sample });
      }
    }
    await audit(db, ctx, "airtable_base_import", "bases", r.targetBaseId, { meta: { sourceBaseId: b.baseId, records: r.tables.reduce((n, t) => n + t.created, 0) } });
  }
  return r;
}

const vsWarned = (b: PackBase) => Object.values(b.views).some((v) => v.length > 0);
/** True if a formula uses TODAY()/NOW(), directly or through formulas it references in the same table. */
function timeDependent(fieldId: string, t: AtTable, seen = new Set<string>()): boolean {
  if (seen.has(fieldId)) return false; seen.add(fieldId);
  const f = t.fields.find((x) => x.id === fieldId);
  if (!f || f.type !== "formula") return false;
  const src = f.config.formula ?? "";
  if (/\b(TODAY|NOW)\s*\(/i.test(src)) return true;
  const refs = [...src.matchAll(/\{([^}]+)\}/g)].map((m) => t.fields.find((x) => x.id === m[1] || x.name === m[1])?.id).filter(Boolean) as string[];
  return refs.some((id) => timeDependent(id, t, seen));
}
function uniqueName(name: string, used: Set<string>, onDup: () => void) {
  let n = name.trim().slice(0, 120) || "Field"; let k = 2;
  if (used.has(n.toLowerCase())) { onDup(); while (used.has(`${n} (${k})`.toLowerCase())) k++; n = `${n} (${k})`; }
  used.add(n.toLowerCase()); return n;
}

// ───────── Automation translation ─────────
type OurAction = Record<string, unknown> & { type: string };
type Cond = { fieldId: string; op: string; value?: unknown };
export function translateAutomation(c: { deploymentStatus?: string; trigger: { type: string; inputs?: { tableId?: string; filtersObj?: unknown } }; nodes?: AtNode[] }, map: { get(kind: Kind, id: string): string | undefined }, fieldById: Map<string, { f: AtField; t: AtTable }>, b: PackBase) {
  const untranslated: string[] = [];
  const srcTable = c.trigger.inputs?.tableId;
  const tableId = srcTable ? map.get("table", srcTable) ?? (srcTable ? `pending:${srcTable}` : undefined) : undefined;
  let trigger: Record<string, unknown> | null = null; let triggerLabel = c.trigger.type;
  const conds = (filters: unknown) => translateFilter(filters, map, fieldById, untranslated);
  if (!tableId) untranslated.push(`trigger ${c.trigger.type} (no table)`);
  else if (c.trigger.type === "recordCreated") { trigger = { type: "record_created", tableId }; triggerLabel = "record created"; }
  else if (c.trigger.type === "formSubmitted") { trigger = { type: "record_created", tableId }; triggerLabel = "form submitted → record created"; }
  else if (c.trigger.type === "recordMatchesConditions") { const f = conds(c.trigger.inputs?.filtersObj); trigger = { type: "record_matches", tableId, ...(f ? { conditions: f } : {}) }; triggerLabel = "record matches conditions"; }
  else if (c.trigger.type === "recordUpdated") { trigger = { type: "record_updated", tableId }; triggerLabel = "record updated"; }
  else untranslated.push(`trigger ${c.trigger.type}`);
  const fieldName = (srcFieldId: string) => fieldById.get(srcFieldId)?.f.name;
  const value = (v: unknown, targetField: string, onLinkToTrigger: () => void): { ok: boolean; v?: unknown } => {
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) return { ok: true, v };
    const o = v as Record<string, unknown>;
    if (o.obj && typeof o.obj === "object" && "id" in (o.obj as object)) return { ok: true, v: String((o.obj as { id: string }).id) };
    if (Array.isArray(o.template)) {
      const parts = o.template as unknown[];
      if (parts.length === 1 && (parts[0] as { $ref?: string; path?: string[] })?.$ref === "trigger" && (parts[0] as { path: string[] }).path?.join(".") === "id") { onLinkToTrigger(); return { ok: false }; }
      let out = "";
      for (const p of parts) {
        if (typeof p === "string") { out += p; continue; }
        const ref = p as { $ref?: string; path?: string[] };
        if (ref.$ref === "trigger" && ref.path?.[0] === "cellValuesByFieldId" && ref.path[1] && fieldName(ref.path[1])) { out += `{${fieldName(ref.path[1])}}`; continue; }
        return { ok: false };
      }
      return { ok: true, v: out };
    }
    void targetField; return { ok: false };
  };
  const fieldsObj = (tableSrc: string | undefined, fields: unknown, onLink?: (target: string) => void) => {
    const out: Record<string, unknown> = {}; let dropped = 0;
    for (const [fid, raw] of Object.entries(((fields as { obj?: Record<string, unknown> })?.obj) ?? {})) {
      const target = map.get("field", fid) ?? (map.get("table", tableSrc ?? "") ? undefined : `pending:${fid}`);
      if (!target) { dropped++; continue; }
      const r = value(raw, target, () => onLink?.(target));
      if (r.ok) out[target] = r.v; else if (!onLink) dropped++;
    }
    return { out, dropped };
  };
  const walk = (nodes: AtNode[], depth: number): OurAction[] => {
    const acts: OurAction[] = [];
    for (const n of nodes) {
      const inp = (n.inputs ?? {}) as { tableId?: string; rowId?: { template?: { $ref?: string; path?: string[] }[] }; fields?: unknown };
      if (n.type === "updateRecord") {
        const onTrigger = inp.tableId === srcTable && inp.rowId?.template?.length === 1 && inp.rowId.template[0]?.$ref === "trigger" && inp.rowId.template[0]?.path?.join(".") === "id";
        if (!onTrigger) { untranslated.push("updateRecord on a non-trigger record"); continue; }
        const { out, dropped } = fieldsObj(inp.tableId, inp.fields);
        if (dropped) untranslated.push(`updateRecord: ${dropped} field value(s) not translatable`);
        if (Object.keys(out).length) acts.push({ type: "update_record", values: out });
      } else if (n.type === "createRecord") {
        const tid = inp.tableId ? map.get("table", inp.tableId) ?? `pending:${inp.tableId}` : undefined;
        if (!tid) { untranslated.push("createRecord without table"); continue; }
        let linkFieldId: string | undefined;
        const { out, dropped } = fieldsObj(inp.tableId, inp.fields, (target) => { linkFieldId = target; });
        if (dropped) untranslated.push(`createRecord: ${dropped} field value(s) not translatable`);
        acts.push({ type: "create_record", tableId: tid, values: out, ...(linkFieldId ? { linkFieldId } : {}) });
      } else if (n.type === "conditionalGroup") {
        const branches = n.branches ?? [];
        if (depth >= 3) { untranslated.push("conditionalGroup nested too deep"); continue; }
        const chain = (i: number): OurAction[] => {
          if (i >= branches.length) return [];
          const br = branches[i];
          const cond = translateBranchCondition(br.condition, map, fieldById);
          const thenActs = walk(br.nodes ?? [], depth + 1);
          if (!br.condition) return thenActs; // "otherwise" branch
          if (!cond) { untranslated.push("conditionalGroup branch condition"); return chain(i + 1); }
          return [{ type: "branch", conditions: cond, then: thenActs, else: chain(i + 1) }];
        };
        acts.push(...chain(0));
      } else untranslated.push(n.type);
    }
    return acts;
  };
  const actions = walk(c.nodes ?? [], 0);
  const count = (a: OurAction[]): number => a.reduce((n, x) => n + 1 + (x.type === "branch" ? count(x.then as OurAction[]) + count(x.else as OurAction[]) : 0), 0);
  void b;
  return { trigger, triggerLabel, actions, steps: count(actions), untranslated };
}

const OPS: Record<string, string> = { isEmpty: "isEmpty", isNotEmpty: "isNotEmpty", "=": "is", "!=": "isNot", ">": ">", ">=": ">=", "<": "<", "<=": "<=", contains: "contains", doesNotContain: "doesNotContain", hasAnyOf: "hasAnyOf", hasAllOf: "hasAllOf", hasNoneOf: "hasNoneOf", isAnyOf: "isAnyOf", isNoneOf: "isNoneOf" };
const NUMERIC = new Set(["number", "currency", "percent", "rating", "duration", "autoNumber", "count", "rollup"]);
function leaf(fieldSrc: string, op: string, value: unknown, map: { get(kind: Kind, id: string): string | undefined }, fieldById: Map<string, { f: AtField; t: AtTable }>): Cond | null {
  const f = fieldById.get(fieldSrc); const target = map.get("field", fieldSrc) ?? (f ? `pending:${fieldSrc}` : undefined);
  if (!f || !target || !OPS[op]) return null;
  let our = OPS[op];
  if (NUMERIC.has(f.f.type) && (op === "=" || op === "!=")) our = op === "=" ? "=" : "!=";
  if (["date", "dateTime"].includes(f.f.type) && op === ">=") return null;
  return { fieldId: target, op: our, ...(value !== undefined ? { value: value && typeof value === "object" && "id" in (value as object) ? (value as { id: string }).id : value } : {}) };
}
function translateFilter(filters: unknown, map: { get(kind: Kind, id: string): string | undefined }, fieldById: Map<string, { f: AtField; t: AtTable }>, untranslated: string[]): ViewConfig["filters"] | undefined {
  const root = (filters as { obj?: { operator?: string; operands?: { tuple?: unknown[] } } })?.obj;
  if (!root) return undefined;
  const conj = root.operator === "or" ? "or" : "and";
  const items = root.operator === "and" || root.operator === "or" ? root.operands?.tuple ?? [] : [filters];
  const conditions: Cond[] = [];
  for (const it of items) {
    const o = (it as { obj?: { operator?: string; operands?: { tuple?: unknown[] } } }).obj;
    const tuple = o?.operands?.tuple ?? [];
    const c = o && typeof tuple[0] === "string" ? leaf(tuple[0] as string, o.operator ?? "", tuple[1], map, fieldById) : null;
    if (c) conditions.push(c); else untranslated.push(`trigger condition ${o?.operator ?? "?"}`);
  }
  return conditions.length ? { conjunction: conj, conditions } : undefined;
}
function translateBranchCondition(cond: unknown, map: { get(kind: Kind, id: string): string | undefined }, fieldById: Map<string, { f: AtField; t: AtTable }>): ViewConfig["filters"] | null {
  const c = cond as { conjunction?: string; conditions?: { left?: { $ref?: string; path?: string[]; fn?: string; args?: { $ref?: string; path?: string[] }[] }; operator?: string; right?: unknown }[] } | undefined;
  if (!c?.conditions?.length) return null;
  const out: Cond[] = [];
  for (const x of c.conditions) {
    const ref = x.left?.fn === "length" ? x.left.args?.[0] : x.left;
    if (ref?.$ref !== "trigger" || ref.path?.[0] !== "cellValuesByFieldId" || !ref.path[1]) return null;
    const l = leaf(ref.path[1], x.operator ?? "", typeof x.right === "object" ? (x.right as { id?: string })?.id ?? undefined : x.right, map, fieldById);
    if (!l) return null;
    out.push(l);
  }
  return { conjunction: c.conjunction === "or" ? "or" : "and", conditions: out };
}
