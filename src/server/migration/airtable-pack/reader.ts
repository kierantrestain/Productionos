/**
 * Reader + validator for a read-only Airtable export pack (directory layout:
 * 00_MANIFEST.json, bases/<name>/{00_BASE_SUMMARY.json, 01_schema, 02_interfaces, 03_automations, 04_records, 05_mapping}).
 * The pack is untrusted input: everything is parsed defensively and never executed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type AtChoice = { id: string; name: string; color?: string };
export type AtFieldConfig = {
  choices?: AtChoice[]; precision?: number; symbol?: string; max?: number; dateFormat?: unknown; timeFormat?: unknown; timeZone?: string;
  linkedTableId?: string; inverseLinkFieldId?: string; prefersSingleRecordLink?: boolean;
  recordLinkFieldId?: string; fieldIdInLinkedTable?: string; formula?: string; isValid?: boolean; referencedFieldIds?: string[];
  result?: { type: string; options?: unknown }; filters?: unknown; durationFormat?: string;
};
export type AtField = { id: string; name: string; type: string; description?: string; config: AtFieldConfig };
export type AtTable = { id: string; name: string; primaryFieldId: string; description?: string; fields: AtField[] };
export type AtView = { id: string; name: string; type: string };
export type AtRecord = { id: string; createdTime?: string; cellValuesByFieldId: Record<string, unknown> };
export type AtFormElement = { fieldId: string; label?: string; fieldType?: string; isRequired?: boolean; isReadOnly?: boolean; helperText?: string; options?: unknown; prefilledValue?: unknown };
export type AtForm = { pageId: string; name: string; schema: { pageId: string; name?: string; description?: string; submissionAction?: string; sourceTableId: string; sourceTableName?: string; sections: { id?: string; title?: string; rows: { elements: AtFormElement[] }[] }[] } };
export type AtPages = {
  interfaces?: { id: string; name: string; pages?: { id: string; interfaceId?: string; name: string; description?: string; pageType?: string; content?: string }[] }[];
  recordDetailPages?: { id: string; name: string; sourceTableId?: string }[];
  draftPages?: { id: string; interfaceId?: string | null; interfaceName?: string | null; pageType?: string }[];
  standaloneForms?: { id: string; name: string; sourceTableId?: string; description?: string }[];
  embeddedForms?: { id: string; name: string; sourceTableId?: string; interfaceIds?: string[] }[];
};
export type AtAutomation = { id: string; name: string; config: { deploymentStatus?: string; trigger: { type: string; inputs?: { tableId?: string; filtersObj?: unknown } }; nodes?: AtNode[] } };
export type AtNode = { key?: string; type: string; inputs?: Record<string, unknown>; branches?: { condition?: unknown; nodes?: AtNode[] }[] };
export type AtAttachmentRef = { tableId: string; recordId: string; fieldId: string; id: string; filename: string; size?: number; type?: string };
export type AtEdge = { tableId: string; recordId: string; fieldId: string; targetTableId: string; targetRecordId: string };

export interface PackBase {
  dir: string; key: string; baseId: string; baseName: string;
  summary: Record<string, unknown> & { tableRecordCounts?: Record<string, number> };
  tables: AtTable[]; views: Record<string, AtView[]>; records: Record<string, AtRecord[]>;
  forms: AtForm[]; pages: AtPages; automations: AtAutomation[];
  attachments: AtAttachmentRef[]; edges: AtEdge[];
}
export interface ManifestBase { baseId: string; baseName: string; tables: number; fields: number; records: number; views: number; automationDefinitions?: number; publishedPages?: number; formSchemas?: number; attachmentReferences?: number; linkEdges?: number; tableRecordCounts?: Record<string, number> }
export interface Pack { dir: string; exportDateUTC?: string; manifest: { bases: ManifestBase[] }; unresolvedLinks: unknown[]; bases: PackBase[]; issues: string[] }

const nameOr = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v : fallback);
const readJson = <T>(p: string, fallback: T): T => { if (!existsSync(p)) return fallback; return JSON.parse(readFileSync(p, "utf8")) as T; };

/** Load and validate a pack. `only` limits bases (by folder name, base id or base name). */
export function loadPack(dir: string, only?: string[]): Pack {
  const root = path.resolve(dir);
  const manifest = readJson<{ exportDateUTC?: string; bases: ManifestBase[] }>(path.join(root, "00_MANIFEST.json"), { bases: [] });
  if (!manifest.bases?.length) throw new Error(`No 00_MANIFEST.json with bases in ${root}`);
  const issues: string[] = [];
  const bases: PackBase[] = [];
  const baseDirs = existsSync(path.join(root, "bases")) ? readdirSync(path.join(root, "bases"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
  for (const key of baseDirs) {
    const d = path.join(root, "bases", key);
    const summary = readJson<Record<string, unknown>>(path.join(d, "00_BASE_SUMMARY.json"), {});
    const baseId = String(summary.baseId ?? "");
    const baseName = String(summary.baseName ?? key);
    if (only?.length && !only.some((o) => o === key || o === baseId || o.toLowerCase() === baseName.toLowerCase())) continue;
    const tablesRaw = readJson<{ id: string; name: string; primaryFieldId: string; description?: string; fields: { id: string; name: string; type: string; description?: string }[] }[]>(path.join(d, "01_schema", "tables.json"), []);
    const cfgRaw = readJson<{ tableId: string; fields: { id: string; type: string; config?: AtFieldConfig }[] }[]>(path.join(d, "01_schema", "field_configs.json"), []);
    const cfg = new Map<string, AtFieldConfig>();
    for (const t of cfgRaw) for (const f of t.fields) cfg.set(f.id, f.config ?? {});
    const tables: AtTable[] = tablesRaw.map((t) => ({ id: t.id, name: t.name, primaryFieldId: t.primaryFieldId, description: t.description, fields: t.fields.map((f) => ({ id: f.id, name: f.name, type: f.type, description: f.description, config: cfg.get(f.id) ?? {} })) }));
    const viewsRaw = readJson<Record<string, { tableId: string; views: AtView[] }>>(path.join(d, "01_schema", "views.json"), {});
    const views: Record<string, AtView[]> = {};
    for (const [tid, v] of Object.entries(viewsRaw)) views[v.tableId ?? tid] = v.views ?? [];
    const records: Record<string, AtRecord[]> = {};
    for (const t of tables) {
      const f = readJson<{ sourceTableId?: string; total?: number; records: AtRecord[] }>(path.join(d, "04_records", `${t.id}.json`), { records: [] });
      records[t.id] = f.records ?? [];
      if (typeof f.total === "number" && f.total !== records[t.id].length) issues.push(`${baseId}/${t.id}: file says total ${f.total} but has ${records[t.id].length} records`);
    }
    // Normalise names the export may omit (null/blank) so nothing downstream has to guess.
    for (const t of tables) { t.name = nameOr(t.name, `Table ${t.id}`); for (const f of t.fields) f.name = nameOr(f.name, `Field ${f.id}`); }
    for (const vs of Object.values(views)) for (const v of vs) v.name = nameOr(v.name, `View ${v.id}`);
    const forms = readJson<AtForm[]>(path.join(d, "02_interfaces", "form_definitions.json"), []);
    for (const f of forms) f.name = nameOr(f.name ?? f.schema?.name, `Form ${f.pageId}`);
    const automations = readJson<AtAutomation[]>(path.join(d, "03_automations", "automation_configurations.json"), []);
    for (const a of automations) a.name = nameOr(a.name, `Automation ${a.id}`);
    const pb: PackBase = {
      dir: d, key, baseId, baseName, summary, tables, views, records,
      forms,
      pages: readJson<AtPages>(path.join(d, "02_interfaces", "interfaces_pages.json"), {}),
      automations,
      attachments: readJson<AtAttachmentRef[]>(path.join(d, "05_mapping", "attachment_manifest.json"), []),
      edges: readJson<AtEdge[]>(path.join(d, "05_mapping", "linked_record_edges.json"), []),
    };
    issues.push(...validateBase(pb, manifest.bases.find((m) => m.baseId === baseId)));
    bases.push(pb);
  }
  if (!bases.length) throw new Error(only?.length ? `No bases matched ${only.join(", ")}` : "The pack has no bases/ folder");
  return { dir: root, exportDateUTC: manifest.exportDateUTC, manifest: { bases: manifest.bases }, unresolvedLinks: readJson<unknown[]>(path.join(root, "02_UNRESOLVED_LINKS.json"), []), bases, issues };
}

/** Structural checks: manifest counts, unique source ids, references resolvable inside the base. */
export function validateBase(b: PackBase, m?: ManifestBase): string[] {
  const out: string[] = [];
  if (!m) out.push(`${b.baseId}: not listed in 00_MANIFEST.json`);
  const fieldCount = b.tables.reduce((n, t) => n + t.fields.length, 0);
  const recordCount = Object.values(b.records).reduce((n, r) => n + r.length, 0);
  const viewCount = Object.values(b.views).reduce((n, v) => n + v.length, 0);
  if (m) {
    if (m.tables !== b.tables.length) out.push(`${b.baseId}: manifest tables ${m.tables} ≠ schema ${b.tables.length}`);
    if (m.fields !== fieldCount) out.push(`${b.baseId}: manifest fields ${m.fields} ≠ schema ${fieldCount}`);
    if (m.records !== recordCount) out.push(`${b.baseId}: manifest records ${m.records} ≠ record files ${recordCount}`);
    if (m.views !== viewCount) out.push(`${b.baseId}: manifest views ${m.views} ≠ views.json ${viewCount}`);
    for (const [tid, n] of Object.entries(m.tableRecordCounts ?? {})) if ((b.records[tid]?.length ?? 0) !== n) out.push(`${b.baseId}/${tid}: manifest ${n} records ≠ file ${b.records[tid]?.length ?? 0}`);
  }
  const ids = new Set<string>();
  for (const t of b.tables) {
    if (ids.has(t.id)) out.push(`duplicate table id ${t.id}`); ids.add(t.id);
    if (!t.fields.some((f) => f.id === t.primaryFieldId)) out.push(`${t.id}: primary field ${t.primaryFieldId} missing`);
    for (const f of t.fields) { if (ids.has(f.id)) out.push(`duplicate field id ${f.id}`); ids.add(f.id); }
  }
  const recIds = new Set<string>();
  for (const [tid, rs] of Object.entries(b.records)) for (const r of rs) { if (recIds.has(r.id)) out.push(`duplicate record id ${r.id} (table ${tid})`); recIds.add(r.id); }
  const tableIds = new Set(b.tables.map((t) => t.id));
  for (const t of b.tables) for (const f of t.fields) if (f.type === "multipleRecordLinks" && f.config.linkedTableId && !tableIds.has(f.config.linkedTableId)) out.push(`${f.id}: links to table ${f.config.linkedTableId} outside this base`);
  return out;
}
