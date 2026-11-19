/**
 * Records: create / update / delete / restore with two-way link sync, cell-level revision history,
 * row colours, ordering, comments and automation events. All writes respect table + field rules.
 */
import { and, asc, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { baseFields, baseRecords, baseTables, recordComments, recordRevisions, users } from "@/db/schema";
import { COLORS, coerceValue, isComputed, type FieldDefLite, type FieldOptions, type FieldType } from "@/lib/platform/fields";
import type { Ctx } from "../auth/context";
import { audit, emit } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { atLeast, fieldEditable, fieldVisible, requireRole } from "./access";
import { tableContext } from "./schema";

type Tx = DbOrTx;
type Values = Record<string, unknown>;

async function fieldsOf(tx: Tx, tableId: string): Promise<FieldDefLite[]> {
  return (await tx.select().from(baseFields).where(and(eq(baseFields.tableId, tableId), isNull(baseFields.archivedAt))).orderBy(asc(baseFields.sortOrder)))
    .map((f) => ({ id: f.id, name: f.name, type: f.type as FieldType, options: f.options as FieldOptions, permissions: f.permissions }));
}

/** Validate a patch keyed by field id OR field name; returns coerced values keyed by id. */
function preparePatch(role: string, fields: FieldDefLite[], patch: Values): Values {
  const out: Values = {}; const errors: Record<string, string> = {};
  for (const [k, raw] of Object.entries(patch)) {
    const f = fields.find((x) => x.id === k) ?? fields.find((x) => x.name === k);
    if (!f) { errors[k] = "Unknown field"; continue; }
    if (!fieldVisible(role, f) || !fieldEditable(role, f)) { errors[f.name] = "You can't edit this field"; continue; }
    if (isComputed(f.type)) { errors[f.name] = "Calculated automatically"; continue; }
    try { out[f.id] = coerceValue(f, raw); } catch (e) { errors[f.name] = (e as Error).message; }
  }
  if (Object.keys(errors).length) throw invalid(Object.values(errors)[0], errors);
  return out;
}

async function assertLinkTargets(tx: Tx, fields: FieldDefLite[], vals: Values) {
  for (const f of fields.filter((x) => x.type === "link" && x.id in vals)) {
    const ids = (vals[f.id] as string[]) ?? [];
    if (!ids.length) continue;
    const ok = await tx.select({ id: baseRecords.id }).from(baseRecords).where(and(eq(baseRecords.tableId, f.options.linkedTableId!), inArray(baseRecords.id, ids), isNull(baseRecords.deletedAt)));
    if (ok.length !== new Set(ids).size) throw invalid(`${f.name}: some linked records no longer exist`);
  }
}

/** Mirror link changes onto the inverse field of each affected record. */
async function syncInverse(tx: Tx, f: FieldDefLite, recordId: string, before: string[], after: string[]) {
  const inv = f.options.inverseFieldId; if (!inv) return;
  const added = after.filter((x) => !before.includes(x)), removed = before.filter((x) => !after.includes(x));
  for (const id of added) await tx.execute(sql`update base_records set data = jsonb_set(data, ${`{${inv}}`}::text[], (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(data -> ${inv}, '[]'::jsonb) || ${JSON.stringify([recordId])}::jsonb) x)), updated_at = now() where id = ${id}`);
  for (const id of removed) await tx.execute(sql`update base_records set data = jsonb_set(data, ${`{${inv}}`}::text[], (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(data -> ${inv}, '[]'::jsonb)) x where x <> ${recordId})), updated_at = now() where id = ${id}`);
}

async function nextAutonumber(tx: Tx, tableId: string) {
  const [{ seq }] = await tx.update(baseTables).set({ autonumberSeq: sql`${baseTables.autonumberSeq} + 1` }).where(eq(baseTables.id, tableId)).returning({ seq: baseTables.autonumberSeq });
  return seq;
}

export async function createRecords(ctx: Ctx, tableId: string, rows: Values[], opts: { tx?: Tx; afterRecordId?: string; origin?: "user" | "import" | "system"; skipPermission?: boolean; automationDepth?: number } = {}) {
  const run = async (tx: Tx) => {
    const { table, access } = await tableContext(ctx, tableId, tx);
    if (!opts.skipPermission) { requireRole(access, table.permissions?.create ?? "editor", "add records to this table"); }
    const role = opts.skipPermission ? "owner" : access.role;
    const fields = await fieldsOf(tx, tableId);
    let base = 0;
    if (opts.afterRecordId) { const [a] = await tx.select({ s: baseRecords.sortOrder }).from(baseRecords).where(eq(baseRecords.id, opts.afterRecordId)).limit(1); base = a?.s ?? 0; }
    const created: string[] = [];
    for (const [i, row] of rows.entries()) {
      const vals = preparePatch(role, fields, row);
      await assertLinkTargets(tx, fields, vals);
      const seq = await nextAutonumber(tx, tableId);
      const sortOrder = opts.afterRecordId ? base + (i + 1) / (rows.length + 1) : seq;
      const [r] = await tx.insert(baseRecords).values({ orgId: ctx.orgId, tableId, data: vals, autonumber: seq, sortOrder, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      for (const f of fields.filter((x) => x.type === "link" && x.id in vals)) await syncInverse(tx, f, r.id, [], (vals[f.id] as string[]) ?? []);
      await tx.insert(recordRevisions).values({ orgId: ctx.orgId, recordId: r.id, tableId, action: "create", changes: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, { from: null, to: v }])), actorUserId: ctx.userId, actorLabel: ctx.name });
      await emit(tx, { orgId: ctx.orgId, type: "record.created", entityType: "base_records", entityId: r.id, idempotencyKey: `record.created:${r.id}`, origin: opts.origin ?? "user", actorUserId: ctx.userId, payload: { tableId, baseId: table.baseId, values: vals, depth: opts.automationDepth ?? 0 } });
      created.push(r.id);
    }
    if (created.length > 1) await audit(tx, ctx, "create_records", "base_tables", tableId, { meta: { count: created.length } });
    return created;
  };
  return opts.tx ? run(opts.tx) : db.transaction(run);
}

export async function updateRecord(ctx: Ctx, recordId: string, patch: Values, opts: { tx?: Tx; expectedVersion?: number; automationDepth?: number; origin?: "user" | "import" | "system" } = {}) {
  const run = async (tx: Tx) => {
    const [cur] = await tx.select().from(baseRecords).where(and(eq(baseRecords.id, recordId), eq(baseRecords.orgId, ctx.orgId), isNull(baseRecords.deletedAt))).for("update").limit(1);
    if (!cur) throw notFound("Record not found.");
    if (opts.expectedVersion !== undefined && cur.version !== opts.expectedVersion) throw invalid("This record changed while you were editing. Your view has been refreshed.");
    const { table, access } = await tableContext(ctx, cur.tableId, tx);
    requireRole(access, table.permissions?.edit ?? "editor", "edit records in this table");
    const fields = await fieldsOf(tx, cur.tableId);
    const vals = preparePatch(access.role, fields, patch);
    await assertLinkTargets(tx, fields, vals);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(vals)) if (JSON.stringify(cur.data[k] ?? null) !== JSON.stringify(v ?? null)) changes[k] = { from: cur.data[k] ?? null, to: v };
    if (!Object.keys(changes).length) return cur;
    const next = { ...cur.data, ...Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.to])) };
    const [row] = await tx.update(baseRecords).set({ data: next, updatedAt: new Date(), updatedBy: ctx.userId, version: cur.version + 1 }).where(eq(baseRecords.id, recordId)).returning();
    for (const f of fields.filter((x) => x.type === "link" && x.id in changes)) await syncInverse(tx, f, recordId, (changes[f.id].from as string[]) ?? [], (changes[f.id].to as string[]) ?? []);
    await tx.insert(recordRevisions).values({ orgId: ctx.orgId, recordId, tableId: cur.tableId, action: "update", changes, actorUserId: ctx.userId, actorLabel: ctx.name });
    await emit(tx, { orgId: ctx.orgId, type: "record.updated", entityType: "base_records", entityId: recordId, idempotencyKey: `record.updated:${recordId}:v${row.version}`, origin: opts.origin ?? (opts.automationDepth ? "system" : "user"), actorUserId: ctx.userId,
      payload: { tableId: cur.tableId, baseId: table.baseId, changed: Object.keys(changes), values: Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.to])), depth: opts.automationDepth ?? 0 } });
    return row;
  };
  return opts.tx ? run(opts.tx) : db.transaction(run);
}

/** Bulk cell writes (paste, fill, batch edit) in one transaction. */
export async function updateCells(ctx: Ctx, cells: { recordId: string; fieldId: string; value: unknown }[]) {
  if (cells.length > 5000) throw invalid("Too many cells at once (max 5,000).");
  const byRecord = new Map<string, Values>();
  for (const c of cells) byRecord.set(c.recordId, { ...(byRecord.get(c.recordId) ?? {}), [c.fieldId]: c.value });
  await db.transaction(async (tx) => { for (const [id, patch] of byRecord) await updateRecord(ctx, id, patch, { tx }); });
  return byRecord.size;
}

export async function deleteRecords(ctx: Ctx, ids: string[], restore = false) {
  if (!ids.length) return 0;
  return db.transaction(async (tx) => {
    const recs = await tx.select().from(baseRecords).where(and(eq(baseRecords.orgId, ctx.orgId), inArray(baseRecords.id, ids), restore ? isNotNull(baseRecords.deletedAt) : isNull(baseRecords.deletedAt)));
    for (const r of recs) {
      const { table, access } = await tableContext(ctx, r.tableId, tx);
      requireRole(access, table.permissions?.delete ?? "editor", "delete records in this table");
      const fields = await fieldsOf(tx, r.tableId);
      // Deleting removes this record from the other side of its links; restoring puts it back.
      for (const f of fields.filter((x) => x.type === "link")) { const linked = (r.data[f.id] as string[]) ?? []; await syncInverse(tx, f, r.id, restore ? [] : linked, restore ? linked : []); }
      await tx.update(baseRecords).set({ deletedAt: restore ? null : new Date(), updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(baseRecords.id, r.id));
      await tx.insert(recordRevisions).values({ orgId: ctx.orgId, recordId: r.id, tableId: r.tableId, action: restore ? "restore" : "delete", changes: {}, actorUserId: ctx.userId, actorLabel: ctx.name });
    }
    await audit(tx, ctx, restore ? "restore_records" : "delete_records", "base_records", null, { meta: { count: recs.length } });
    return recs.length;
  });
}

export async function setRowColor(ctx: Ctx, ids: string[], color: string | null) {
  if (color && !COLORS.includes(color as never)) throw invalid("Unknown colour");
  for (const id of ids.slice(0, 1000)) {
    const [r] = await db.select().from(baseRecords).where(and(eq(baseRecords.id, id), eq(baseRecords.orgId, ctx.orgId))).limit(1);
    if (!r) continue;
    const { table, access } = await tableContext(ctx, r.tableId);
    requireRole(access, table.permissions?.edit ?? "editor", "colour records");
    await db.update(baseRecords).set({ rowColor: color }).where(eq(baseRecords.id, id));
  }
}

/** Manual ordering (drag in grid/kanban): place record between neighbours. */
export async function moveRecord(ctx: Ctx, recordId: string, beforeId: string | null, afterId: string | null) {
  const [r] = await db.select().from(baseRecords).where(and(eq(baseRecords.id, recordId), eq(baseRecords.orgId, ctx.orgId))).limit(1);
  if (!r) throw notFound();
  const { access } = await tableContext(ctx, r.tableId); requireRole(access, "editor", "reorder records");
  const get = async (id: string | null) => (id ? (await db.select({ s: baseRecords.sortOrder }).from(baseRecords).where(eq(baseRecords.id, id)).limit(1))[0]?.s ?? null : null);
  const [b, a] = [await get(beforeId), await get(afterId)];
  const s = b !== null && a !== null ? (b + a) / 2 : b !== null ? b + 1 : a !== null ? a - 1 : r.sortOrder;
  await db.update(baseRecords).set({ sortOrder: s }).where(eq(baseRecords.id, recordId));
}

// ───────────── History & comments ─────────────

async function recordAccess(ctx: Ctx, recordId: string) {
  const [r] = await db.select().from(baseRecords).where(and(eq(baseRecords.id, recordId), eq(baseRecords.orgId, ctx.orgId))).limit(1);
  if (!r) throw notFound("Record not found.");
  const tc = await tableContext(ctx, r.tableId);
  return { record: r, ...tc };
}

export async function recordHistory(ctx: Ctx, recordId: string) {
  const { access, record } = await recordAccess(ctx, recordId);
  const fields = await fieldsOf(db, record.tableId);
  const hidden = new Set(fields.filter((f) => !fieldVisible(access.role, f)).map((f) => f.id));
  const revs = await db.select().from(recordRevisions).where(eq(recordRevisions.recordId, recordId)).orderBy(desc(recordRevisions.at)).limit(200);
  return revs.map((r) => ({ id: r.id, action: r.action, actor: r.actorLabel, at: r.at.toISOString(), changes: Object.fromEntries(Object.entries(r.changes).filter(([k]) => !hidden.has(k))) }));
}

export async function addComment(ctx: Ctx, recordId: string, body: string) {
  const { access, table } = await recordAccess(ctx, recordId);
  if (!atLeast(access.role, "commenter")) throw forbidden("You need commenter access to comment.");
  const text = body.trim(); if (!text || text.length > 10_000) throw invalid("Comments must be 1–10,000 characters.");
  const mentions = [...text.matchAll(/@\[[^\]]+\]\(([0-9a-f-]{36})\)/g)].map((m) => m[1]);
  const [c] = await db.insert(recordComments).values({ orgId: ctx.orgId, recordId, body: text, mentions, createdBy: ctx.userId }).returning();
  await audit(db, ctx, "comment", "base_records", recordId, { meta: { commentId: c.id, tableId: table.id } });
  return c;
}

export async function listComments(ctx: Ctx, recordId: string) {
  await recordAccess(ctx, recordId);
  return db.select({ id: recordComments.id, body: recordComments.body, createdAt: recordComments.createdAt, editedAt: recordComments.editedAt, author: users.name, authorId: recordComments.createdBy })
    .from(recordComments).leftJoin(users, eq(users.id, recordComments.createdBy)).where(and(eq(recordComments.recordId, recordId), isNull(recordComments.deletedAt))).orderBy(asc(recordComments.createdAt));
}

export async function deleteComment(ctx: Ctx, commentId: string) {
  const [c] = await db.select().from(recordComments).where(and(eq(recordComments.id, commentId), eq(recordComments.orgId, ctx.orgId))).limit(1);
  if (!c) throw notFound();
  const { access } = await recordAccess(ctx, c.recordId);
  if (c.createdBy !== ctx.userId && !atLeast(access.role, "creator")) throw forbidden("You can only delete your own comments.");
  await db.update(recordComments).set({ deletedAt: new Date() }).where(eq(recordComments.id, commentId));
}

export async function commentCounts(ctx: Ctx, recordIds: string[]) {
  if (!recordIds.length) return {};
  const rows = await db.select({ id: recordComments.recordId, n: sql<number>`count(*)::int` }).from(recordComments).where(and(eq(recordComments.orgId, ctx.orgId), inArray(recordComments.recordId, recordIds), isNull(recordComments.deletedAt))).groupBy(recordComments.recordId);
  return Object.fromEntries(rows.map((r) => [r.id, r.n]));
}
