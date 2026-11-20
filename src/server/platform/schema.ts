/**
 * Base schema service: bases, tables, fields, views. All writes are permission-checked and audited.
 */
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { baseFields, baseMembers, baseRecords, baseTables, baseViews, bases, type ViewConfig } from "@/db/schema";
import { COLORS, FIELD_TYPES, coerceValue, displayValue, isComputed, newChoiceId, type FieldDefLite, type FieldOptions, type FieldType, type SelectChoice } from "@/lib/platform/fields";
import { FormulaError, parse, references, toStored } from "@/lib/platform/formula";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { atLeast, baseAccess, baseRoles, rank, requireRole } from "./access";

type Tx = DbOrTx;
const now = () => new Date();

// ───────────── Bases ─────────────

export async function listBases(ctx: Ctx) {
  const rows = await db.select().from(bases).where(and(eq(bases.orgId, ctx.orgId), isNull(bases.archivedAt))).orderBy(asc(bases.sortOrder), asc(bases.createdAt));
  const roles = await baseRoles(ctx, rows.map((b) => b.id));
  return rows.filter((b) => roles.has(b.id)).map((b) => ({ ...b, role: roles.get(b.id)! }));
}

export async function createBase(ctx: Ctx, input: { name: string; icon?: string; color?: string; description?: string; blank?: boolean }, tx?: Tx) {
  if (!atLeast(ctx.platformRole, "creator")) throw forbidden("You need creator access to create bases.");
  const name = input.name?.trim(); if (!name) throw invalid("Name the base.");
  const color = COLORS.includes(input.color as never) ? input.color! : "blue";
  const run = async (t: Tx) => {
    const [b] = await t.insert(bases).values({ orgId: ctx.orgId, createdBy: ctx.userId, name: name.slice(0, 120), icon: input.icon || "grid", color, description: input.description ?? null }).returning();
    if (input.blank !== false) {
      const tbl = await createTableTx(t, ctx, b.id, "Table 1", [
        { name: "Name", type: "singleLineText" }, { name: "Notes", type: "longText" },
        { name: "Status", type: "singleSelect", options: { choices: [{ id: newChoiceId(), name: "Todo", color: "red" }, { id: newChoiceId(), name: "In progress", color: "yellow" }, { id: newChoiceId(), name: "Done", color: "green" }] } },
      ]);
      for (let i = 0; i < 3; i++) await insertBlankRecord(t, ctx, tbl.id);
    }
    await audit(t, ctx, "create_base", "bases", b.id, { after: { name } });
    return b;
  };
  return tx ? run(tx) : db.transaction(run);
}

export async function updateBase(ctx: Ctx, baseId: string, patch: { name?: string; icon?: string; color?: string; description?: string | null; visibility?: "workspace" | "private" }) {
  const a = await baseAccess(ctx, baseId); requireRole(a, "creator", "change this base");
  const set: Record<string, unknown> = { updatedAt: now() };
  if (patch.visibility !== undefined) {
    if (!["workspace", "private"].includes(patch.visibility)) throw invalid("Unknown visibility.");
    requireRole(a, "owner", "change who can see this base");
    set.visibility = patch.visibility;
    // Going private must not lock out the person doing it: pin their current role explicitly.
    if (patch.visibility === "private") await db.insert(baseMembers).values({ orgId: ctx.orgId, baseId, userId: ctx.userId, role: a.role }).onConflictDoNothing();
  }
  if (patch.name !== undefined) { if (!patch.name.trim()) throw invalid("Name the base."); set.name = patch.name.trim().slice(0, 120); }
  if (patch.icon) set.icon = patch.icon.slice(0, 40);
  if (patch.color) { if (!COLORS.includes(patch.color as never)) throw invalid("Unknown colour"); set.color = patch.color; }
  if (patch.description !== undefined) set.description = patch.description;
  await db.update(bases).set(set).where(eq(bases.id, baseId));
  await audit(db, ctx, "update_base", "bases", baseId, { before: a.base as never, after: set as never });
}

export async function archiveBase(ctx: Ctx, baseId: string) {
  const a = await baseAccess(ctx, baseId); requireRole(a, "owner", "delete this base");
  await db.update(bases).set({ archivedAt: now() }).where(eq(bases.id, baseId));
  await audit(db, ctx, "delete_base", "bases", baseId, { meta: { name: a.base.name } });
}

// ───────────── Structure loading ─────────────

export async function loadBaseStructure(ctx: Ctx, baseId: string, tx: Tx = db) {
  const a = await baseAccess(ctx, baseId, tx);
  const tables = await tx.select().from(baseTables).where(and(eq(baseTables.baseId, baseId), isNull(baseTables.archivedAt))).orderBy(asc(baseTables.sortOrder), asc(baseTables.createdAt));
  const ids = tables.map((t) => t.id);
  const fields = ids.length ? await tx.select().from(baseFields).where(and(inArray(baseFields.tableId, ids), isNull(baseFields.archivedAt))).orderBy(asc(baseFields.sortOrder), asc(baseFields.createdAt)) : [];
  const views = ids.length ? await tx.select().from(baseViews).where(and(inArray(baseViews.tableId, ids), isNull(baseViews.archivedAt))).orderBy(asc(baseViews.sortOrder), asc(baseViews.createdAt)) : [];
  return { access: a, tables, fields, views: views.filter((v) => (!v.ownerUserId || v.ownerUserId === ctx.userId) && atLeast(a.role, v.visibleTo)) };
}

export async function tableContext(ctx: Ctx, tableId: string, tx: Tx = db) {
  if (!/^[0-9a-f-]{36}$/i.test(tableId)) throw notFound("Table not found.");
  const [t] = await tx.select().from(baseTables).where(and(eq(baseTables.id, tableId), eq(baseTables.orgId, ctx.orgId), isNull(baseTables.archivedAt))).limit(1);
  if (!t) throw notFound("Table not found.");
  const access = await baseAccess(ctx, t.baseId, tx);
  return { table: t, access };
}

const asLite = (f: typeof baseFields.$inferSelect): FieldDefLite => ({ id: f.id, name: f.name, type: f.type as FieldType, options: f.options as FieldOptions, description: f.description, permissions: f.permissions });

// ───────────── Tables ─────────────

async function insertBlankRecord(tx: Tx, ctx: Ctx, tableId: string) {
  const [{ seq }] = await tx.update(baseTables).set({ autonumberSeq: sql`${baseTables.autonumberSeq} + 1` }).where(eq(baseTables.id, tableId)).returning({ seq: baseTables.autonumberSeq });
  await tx.insert(baseRecords).values({ orgId: ctx.orgId, tableId, data: {}, autonumber: seq, sortOrder: seq, createdBy: ctx.userId, updatedBy: ctx.userId });
}

export async function createTableTx(tx: Tx, ctx: Ctx, baseId: string, name: string, fields: { name: string; type: FieldType; options?: FieldOptions }[] = [{ name: "Name", type: "singleLineText" }]) {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(baseTables).where(eq(baseTables.baseId, baseId));
  const [t] = await tx.insert(baseTables).values({ orgId: ctx.orgId, createdBy: ctx.userId, baseId, name: name.slice(0, 120), sortOrder: n }).returning();
  let primary: string | null = null;
  for (const [i, f] of fields.entries()) {
    const [row] = await tx.insert(baseFields).values({ orgId: ctx.orgId, createdBy: ctx.userId, tableId: t.id, name: f.name, type: f.type, options: normaliseOptions(f.type, f.options ?? {}), sortOrder: i }).returning();
    if (i === 0) primary = row.id;
  }
  await tx.update(baseTables).set({ primaryFieldId: primary }).where(eq(baseTables.id, t.id));
  await tx.insert(baseViews).values({ orgId: ctx.orgId, createdBy: ctx.userId, tableId: t.id, name: "Grid view", type: "grid", config: {} });
  return { ...t, primaryFieldId: primary };
}

export async function createTable(ctx: Ctx, baseId: string, name: string) {
  const a = await baseAccess(ctx, baseId); requireRole(a, "creator", "add tables");
  return db.transaction(async (tx) => {
    const t = await createTableTx(tx, ctx, baseId, name.trim() || "Untitled table");
    for (let i = 0; i < 3; i++) await insertBlankRecord(tx, ctx, t.id);
    await audit(tx, ctx, "create_table", "base_tables", t.id, { after: { name } });
    return t;
  });
}

export async function updateTable(ctx: Ctx, tableId: string, patch: { name?: string; description?: string | null; permissions?: { create?: string; edit?: string; delete?: string }; primaryFieldId?: string }) {
  const { table, access } = await tableContext(ctx, tableId); requireRole(access, "creator", "change this table");
  const set: Record<string, unknown> = { updatedAt: now() };
  if (patch.name !== undefined) { if (!patch.name.trim()) throw invalid("Name the table."); set.name = patch.name.trim().slice(0, 120); }
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.permissions) { for (const v of Object.values(patch.permissions)) if (v && !rank(v)) throw invalid("Unknown role"); set.permissions = patch.permissions; }
  if (patch.primaryFieldId) {
    const [f] = await db.select().from(baseFields).where(and(eq(baseFields.id, patch.primaryFieldId), eq(baseFields.tableId, tableId))).limit(1);
    if (!f || ["link", "attachment", "button", "checkbox"].includes(f.type)) throw invalid("That field can't be the primary field.");
    set.primaryFieldId = f.id;
  }
  await db.update(baseTables).set(set).where(eq(baseTables.id, tableId));
  await audit(db, ctx, "update_table", "base_tables", tableId, { before: table as never, after: set as never });
}

export async function archiveTable(ctx: Ctx, tableId: string) {
  const { table, access } = await tableContext(ctx, tableId); requireRole(access, "creator", "delete tables");
  await db.transaction(async (tx) => {
    // Remove link fields in other tables that point here, so no dangling relations remain.
    const inbound = await tx.select().from(baseFields).where(and(eq(baseFields.orgId, ctx.orgId), eq(baseFields.type, "link"), sql`${baseFields.options} ->> 'linkedTableId' = ${tableId}`, isNull(baseFields.archivedAt)));
    for (const f of inbound) await tx.update(baseFields).set({ archivedAt: now() }).where(eq(baseFields.id, f.id));
    await tx.update(baseTables).set({ archivedAt: now() }).where(eq(baseTables.id, tableId));
    await audit(tx, ctx, "delete_table", "base_tables", tableId, { meta: { name: table.name, removedLinks: inbound.length } });
  });
}

// ───────────── Fields ─────────────

export function normaliseOptions(type: FieldType, o: FieldOptions): FieldOptions {
  const out: FieldOptions = { ...o };
  if (type === "singleSelect" || type === "multipleSelects") {
    const seen = new Set<string>();
    out.choices = (o.choices ?? []).filter((c) => c && String(c.name ?? "").trim()).map((c, i) => ({ id: c.id || newChoiceId(), name: String(c.name).trim().slice(0, 100), color: (COLORS.includes(c.color) ? c.color : COLORS[i % COLORS.length]) as SelectChoice["color"] }))
      .filter((c) => !seen.has(c.name) && !!seen.add(c.name));
  }
  if (type === "aiText") { out.aiMode = o.aiMode === "analyze" || o.aiMode === "research" ? o.aiMode : "text"; if (out.aiMode !== "analyze") delete out.sourceFieldId; }
  if (type === "rating") out.max = Math.min(Math.max(o.max ?? 5, 1), 10);
  if (["number", "currency", "percent"].includes(type)) out.precision = Math.min(Math.max(o.precision ?? (type === "currency" ? 2 : 0), 0), 8);
  if (type === "currency") out.symbol = (o.symbol ?? "£").slice(0, 4);
  if (type === "button") {
    out.action = ["open_url", "update_record", "run_automation"].includes(o.action ?? "") ? o.action : "open_url";
    out.label = String(o.label ?? "").slice(0, 60);
    if (o.url && !/^https?:\/\//i.test(o.url)) throw invalid("Button URLs must start with http:// or https://");
    out.values = o.values && typeof o.values === "object" && !Array.isArray(o.values) ? Object.fromEntries(Object.entries(o.values).slice(0, 50)) : undefined;
  }
  return out;
}

export async function validateComputed(tx: Tx, tableId: string, type: FieldType, o: FieldOptions, selfId?: string): Promise<FieldOptions> {
  const tableFields = await tx.select().from(baseFields).where(and(eq(baseFields.tableId, tableId), isNull(baseFields.archivedAt)));
  if (type === "lookup" || type === "rollup" || type === "count") {
    const link = tableFields.find((f) => f.id === o.linkFieldId && f.type === "link");
    if (!link) throw invalid("Choose a link field in this table.");
    if (type !== "count") {
      const linkedTableId = (link.options as FieldOptions).linkedTableId!;
      const [target] = await tx.select().from(baseFields).where(and(eq(baseFields.id, o.targetFieldId ?? "00000000-0000-0000-0000-000000000000"), eq(baseFields.tableId, linkedTableId), isNull(baseFields.archivedAt))).limit(1);
      if (!target) throw invalid("Choose a field from the linked table.");
      if (type === "rollup" && !o.rollupFn) return { ...o, rollupFn: "sum" };
    }
  }
  if (type === "formula") {
    if (!o.formula?.trim()) throw invalid("Write a formula.");
    let stored: string;
    try { stored = toStored(o.formula, tableFields.filter((f) => f.id !== selfId).map((f) => ({ id: f.id, name: f.name }))); parse(stored); }
    catch (e) { throw invalid(e instanceof FormulaError ? `Formula: ${e.message}` : "Formula is not valid."); }
    // Cycle check across formula fields in this table.
    const graph = new Map<string, Set<string>>();
    for (const f of tableFields) if (f.type === "formula" && f.id !== selfId && (f.options as FieldOptions).formula) { try { graph.set(f.id, references(parse((f.options as FieldOptions).formula!))); } catch { /* ignore broken */ } }
    const me = selfId ?? "new"; graph.set(me, references(parse(stored)));
    const visit = (n: string, path: Set<string>): boolean => { if (path.has(n)) return true; path.add(n); for (const m of graph.get(n) ?? []) if (visit(m, path)) return true; path.delete(n); return false; };
    if (visit(me, new Set())) throw invalid("Formula refers to itself through other formulas (circular reference).");
    return { ...o, formula: stored };
  }
  return o;
}

export async function createField(ctx: Ctx, tableId: string, input: { name: string; type: FieldType; options?: FieldOptions; description?: string | null; afterFieldId?: string }) {
  const { table, access } = await tableContext(ctx, tableId); requireRole(access, "creator", "add fields");
  if (!FIELD_TYPES.includes(input.type)) throw invalid("Unknown field type.");
  const name = input.name?.trim(); if (!name) throw invalid("Name the field.");
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(baseFields).where(and(eq(baseFields.tableId, tableId), isNull(baseFields.archivedAt)));
    if (existing.some((f) => f.name.toLowerCase() === name.toLowerCase())) throw invalid(`A field called “${name}” already exists.`);
    let options = normaliseOptions(input.type, input.options ?? {});
    if (input.type === "link") {
      const [target] = await tx.select().from(baseTables).where(and(eq(baseTables.id, options.linkedTableId ?? "00000000-0000-0000-0000-000000000000"), eq(baseTables.baseId, table.baseId), isNull(baseTables.archivedAt))).limit(1);
      if (!target) throw invalid("Choose a table in this base to link to.");
    }
    options = await validateComputed(tx, tableId, input.type, options);
    const after = input.afterFieldId ? existing.find((f) => f.id === input.afterFieldId) : undefined;
    const sortOrder = after ? after.sortOrder + 0.5 : existing.length;
    const [f] = await tx.insert(baseFields).values({ orgId: ctx.orgId, createdBy: ctx.userId, tableId, name: name.slice(0, 120), type: input.type, options, description: input.description ?? null, sortOrder: Math.round(sortOrder * 2) }).returning();
    if (after) await renumberFields(tx, tableId);
    if (input.type === "link") {
      // Two-way relation: create the inverse field in the linked table (or the same table for self-links).
      const targetId = options.linkedTableId!;
      const targetFields = await tx.select().from(baseFields).where(and(eq(baseFields.tableId, targetId), isNull(baseFields.archivedAt)));
      let invName = table.name; let i = 2; while (targetFields.some((x) => x.name.toLowerCase() === invName.toLowerCase())) invName = `${table.name} ${i++}`;
      const [inv] = await tx.insert(baseFields).values({ orgId: ctx.orgId, createdBy: ctx.userId, tableId: targetId, name: invName, type: "link", options: { linkedTableId: tableId, inverseFieldId: f.id }, sortOrder: targetFields.length * 2 }).returning();
      await tx.update(baseFields).set({ options: { ...options, inverseFieldId: inv.id } }).where(eq(baseFields.id, f.id));
    }
    await audit(tx, ctx, "create_field", "base_fields", f.id, { after: { name, type: input.type } });
    return f;
  });
}

async function renumberFields(tx: Tx, tableId: string) {
  const fs = await tx.select().from(baseFields).where(and(eq(baseFields.tableId, tableId), isNull(baseFields.archivedAt))).orderBy(asc(baseFields.sortOrder), asc(baseFields.createdAt));
  for (const [i, f] of fs.entries()) if (f.sortOrder !== i * 2) await tx.update(baseFields).set({ sortOrder: i * 2 }).where(eq(baseFields.id, f.id));
}

/** Update a field. Changing type converts existing values (best effort, like Airtable). */
export async function updateField(ctx: Ctx, fieldId: string, patch: { name?: string; type?: FieldType; options?: FieldOptions; description?: string | null; permissions?: { edit?: string; hiddenBelow?: string } }) {
  const [cur] = await db.select().from(baseFields).where(and(eq(baseFields.id, fieldId), eq(baseFields.orgId, ctx.orgId), isNull(baseFields.archivedAt))).limit(1);
  if (!cur) throw notFound("Field not found.");
  const { table, access } = await tableContext(ctx, cur.tableId); requireRole(access, "creator", "change fields");
  return db.transaction(async (tx) => {
    const set: Record<string, unknown> = { updatedAt: now(), version: cur.version + 1 };
    if (patch.name !== undefined) {
      const name = patch.name.trim(); if (!name) throw invalid("Name the field.");
      const clash = await tx.select({ id: baseFields.id }).from(baseFields).where(and(eq(baseFields.tableId, cur.tableId), isNull(baseFields.archivedAt), sql`lower(${baseFields.name}) = ${name.toLowerCase()}`, sql`${baseFields.id} <> ${fieldId}`)).limit(1);
      if (clash.length) throw invalid(`A field called “${name}” already exists.`);
      set.name = name.slice(0, 120);
    }
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.permissions) { for (const v of Object.values(patch.permissions)) if (v && !rank(v)) throw invalid("Unknown role"); set.permissions = patch.permissions; }
    const newType = patch.type ?? (cur.type as FieldType);
    if (patch.type && patch.type !== cur.type) {
      if (cur.type === "link" || patch.type === "link") throw invalid("Link fields can't change type. Create a new field instead.");
      if (cur.id === table.primaryFieldId && ["attachment", "button", "checkbox"].includes(patch.type)) throw invalid("The primary field can't be that type.");
    }
    if (patch.options || patch.type) {
      let opts = normaliseOptions(newType, { ...(cur.options as FieldOptions), ...(patch.options ?? {}) });
      if (newType === "link") {
        // A link's target table and inverse are fixed at creation (repointing could expose another base's records).
        const c = cur.options as FieldOptions;
        opts = { ...opts, linkedTableId: c.linkedTableId, inverseFieldId: c.inverseFieldId };
      }
      opts = await validateComputed(tx, cur.tableId, newType, opts, fieldId);
      set.options = opts; set.type = newType;
      // Convert stored values when the type changes or select choices are removed.
      if (!isComputed(newType)) {
        const recs = await tx.select({ id: baseRecords.id, data: baseRecords.data }).from(baseRecords).where(and(eq(baseRecords.tableId, cur.tableId), isNull(baseRecords.deletedAt)));
        const plan = planConversion(cur, newType, opts, recs);
        set.options = plan.options;
        for (const ch of plan.changes) await tx.update(baseRecords).set({ data: sql`${baseRecords.data} || ${JSON.stringify({ [fieldId]: ch.value })}::jsonb` }).where(eq(baseRecords.id, ch.id));
      }
    }
    const [row] = await tx.update(baseFields).set(set).where(eq(baseFields.id, fieldId)).returning();
    await audit(tx, ctx, "update_field", "base_fields", fieldId, { before: { name: cur.name, type: cur.type } as never, after: { name: row.name, type: row.type } as never });
    return row;
  });
}

/**
 * How stored values change if a field becomes `newType` with `opts`: values that convert, values that
 * would be cleared (they can't be represented), and select options that would be created.
 */
function planConversion(cur: typeof baseFields.$inferSelect, newType: FieldType, optsIn: FieldOptions, recs: { id: string; data: Record<string, unknown> }[]) {
  const opts: FieldOptions = { ...optsIn };
  const oldLite = asLite(cur); const newLite: FieldDefLite = { ...oldLite, type: newType, options: opts };
  let addedChoices: string[] = [];
  if ((newType === "singleSelect" || newType === "multipleSelects") && newType !== cur.type) {
    const names = new Set<string>();
    for (const r of recs) for (const part of displayValue(oldLite, r.data[cur.id]).split(",").map((s) => s.trim()).filter(Boolean)) names.add(part);
    const existing = new Set((opts.choices ?? []).map((c) => c.name));
    addedChoices = [...names].filter((n) => !existing.has(n)).slice(0, 200);
    opts.choices = [...(opts.choices ?? []), ...addedChoices.map((n, i) => ({ id: newChoiceId(), name: n.slice(0, 100), color: COLORS[((opts.choices?.length ?? 0) + i) % COLORS.length] as SelectChoice["color"] }))];
    newLite.options = opts;
  }
  const changes: { id: string; value: unknown; before: unknown }[] = [];
  let converted = 0, cleared = 0, unchanged = 0, empty = 0;
  for (const r of recs) {
    const v = r.data[cur.id]; if (v === undefined || v === null || v === "") { empty++; continue; }
    let nv: unknown;
    if (newType === cur.type) { try { nv = coerceValue(newLite, v); } catch { nv = null; } }
    else { const str = displayValue(oldLite, v); try { nv = coerceValue(newLite, newType === "multipleSelects" ? str.split(",").map((s) => s.trim()).filter(Boolean) : str); } catch { nv = null; } }
    if (JSON.stringify(nv) === JSON.stringify(v)) { unchanged++; continue; }
    if (nv === null || (Array.isArray(nv) && !nv.length)) cleared++; else converted++;
    changes.push({ id: r.id, value: nv, before: v });
  }
  return { options: opts, changes, converted, cleared, unchanged, empty, addedChoices };
}

/** Dry run of a field type/options change: counts and examples, nothing written. */
export async function previewFieldChange(ctx: Ctx, fieldId: string, patch: { type?: FieldType; options?: FieldOptions }) {
  const [cur] = await db.select().from(baseFields).where(and(eq(baseFields.id, fieldId), eq(baseFields.orgId, ctx.orgId), isNull(baseFields.archivedAt))).limit(1);
  if (!cur) throw notFound("Field not found.");
  const { access } = await tableContext(ctx, cur.tableId); requireRole(access, "creator", "change fields");
  const newType = patch.type ?? (cur.type as FieldType);
  if (newType !== cur.type && (cur.type === "link" || newType === "link")) throw invalid("Link fields can't change type. Create a new field instead.");
  if (isComputed(newType)) return { converted: 0, cleared: 0, unchanged: 0, empty: 0, addedChoices: [] as string[], examples: [] as { before: string; after: string }[], computed: true };
  const opts = normaliseOptions(newType, { ...(cur.options as FieldOptions), ...(patch.options ?? {}) });
  const recs = await db.select({ id: baseRecords.id, data: baseRecords.data }).from(baseRecords).where(and(eq(baseRecords.tableId, cur.tableId), isNull(baseRecords.deletedAt)));
  const p = planConversion(cur, newType, opts, recs);
  const oldLite = asLite(cur); const newLite: FieldDefLite = { ...oldLite, type: newType, options: p.options };
  const examples = p.changes.slice(0, 5).map((c) => ({ before: displayValue(oldLite, c.before), after: c.value === null ? "(cleared)" : displayValue(newLite, c.value) }));
  return { converted: p.converted, cleared: p.cleared, unchanged: p.unchanged, empty: p.empty, addedChoices: p.addedChoices, examples, computed: false };
}

export async function archiveField(ctx: Ctx, fieldId: string) {
  const [cur] = await db.select().from(baseFields).where(and(eq(baseFields.id, fieldId), eq(baseFields.orgId, ctx.orgId), isNull(baseFields.archivedAt))).limit(1);
  if (!cur) throw notFound("Field not found.");
  const { table, access } = await tableContext(ctx, cur.tableId); requireRole(access, "creator", "delete fields");
  if (table.primaryFieldId === fieldId) throw invalid("The primary field can't be deleted. Make another field primary first.");
  await db.transaction(async (tx) => {
    const ids = [fieldId];
    const inv = (cur.options as FieldOptions).inverseFieldId;
    if (cur.type === "link" && inv) ids.push(inv);
    // Computed fields that depend on a deleted link become invalid; remove them too.
    const deps = await tx.select().from(baseFields).where(and(eq(baseFields.orgId, ctx.orgId), isNull(baseFields.archivedAt), inArray(baseFields.type, ["lookup", "rollup", "count"]), sql`(${baseFields.options} ->> 'linkFieldId') in ${ids} or (${baseFields.options} ->> 'targetFieldId') = ${fieldId}`));
    ids.push(...deps.map((d) => d.id));
    await tx.update(baseFields).set({ archivedAt: now() }).where(inArray(baseFields.id, ids));
    await audit(tx, ctx, "delete_field", "base_fields", fieldId, { meta: { name: cur.name, alsoRemoved: ids.length - 1 } });
  });
}

export async function reorderFields(ctx: Ctx, tableId: string, orderedIds: string[]) {
  const { access } = await tableContext(ctx, tableId); requireRole(access, "creator", "reorder fields");
  await db.transaction(async (tx) => { for (const [i, id] of orderedIds.entries()) await tx.update(baseFields).set({ sortOrder: i * 2 }).where(and(eq(baseFields.id, id), eq(baseFields.tableId, tableId))); });
}

/** Reorder a base's tables (creator and up). Ids not in the base are ignored. */
export async function reorderTables(ctx: Ctx, baseId: string, orderedIds: string[]) {
  const a = await baseAccess(ctx, baseId); requireRole(a, "creator", "reorder tables");
  await db.transaction(async (tx) => { for (const [i, id] of orderedIds.slice(0, 500).entries()) await tx.update(baseTables).set({ sortOrder: i }).where(and(eq(baseTables.id, id), eq(baseTables.baseId, baseId))); });
  await audit(db, ctx, "reorder_tables", "bases", baseId, { meta: { count: orderedIds.length } });
}

// ───────────── Views ─────────────

const VIEW_TYPES = ["grid", "kanban", "calendar", "gallery", "form", "timeline", "list"] as const;

export async function createView(ctx: Ctx, tableId: string, input: { name: string; type: string; personal?: boolean; copyFromViewId?: string }) {
  const { access } = await tableContext(ctx, tableId);
  if (input.personal) requireRole(access, "commenter", "create personal views"); else requireRole(access, "creator", "create collaborative views");
  if (!VIEW_TYPES.includes(input.type as never)) throw invalid("Unknown view type.");
  let config: ViewConfig = {};
  if (input.copyFromViewId) { const [src] = await db.select().from(baseViews).where(and(eq(baseViews.id, input.copyFromViewId), eq(baseViews.tableId, tableId))).limit(1); if (src) config = src.config; }
  const fields = await db.select().from(baseFields).where(and(eq(baseFields.tableId, tableId), isNull(baseFields.archivedAt))).orderBy(asc(baseFields.sortOrder));
  if (input.type === "kanban" && !config.kanbanFieldId) config.kanbanFieldId = fields.find((f) => f.type === "singleSelect")?.id;
  if ((input.type === "calendar" || input.type === "timeline") && !config.dateFieldId) config.dateFieldId = fields.find((f) => ["date", "dateTime", "createdTime"].includes(f.type))?.id;
  if (input.type === "gallery" && !config.coverFieldId) config.coverFieldId = fields.find((f) => f.type === "attachment")?.id;
  if (input.type === "form" && !config.form) config.form = { title: input.name, fields: fields.filter((f) => !isComputed(f.type as FieldType)).map((f) => ({ fieldId: f.id })) };
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(baseViews).where(eq(baseViews.tableId, tableId));
  const [v] = await db.insert(baseViews).values({ orgId: ctx.orgId, createdBy: ctx.userId, tableId, name: input.name.trim().slice(0, 120) || "Untitled view", type: input.type, config, sortOrder: n, ownerUserId: input.personal ? ctx.userId : null }).returning();
  await audit(db, ctx, "create_view", "base_views", v.id, { after: { name: v.name, type: v.type, personal: !!input.personal } });
  return v;
}

async function viewContext(ctx: Ctx, viewId: string) {
  const [v] = await db.select().from(baseViews).where(and(eq(baseViews.id, viewId), eq(baseViews.orgId, ctx.orgId), isNull(baseViews.archivedAt))).limit(1);
  if (!v || (v.ownerUserId && v.ownerUserId !== ctx.userId)) throw notFound("View not found.");
  const { access, table } = await tableContext(ctx, v.tableId);
  if (!atLeast(access.role, v.visibleTo)) throw notFound("View not found.");
  return { view: v, access, table };
}

/** Personal views: owner edits. Collaborative: creator+, and locked views only by creator+ explicitly unlocking. */
function assertCanEditView(ctx: Ctx, view: typeof baseViews.$inferSelect, role: string) {
  if (view.ownerUserId) { if (view.ownerUserId !== ctx.userId) throw forbidden(); return; }
  if (view.isLocked) throw forbidden("This view is locked. Unlock it to make changes.");
  if (!atLeast(role, "creator")) throw forbidden("Only creators can change shared views. Create a personal view instead.");
}

export async function updateViewConfig(ctx: Ctx, viewId: string, patch: ViewConfig) {
  const { view, access } = await viewContext(ctx, viewId);
  assertCanEditView(ctx, view, access.role);
  const next: ViewConfig = { ...view.config, ...patch };
  if (next.filters && !["and", "or"].includes(next.filters.conjunction)) throw invalid("Bad filter conjunction");
  if ((next.filters?.conditions?.length ?? 0) > 50 || (next.sorts?.length ?? 0) > 10 || (next.groups?.length ?? 0) > 3) throw invalid("Too many filters, sorts or groups.");
  await db.update(baseViews).set({ config: next, updatedAt: now(), version: view.version + 1 }).where(eq(baseViews.id, viewId));
  return next;
}

export async function updateView(ctx: Ctx, viewId: string, patch: { name?: string; isLocked?: boolean; visibleTo?: string | null; share?: boolean }) {
  const { view, access } = await viewContext(ctx, viewId);
  const set: Record<string, unknown> = { updatedAt: now() };
  if (patch.isLocked !== undefined || patch.visibleTo !== undefined) {
    requireRole(access, "creator", "change view permissions");
    if (view.ownerUserId) throw invalid("Personal views can't be locked or restricted.");
    if (patch.isLocked !== undefined) set.isLocked = patch.isLocked;
    if (patch.visibleTo !== undefined) { if (patch.visibleTo && !rank(patch.visibleTo)) throw invalid("Unknown role"); set.visibleTo = patch.visibleTo; }
  }
  if (patch.name !== undefined) { if (!view.ownerUserId) requireRole(access, "creator", "rename shared views"); set.name = patch.name.trim().slice(0, 120) || view.name; }
  if (patch.share !== undefined) { requireRole(access, "creator", "share views"); set.shareToken = patch.share ? (view.shareToken ?? randomBytes(18).toString("base64url")) : null; }
  const [row] = await db.update(baseViews).set(set).where(eq(baseViews.id, viewId)).returning();
  await audit(db, ctx, "update_view", "base_views", viewId, { after: set as never });
  return row;
}

export async function archiveView(ctx: Ctx, viewId: string) {
  const { view, access } = await viewContext(ctx, viewId);
  if (!view.ownerUserId) requireRole(access, "creator", "delete shared views");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(baseViews).where(and(eq(baseViews.tableId, view.tableId), isNull(baseViews.archivedAt), isNull(baseViews.ownerUserId)));
  if (!view.ownerUserId && n <= 1) throw invalid("A table needs at least one shared view.");
  await db.update(baseViews).set({ archivedAt: now() }).where(eq(baseViews.id, viewId));
  await audit(db, ctx, "delete_view", "base_views", viewId, { meta: { name: view.name } });
}

export { viewContext, asLite };
