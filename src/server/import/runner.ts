/**
 * Idempotent, read-only-source Airtable import.
 *
 * Pass 1 creates/updates canonical rows table by table (parents first) and records lineage in
 * source_records. Pass 2 resolves many-to-many links. Re-running with unchanged source data
 * writes no operational rows (status "unchanged"); changed records update their existing target.
 * Imports never emit actionable events: the only outbox event is a suppressed `import.completed`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { attachments, auditEvents, importBatches, importExceptions, productions, sourceRecords } from "@/db/schema";
import { isEntityKey } from "@/lib/entities";
import { emit } from "../audit";
import { sha256 } from "../auth/password";
import { storage } from "../storage";
import { DISPOSITION } from "./disposition";
import { AtRecord, AtTable, COMPUTED_TYPES, norm, Rec, scrubUrls, stableStringify } from "./record";
import { ARCHIVE_NOTES, ExceptionKind, ImportCtx, SPECS, Spec } from "./specs";

export const BASES = { Ovation_OS: "appGbXugVx1UAfw6B", Sappening_Production: "appkx0tyAT1SDGSz5" } as const;
type Alias = keyof typeof BASES;
const BASE_LABEL: Record<Alias, string> = { Ovation_OS: "Ovation OS", Sappening_Production: "S’appening Production" };
export const LEGACY_PRODUCTION_TITLE = "S'appening (legacy import)";

export interface ImportOptions { orgId: string; exportDir: string; mode: "dry_run" | "apply"; actorUserId?: string | null; inventoryPath?: string }
export interface TableReport { base: string; table: string; tableId: string; target: string; sourceCount: number; imported: number; updated: number; unchanged: number; archived: number; exceptions: number }
export interface ImportReport {
  batchId: string; mode: ImportOptions["mode"]; startedAt: string; finishedAt: string;
  tables: TableReport[];
  totals: Omit<TableReport, "base" | "table" | "tableId" | "target">;
  editingReconciliation: { scenesSourceCount: number; editingSourceCount: number; matched: number; matchedByLink: number; matchedByNumber: number; unmatched: number; scenesCreatedFromEditing: 0 };
  attachments: { stored: number; alreadyStored: number; hashMismatch: number; failedDownload: number; notDownloaded: number; noTarget: number };
  unmappedFields: { table: string; field: string; type: string }[];
  computedFieldsNotImported: number;
  exceptionsByKind: Record<string, number>;
  inventory: { expectedTables: number; exportedTables: number; missingTables: string[]; extraTables: string[]; recordDrift: { table: string; expected: number; actual: number }[]; fieldDrift: { table: string; expected: number; actual: number }[]; expectedRecordSum: number; actualRecordSum: number };
}

interface LoadedTable { alias: Alias; baseId: string; table: AtTable; records: AtRecord[] | null }
interface ManifestEntry { base_id: string; table_id: string; record_id: string; attachment_id?: string; filename?: string; path?: string; bytes?: number; sha256?: string; status?: string; error?: string }

class Rollback extends Error { constructor(public report: ImportReport) { super("dry-run rollback"); } }

export function loadExport(exportDir: string) {
  if (!existsSync(exportDir)) throw new Error(`Export directory not found: ${exportDir}`);
  const tables: LoadedTable[] = [];
  for (const alias of Object.keys(BASES) as Alias[]) {
    const schemaPath = path.join(exportDir, alias, "schema.json");
    if (!existsSync(schemaPath)) continue;
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as { tables: AtTable[] };
    for (const t of schema.tables) {
      const rp = path.join(exportDir, alias, "records", `${t.id}.json`);
      const records = existsSync(rp) ? (JSON.parse(readFileSync(rp, "utf8")) as { records: AtRecord[] }).records : null;
      tables.push({ alias, baseId: BASES[alias], table: t, records });
    }
  }
  const mp = path.join(exportDir, "export_manifest.json");
  const manifest = existsSync(mp) ? (JSON.parse(readFileSync(mp, "utf8")) as { attachment_manifest?: ManifestEntry[] }).attachment_manifest ?? [] : [];
  return { tables, manifest };
}

function readInventory(p: string) {
  if (!existsSync(p)) return [];
  const [, ...lines] = readFileSync(p, "utf8").trim().split(/\r?\n/);
  return lines.map((l) => { const [base, table, tableId, fields, records] = l.split(","); return { base, table, tableId, fields: +fields, records: +records }; });
}

export async function runImport(opts: ImportOptions): Promise<ImportReport> {
  const { tables, manifest } = loadExport(opts.exportDir);
  const startedAt = new Date().toISOString();
  try {
    return await db.transaction(async (tx) => {
      const report = await importInTx(tx, opts, tables, manifest, startedAt);
      if (opts.mode === "dry_run") throw new Rollback(report);
      return report;
    });
  } catch (e) {
    if (e instanceof Rollback) return e.report;
    throw e;
  }
}

async function importInTx(tx: Tx, opts: ImportOptions, tables: LoadedTable[], manifest: ManifestEntry[], startedAt: string): Promise<ImportReport> {
  const { orgId } = opts;
  const actor = opts.actorUserId ?? null;
  const [batch] = await tx.insert(importBatches).values({ orgId, mode: opts.mode, sourceLabel: path.basename(path.resolve(opts.exportDir)), startedBy: actor }).returning();

  // Existing lineage → in-memory map (Airtable record ids are globally unique).
  const existing = await tx.select({ recordId: sourceRecords.recordId, baseId: sourceRecords.baseId, tableId: sourceRecords.tableId, type: sourceRecords.targetEntityType, id: sourceRecords.targetId, hash: sourceRecords.sourceHash }).from(sourceRecords).where(eq(sourceRecords.orgId, orgId));
  const lineage = new Map(existing.map((x) => [x.recordId, x]));
  const map = new Map<string, { type: string; id: string }>();
  for (const x of existing) if (x.type && x.id) map.set(x.recordId, { type: x.type, id: x.id });

  const exceptions: { kind: ExceptionKind; tableId: string; baseId: string; recordId: string | null; detail: string }[] = [];
  const tableBase = new Map(tables.map((t) => [t.table.id, t.baseId]));
  let legacyId: string | null = null;
  const ctx: ImportCtx = {
    tx, orgId, map,
    editing: { matched: 0, matchedByLink: 0, matchedByNumber: 0, unmatched: 0 },
    exception: (kind, tableId, recordId, detail) => exceptions.push({ kind, tableId, baseId: tableBase.get(tableId) ?? "", recordId, detail: detail.slice(0, 2000) }),
    async legacyProductionId() {
      if (legacyId) return legacyId;
      const [p] = await tx.select({ id: productions.id }).from(productions).where(and(eq(productions.orgId, orgId), eq(productions.isLegacyImport, true), eq(productions.title, LEGACY_PRODUCTION_TITLE))).limit(1);
      legacyId = p?.id ?? (await tx.insert(productions).values({ orgId, title: LEGACY_PRODUCTION_TITLE, kind: "series", usesEpisodes: true, isLegacyImport: true, baseLocation: "Liverpool", description: "Parent production for records imported from the S'appening Airtable base. Kept distinct from the new Bang On slate. Status not verified from source." }).returning({ id: productions.id }))[0].id;
      return legacyId;
    },
  };

  const reports: TableReport[] = [];
  const pass2: { spec: Spec; rec: Rec; targetId: string }[] = [];
  const recsByTable = new Map<string, Rec[]>();
  const handled = new Set<string>();

  const upsertLineage = async (t: LoadedTable, rec: AtRecord, hash: string, status: string, target: { type: string; id: string } | null, note: string | null) => {
    const byName: Record<string, unknown> = {};
    for (const f of t.table.fields) if (rec.fields[f.id] !== undefined) byName[f.name] = scrubUrls(rec.fields[f.id]);
    const values = { orgId, baseId: t.baseId, tableId: t.table.id, tableName: t.table.name, recordId: rec.id, targetEntityType: target?.type ?? null, targetId: target?.id ?? null, importBatchId: batch.id, sourceModifiedAt: rec.createdTime ? new Date(rec.createdTime) : null, sourceHash: hash, migrationStatus: status, resolutionNote: note, raw: { createdTime: rec.createdTime ?? null, fields: byName }, importedAt: new Date() };
    await tx.insert(sourceRecords).values(values).onConflictDoUpdate({ target: [sourceRecords.orgId, sourceRecords.baseId, sourceRecords.tableId, sourceRecords.recordId], set: values });
  };

  // ── Pass 1: canonical entities, in dependency order ──
  for (const spec of SPECS) {
    const t = tables.find((x) => x.alias === spec.base && norm(x.table.name) === norm(spec.table));
    if (!t) continue;
    handled.add(t.table.id);
    const rep: TableReport = { base: BASE_LABEL[t.alias], table: t.table.name, tableId: t.table.id, target: spec.target, sourceCount: t.records?.length ?? 0, imported: 0, updated: 0, unchanged: 0, archived: 0, exceptions: 0 };
    reports.push(rep);
    if (!t.records) continue;
    const byNorm = new Map(t.table.fields.map((f) => [norm(f.name), f]));
    const recs: Rec[] = [];
    for (const raw of t.records) {
      const rec = new Rec(t.table, raw, byNorm);
      recs.push(rec);
      const hash = sha256(stableStringify(raw.fields));
      const prev = lineage.get(raw.id);
      const prevTarget = prev?.id && prev.type === spec.target ? prev.id : null;
      const built = await spec.build(rec, ctx);
      if (!built) { rep.exceptions++; await upsertLineage(t, raw, hash, "exception", prevTarget ? { type: spec.target, id: prevTarget } : null, "Not imported — see import_exceptions"); continue; }
      let targetId = prevTarget;
      let status: "imported" | "updated" | "unchanged";
      if (targetId && prev!.hash === hash) {
        status = "unchanged";
      } else {
        const { id: _id, subjectId: _sid, ...updateValues } = built.values as Record<string, unknown>;
        let updated = false;
        if (targetId) {
          const rows = await tx.update(spec.pg).set({ ...updateValues, updatedAt: new Date() }).where(and(eq(spec.pg.id, targetId), eq(spec.pg.orgId, orgId))).returning({ id: spec.pg.id });
          updated = rows.length > 0;
        }
        if (updated) status = "updated";
        else {
          const [row] = await tx.insert(spec.pg).values({ ...built.values, orgId, createdBy: actor }).returning({ id: spec.pg.id });
          targetId = row.id as string;
          status = "imported";
        }
        await tx.insert(auditEvents).values({ orgId, actorUserId: actor, actorLabel: "Airtable import", action: "import", entityType: spec.target, entityId: targetId, meta: { batchId: batch.id, status, source: `${t.baseId}/${t.table.id}/${raw.id}` } });
      }
      rep[status]++;
      map.set(raw.id, { type: spec.target, id: targetId! });
      await upsertLineage(t, raw, hash, status, { type: spec.target, id: targetId! }, null);
      if (spec.after && status !== "unchanged") await spec.after(rec, ctx, targetId!);
      if (spec.links) pass2.push({ spec, rec, targetId: targetId! });
    }
    recsByTable.set(t.table.id, recs);
  }

  // ── Archive-only tables (no canonical target yet, or superseded logs) ──
  for (const t of tables) {
    if (handled.has(t.table.id)) continue;
    const disp = DISPOSITION.find((d) => d.tableId === t.table.id || norm(d.table) === norm(t.table.name));
    const rep: TableReport = { base: BASE_LABEL[t.alias], table: t.table.name, tableId: t.table.id, target: disp?.kind === "canonical" ? disp.target : "archived", sourceCount: t.records?.length ?? 0, imported: 0, updated: 0, unchanged: 0, archived: 0, exceptions: 0 };
    reports.push(rep);
    if (!t.records?.length) continue;
    const note = ARCHIVE_NOTES[t.table.name] ?? "No canonical target yet — preserved in lineage for review";
    for (const raw of t.records) {
      await upsertLineage(t, raw, sha256(stableStringify(raw.fields)), "archived", null, note);
      rep.archived++;
    }
    if (!ARCHIVE_NOTES[t.table.name]) ctx.exception("reconciliation", t.table.id, null, `${t.records.length} record(s) in "${t.table.name}" archived: no canonical target yet`);
  }

  // ── Pass 2: many-to-many links ──
  for (const { spec, rec, targetId } of pass2) await spec.links!(rec, ctx, targetId);

  // ── Attachments ──
  const att = { stored: 0, alreadyStored: 0, hashMismatch: 0, failedDownload: 0, notDownloaded: 0, noTarget: 0 };
  const manifestById = new Map(manifest.filter((m) => m.attachment_id).map((m) => [m.attachment_id!, m]));
  for (const t of tables) {
    const attFields = t.table.fields.filter((f) => f.type === "multipleAttachments");
    if (!attFields.length || !t.records) continue;
    for (const f of attFields) for (const r of recsByTable.get(t.table.id) ?? []) r.used.add(f.id);
    for (const raw of t.records) for (const f of attFields) {
      const list = Array.isArray(raw.fields[f.id]) ? (raw.fields[f.id] as { id: string; filename?: string }[]) : [];
      for (const a of list) {
        const m = manifestById.get(a.id);
        if (!m) { att.notDownloaded++; ctx.exception("attachment_failed", t.table.id, raw.id, `Attachment "${a.filename ?? a.id}" was not downloaded (Airtable URL expired or unavailable); re-export with --download-attachments`); continue; }
        if (m.status === "FAILED" || !m.path) { att.failedDownload++; ctx.exception("attachment_failed", t.table.id, raw.id, `Attachment "${m.filename ?? a.id}" download failed: ${m.error ?? "unknown error"}`); continue; }
        const target = map.get(raw.id);
        if (!target || !isEntityKey(target.type)) { att.noTarget++; ctx.exception("attachment_failed", t.table.id, raw.id, `Attachment "${m.filename}" belongs to a record with no canonical target; file retained in the private export only`); continue; }
        const [dup] = await tx.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.orgId, orgId), eq(attachments.sourceAttachmentId, a.id), eq(attachments.entityId, target.id))).limit(1);
        if (dup) { att.alreadyStored++; continue; }
        const file = path.isAbsolute(m.path) ? m.path : path.join(opts.exportDir, m.path);
        if (!existsSync(file)) { att.failedDownload++; ctx.exception("attachment_failed", t.table.id, raw.id, `Attachment file missing from export: ${m.filename}`); continue; }
        const bytes = readFileSync(file);
        const hash = sha256(bytes);
        if (hash !== m.sha256) { att.hashMismatch++; ctx.exception("attachment_failed", t.table.id, raw.id, `Attachment "${m.filename}" SHA-256 mismatch (manifest ${m.sha256?.slice(0, 12)}…, file ${hash.slice(0, 12)}…); not stored`); continue; }
        const key = `${orgId}/import/${t.baseId}/${t.table.id}/${raw.id}/${a.id}`.replace(/[^A-Za-z0-9/_.-]/g, "_");
        if (opts.mode === "apply") await storage().put(key, bytes, "application/octet-stream");
        const productionId = t.alias === "Sappening_Production" ? await ctx.legacyProductionId() : null;
        await tx.insert(attachments).values({ orgId, createdBy: actor, entityType: target.type, entityId: target.id, productionId, filename: (m.filename ?? a.filename ?? "file").slice(0, 255), contentType: "application/octet-stream", sizeBytes: bytes.length, sha256: hash, storageKey: key, sensitivity: ["people", "contracts", "engagements", "release_forms"].includes(target.type) ? "restricted" : "internal", sourceAttachmentId: a.id });
        att.stored++;
      }
    }
  }

  // ── Unmapped fields (one exception per table + field) ──
  const unmappedFields: ImportReport["unmappedFields"] = [];
  let computed = 0;
  for (const [tableId, recs] of recsByTable) {
    const t = tables.find((x) => x.table.id === tableId)!;
    const used = new Set<string>();
    for (const r of recs) for (const u of r.used) used.add(u);
    for (const f of t.table.fields) {
      if (used.has(f.id)) continue;
      if (COMPUTED_TYPES.has(f.type)) { computed++; continue; }
      unmappedFields.push({ table: t.table.name, field: f.name, type: f.type });
      ctx.exception("unmapped_field", tableId, null, `Field "${f.name}" (${f.type}) has no canonical mapping; values preserved in source_records.raw`);
    }
  }

  // Record the batch for audit without triggering anything downstream.
  await emit(tx, { orgId, type: "import.completed", entityType: "import_batches", entityId: batch.id, idempotencyKey: `import.completed:${batch.id}`, origin: "import", actorUserId: actor, payload: { mode: opts.mode } });
  if (exceptions.length) await tx.insert(importExceptions).values(exceptions.map((e) => ({ orgId, importBatchId: batch.id, baseId: e.baseId, tableId: e.tableId, recordId: e.recordId, kind: e.kind, detail: e.detail })));

  // ── Reconciliation against the dated 19-Nov-2026 inventory ──
  const inv = readInventory(opts.inventoryPath ?? path.resolve(process.cwd(), "docs/source/airtable_table_inventory.csv"));
  const loaded = new Map(tables.map((t) => [t.table.id, t]));
  const inventory: ImportReport["inventory"] = { expectedTables: inv.length, exportedTables: tables.length, missingTables: [], extraTables: [], recordDrift: [], fieldDrift: [], expectedRecordSum: 0, actualRecordSum: 0 };
  for (const row of inv) {
    inventory.expectedRecordSum += row.records;
    const t = loaded.get(row.tableId);
    if (!t) { inventory.missingTables.push(`${row.base} / ${row.table}`); continue; }
    const actual = t.records?.length ?? 0;
    inventory.actualRecordSum += actual;
    if (actual !== row.records) inventory.recordDrift.push({ table: `${row.base} / ${row.table}`, expected: row.records, actual });
    if (t.table.fields.length !== row.fields) inventory.fieldDrift.push({ table: `${row.base} / ${row.table}`, expected: row.fields, actual: t.table.fields.length });
  }
  const invIds = new Set(inv.map((r) => r.tableId));
  inventory.extraTables = tables.filter((t) => !invIds.has(t.table.id)).map((t) => `${BASE_LABEL[t.alias]} / ${t.table.name}`);

  const sum = (k: keyof ImportReport["totals"]) => reports.reduce((a, r) => a + r[k], 0);
  const exceptionsByKind: Record<string, number> = {};
  for (const e of exceptions) exceptionsByKind[e.kind] = (exceptionsByKind[e.kind] ?? 0) + 1;
  const scenesT = reports.find((r) => r.target === "scenes");
  const editingT = reports.find((r) => r.table === "Editing");
  const report: ImportReport = {
    batchId: batch.id, mode: opts.mode, startedAt, finishedAt: new Date().toISOString(), tables: reports,
    totals: { sourceCount: sum("sourceCount"), imported: sum("imported"), updated: sum("updated"), unchanged: sum("unchanged"), archived: sum("archived"), exceptions: sum("exceptions") },
    editingReconciliation: { scenesSourceCount: scenesT?.sourceCount ?? 0, editingSourceCount: editingT?.sourceCount ?? 0, ...ctx.editing, scenesCreatedFromEditing: 0 },
    attachments: att, unmappedFields, computedFieldsNotImported: computed, exceptionsByKind, inventory,
  };
  await tx.update(importBatches).set({ status: opts.mode === "dry_run" ? "dry_run_complete" : "complete", finishedAt: new Date(), stats: report as unknown as Record<string, unknown> }).where(eq(importBatches.id, batch.id));
  return report;
}
