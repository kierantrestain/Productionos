import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { memberships, productionMembers, users } from "@/db/schema";
import { ENTITIES, getEntity, isEntityKey, type EntityDef, type FieldDef, type RegisteredEntityKey } from "@/lib/entities";
import { canRead, canSee, canWrite, isGlobalProductionRole } from "@/lib/permissions";
import type { Ctx } from "../auth/context";
import { audit, emit } from "../audit";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { tableFor } from "./tables";
import { HOOKS } from "./hooks";

export type Row = Record<string, unknown> & { id: string; version: number };

export interface ListOpts {
  q?: string;
  filters?: Record<string, string | undefined>;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  archived?: boolean;
}

export interface ListResult {
  rows: Row[];
  total: number;
  refs: Record<string, Record<string, string>>;
  redacted: string[];
}

// ───────────── helpers ─────────────

export function def(key: string): EntityDef & { key: RegisteredEntityKey } {
  if (!isEntityKey(key)) throw notFound(`Unknown entity "${key}"`);
  return getEntity(key) as EntityDef & { key: RegisteredEntityKey };
}

export function assertRead(ctx: Ctx, d: EntityDef) {
  if (!canRead(ctx.role, d.readDomain ?? d.domain)) throw forbidden();
}
export function assertWrite(ctx: Ctx, d: EntityDef) {
  if (!canWrite(ctx.role, d.domain, d.key)) throw forbidden();
}

export function productionAllowed(ctx: Ctx, productionId: string | null | undefined, d?: EntityDef) {
  if (ctx.productionIds === "all") return true;
  if (!productionId) return !!d?.orgRowsVisibleToScoped;
  return ctx.productionIds.includes(productionId);
}

/** Row-level scope filter for the entity, applied to every read and write. */
export function scopeWhere(ctx: Ctx, d: EntityDef, t: any): SQL | undefined {
  const conds: SQL[] = [eq(t.orgId, ctx.orgId)];
  if (!isGlobalProductionRole(ctx.role)) {
    const ids = ctx.productionIds === "all" ? null : ctx.productionIds;
    if (ids) {
      const safe = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
      if (d.key === "productions") conds.push(inArray(t.id, safe));
      else if (d.scope === "production") conds.push(inArray(t.productionId, safe));
      else if (d.scope === "production_optional") {
        conds.push(d.orgRowsVisibleToScoped ? or(isNull(t.productionId), inArray(t.productionId, safe))! : inArray(t.productionId, safe));
      }
    }
  }
  return and(...conds);
}

function fieldSchema(f: FieldDef): z.ZodTypeAny {
  const nullableStr = (max: number) => z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v), z.string().max(max).nullable());
  const num = (schema: z.ZodNumber) => z.preprocess((v) => (v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v), schema.nullable());
  switch (f.type) {
    case "text": return nullableStr(500);
    case "textarea": return nullableStr(20000);
    case "url": return nullableStr(2000).refine((v) => v == null || /^https?:\/\//i.test(v as string), "Must be an http(s) URL");
    case "email": return nullableStr(320).refine((v) => v == null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v as string), "Invalid email");
    case "int": return num(z.number().int().min(-1_000_000).max(1_000_000_000));
    case "bp": return num(z.number().int().min(0).max(10000));
    case "money": return num(z.number().int().min(-1e13).max(1e13));
    case "date": return nullableStr(10).refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v as string), "Date must be YYYY-MM-DD");
    case "time": return nullableStr(8).refine((v) => v == null || /^\d{2}:\d{2}(:\d{2})?$/.test(v as string), "Time must be HH:MM");
    case "datetime": return z.preprocess((v) => (v === "" || v == null ? null : new Date(v as string)), z.date().nullable());
    case "bool": return z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());
    case "select": return z.preprocess((v) => (v === "" ? null : v), z.enum(f.options as unknown as [string, ...string[]]).nullable());
    case "ref": return z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable());
  }
}

/** Validate a client patch against the registry. Rejects unknown, system and read-only fields. */
export function validatePatch(ctx: Ctx, d: EntityDef, input: Record<string, unknown>, mode: "create" | "update", opts: { allowReadOnly?: boolean } = {}) {
  const fields = new Map(d.fields.map((f) => [f.key, f]));
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const f = fields.get(k);
    if (!f) { errors[k] = "Unknown field"; continue; }
    if (f.system || (f.readOnly && !opts.allowReadOnly)) { errors[k] = "This field is managed by a workflow action"; continue; }
    if (f.sensitive && !canSee(ctx.role, f.sensitive)) { errors[k] = "You cannot edit this field"; continue; }
    const r = fieldSchema(f).safeParse(v);
    if (!r.success) { errors[k] = r.error.issues[0]?.message ?? "Invalid value"; continue; }
    if (f.required && (r.data === null || r.data === undefined)) { errors[k] = `${f.label} is required`; continue; }
    out[k] = r.data;
  }
  if (mode === "create") {
    for (const f of d.fields) if (f.required && (out[f.key] === undefined || out[f.key] === null) && !errors[f.key]) errors[f.key] = `${f.label} is required`;
  }
  if (Object.keys(errors).length) throw invalid("Please correct the highlighted fields.", errors);
  return out;
}

/** Every referenced record must exist in the same organisation (and production, when production-scoped). */
async function assertRefs(tx: DbOrTx, ctx: Ctx, d: EntityDef, values: Record<string, unknown>, productionId: string | null | undefined) {
  for (const f of d.fields) {
    if (f.type !== "ref" || f.key === "productionId") continue;
    const v = values[f.key];
    if (!v) continue;
    if (f.ref === "users") {
      const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, v as string))).limit(1);
      if (!m) throw invalid(`${f.label}: user not found in this organisation`, { [f.key]: "Not found" });
      continue;
    }
    const target = getEntity(f.ref!)!;
    const t = tableFor(f.ref as RegisteredEntityKey);
    const [row] = await tx.select().from(t).where(and(eq(t.id, v as string), eq(t.orgId, ctx.orgId))).limit(1);
    if (!row) throw invalid(`${f.label}: linked record not found`, { [f.key]: "Not found" });
    if (target.scope === "production" && productionId && (row as any).productionId !== productionId) {
      throw invalid(`${f.label} belongs to a different production`, { [f.key]: "Different production" });
    }
  }
  if (values.productionId) {
    const t = tableFor("productions");
    const [p] = await tx.select({ id: t.id }).from(t).where(and(eq(t.id, values.productionId as string), eq(t.orgId, ctx.orgId))).limit(1);
    if (!p) throw invalid("Production not found", { productionId: "Not found" });
  }
}

export function serialise(row: Record<string, unknown>): Row {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out as Row;
}

export function redact(ctx: Ctx, d: EntityDef, row: Row): { row: Row; redacted: string[] } {
  const redacted: string[] = [];
  for (const f of d.fields) {
    if (f.sensitive && !canSee(ctx.role, f.sensitive)) { if (f.key in row) row[f.key] = null; redacted.push(f.key); }
  }
  return { row, redacted };
}

/** Resolve display labels for every ref column in a set of rows. */
export async function resolveRefs(ctx: Ctx, d: EntityDef, rows: Row[]) {
  const refs: Record<string, Record<string, string>> = {};
  const byEntity = new Map<string, Set<string>>();
  for (const f of d.fields) {
    if (f.type !== "ref") continue;
    for (const r of rows) {
      const v = r[f.key] as string | null;
      if (!v) continue;
      if (!byEntity.has(f.ref!)) byEntity.set(f.ref!, new Set());
      byEntity.get(f.ref!)!.add(v);
    }
  }
  for (const [ent, idSet] of byEntity) {
    const ids = [...idSet];
    refs[ent] = {};
    if (ent === "users") {
      const us = await db.select({ id: users.id, name: users.name }).from(users)
        .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.orgId, ctx.orgId))).where(inArray(users.id, ids));
      for (const u of us) refs[ent][u.id] = u.name;
      continue;
    }
    const td = getEntity(ent)!;
    const t = tableFor(ent as RegisteredEntityKey);
    const rs = await db.select().from(t).where(and(eq(t.orgId, ctx.orgId), inArray(t.id, ids)));
    for (const r of rs as any[]) refs[ent][r.id] = refLabel(td, r);
  }
  return refs;
}

export function refLabel(td: EntityDef, r: any): string {
  if (td.key === "episodes") return [r.number != null ? `Ep ${r.number}` : r.code, r.title].filter(Boolean).join(" · ");
  if (td.key === "scenes") return `${r.number} · ${r.title}`;
  if (td.key === "shots") return `Shot ${r.number}`;
  if (td.key === "shoot_days") return `${r.date}${r.dayNumber ? ` · Day ${r.dayNumber}` : ""}${r.unit && r.unit !== "Main Unit" ? ` · ${r.unit}` : ""}`;
  if (td.key === "engagements") return [r.roleTitle, r.characterName].filter(Boolean).join(" / ") || r.kind;
  if (td.key === "budget_lines") return [r.code, r.category].filter(Boolean).join(" ");
  const v = r[td.titleField];
  return v == null ? "(untitled)" : String(v);
}

// ───────────── public API ─────────────

export async function listEntity(ctx: Ctx, key: string, opts: ListOpts = {}): Promise<ListResult> {
  const d = def(key);
  assertRead(ctx, d);
  const t = tableFor(d.key);
  const conds: (SQL | undefined)[] = [scopeWhere(ctx, d, t), opts.archived ? isNotNull(t.archivedAt) : isNull(t.archivedAt)];
  const fieldMap = new Map(d.fields.map((f) => [f.key, f]));
  for (const [k, raw] of Object.entries(opts.filters ?? {})) {
    if (raw === undefined || raw === "") continue;
    const f = fieldMap.get(k);
    if (!f || !t[k]) continue;
    if (f.sensitive && !canSee(ctx.role, f.sensitive)) continue;
    if (raw === "__null") { conds.push(isNull(t[k])); continue; }
    if (f.type === "bool") conds.push(eq(t[k], raw === "true"));
    else if (f.type === "int") { if (!Number.isNaN(Number(raw))) conds.push(eq(t[k], Number(raw))); }
    else if (f.type === "ref") { if (/^[0-9a-f-]{36}$/i.test(raw)) conds.push(eq(t[k], raw)); }
    else conds.push(eq(t[k], raw));
  }
  if (opts.q?.trim()) {
    const term = `%${opts.q.trim().replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    const searchable = d.search.filter((k) => t[k] && !fieldMap.get(k)?.sensitive);
    if (searchable.length) conds.push(or(...searchable.map((k) => ilike(sql`${t[k]}::text`, term))));
  }
  const where = and(...conds.filter(Boolean) as SQL[]);
  const sortKey = opts.sort && (fieldMap.has(opts.sort) || opts.sort === "createdAt" || opts.sort === "updatedAt") ? opts.sort : d.defaultSort.key;
  const dir = opts.sort ? (opts.dir ?? "asc") : d.defaultSort.dir;
  const sortCol = t[sortKey] ?? t.createdAt;
  const pageSize = Math.min(Math.max(opts.pageSize ?? 200, 1), 1000);
  const page = Math.max(opts.page ?? 1, 1);
  const order = dir === "desc" ? sql`${sortCol} desc nulls last` : sql`${sortCol} asc nulls last`;
  const [rowsRaw, [{ n }]] = await Promise.all([
    db.select().from(t).where(where).orderBy(order, asc(t.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(t).where(where),
  ]);
  let redacted: string[] = [];
  const rows = (rowsRaw as Record<string, unknown>[]).map((r) => { const x = redact(ctx, d, serialise(r)); redacted = x.redacted; return x.row; });
  const refs = await resolveRefs(ctx, d, rows);
  return { rows, total: Number(n), refs, redacted };
}

export async function getEntityRow(ctx: Ctx, key: string, id: string, tx: DbOrTx = db): Promise<Row> {
  const d = def(key);
  assertRead(ctx, d);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const t = tableFor(d.key);
  const [row] = await tx.select().from(t).where(and(eq(t.id, id), scopeWhere(ctx, d, t))).limit(1);
  if (!row) throw notFound();
  return redact(ctx, d, serialise(row as Record<string, unknown>)).row;
}

export async function createEntity(ctx: Ctx, key: string, input: Record<string, unknown>, opts: { tx?: DbOrTx; allowReadOnly?: boolean; skipHooks?: boolean } = {}): Promise<Row> {
  const d = def(key);
  assertWrite(ctx, d);
  const values = validatePatch(ctx, d, input, "create", opts);
  const run = async (tx: DbOrTx) => {
    const productionId = (values.productionId as string | null | undefined) ?? null;
    if (d.scope !== "org" && !productionAllowed(ctx, productionId, d)) throw forbidden("You are not a member of that production.");
    await assertRefs(tx, ctx, d, values, productionId);
    const hook = HOOKS[d.key];
    if (hook?.beforeCreate && !opts.skipHooks) await hook.beforeCreate(tx, ctx, values);
    const t = tableFor(d.key);
    const [row] = await tx.insert(t).values({ ...values, orgId: ctx.orgId, createdBy: ctx.userId }).returning();
    const r = row as Row;
    await audit(tx, ctx, "create", d.key, r.id, { after: r, productionId: (r.productionId as string) ?? null });
    await emit(tx, { orgId: ctx.orgId, type: `${d.key}.created`, entityType: d.key, entityId: r.id, productionId: (r.productionId as string) ?? null, idempotencyKey: `${d.key}.created:${r.id}`, actorUserId: ctx.userId, payload: { version: 1 } });
    if (hook?.afterWrite && !opts.skipHooks) await hook.afterWrite(tx, ctx, null, r);
    return r;
  };
  const row = opts.tx ? await run(opts.tx) : await db.transaction(run);
  return redact(ctx, d, serialise(row)).row;
}

export async function updateEntity(ctx: Ctx, key: string, id: string, patch: Record<string, unknown>, expectedVersion?: number, opts: { tx?: DbOrTx; allowReadOnly?: boolean } = {}): Promise<Row> {
  const d = def(key);
  assertWrite(ctx, d);
  const values = validatePatch(ctx, d, patch, "update", opts);
  if (!Object.keys(values).length) return getEntityRow(ctx, key, id);
  const run = async (tx: DbOrTx) => {
    const t = tableFor(d.key);
    const [existing] = await tx.select().from(t).where(and(eq(t.id, id), scopeWhere(ctx, d, t))).for("update").limit(1);
    if (!existing) throw notFound();
    const ex = existing as Row;
    if (expectedVersion !== undefined && ex.version !== expectedVersion) throw conflict("Someone else changed this record. Refresh to see the latest version.");
    const productionId = ("productionId" in values ? values.productionId : ex.productionId) as string | null;
    if (d.scope !== "org" && !productionAllowed(ctx, productionId, d)) throw forbidden("You are not a member of that production.");
    await assertRefs(tx, ctx, d, values, productionId);
    const hook = HOOKS[d.key];
    if (hook?.beforeUpdate) await hook.beforeUpdate(tx, ctx, ex, values);
    const [row] = await tx.update(t).set({ ...values, updatedAt: new Date(), version: sql`${t.version} + 1` }).where(and(eq(t.id, id), eq(t.orgId, ctx.orgId))).returning();
    const r = row as Row;
    await audit(tx, ctx, "update", d.key, id, { before: ex, after: r, productionId });
    await emit(tx, { orgId: ctx.orgId, type: `${d.key}.updated`, entityType: d.key, entityId: id, productionId, idempotencyKey: `${d.key}.updated:${id}:v${r.version}`, actorUserId: ctx.userId, payload: { version: r.version, changed: Object.keys(values) } });
    if (hook?.afterWrite) await hook.afterWrite(tx, ctx, ex, r);
    return r;
  };
  const row = opts.tx ? await run(opts.tx) : await db.transaction(run);
  return redact(ctx, d, serialise(row)).row;
}

export async function archiveEntity(ctx: Ctx, key: string, id: string, restore = false): Promise<void> {
  const d = def(key);
  assertWrite(ctx, d);
  await db.transaction(async (tx) => {
    const t = tableFor(d.key);
    const [existing] = await tx.select().from(t).where(and(eq(t.id, id), scopeWhere(ctx, d, t))).limit(1);
    if (!existing) throw notFound();
    await tx.update(t).set({ archivedAt: restore ? null : new Date(), updatedAt: new Date(), version: sql`${t.version} + 1` }).where(eq(t.id, id));
    await audit(tx, ctx, restore ? "restore" : "archive", d.key, id, { productionId: (existing as Row).productionId as string ?? null });
  });
}

export async function batchUpdate(ctx: Ctx, key: string, ids: string[], patch: Record<string, unknown>) {
  if (ids.length > 500) throw invalid("Batch too large (max 500)");
  const results: Row[] = [];
  await db.transaction(async (tx) => {
    for (const id of ids) results.push(await updateEntity(ctx, key, id, patch, undefined, { tx }));
  });
  return results.length;
}

export async function batchArchive(ctx: Ctx, key: string, ids: string[], restore = false) {
  if (ids.length > 500) throw invalid("Batch too large (max 500)");
  for (const id of ids) await archiveEntity(ctx, key, id, restore);
  return ids.length;
}

/** Lightweight option list for ref pickers (scoped + permission-checked). */
export async function refOptions(ctx: Ctx, key: string, opts: { q?: string; productionId?: string; limit?: number } = {}) {
  if (key === "users") {
    const us = await db.select({ id: users.id, name: users.name }).from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.orgId, ctx.orgId))).orderBy(asc(users.name));
    return us.map((u) => ({ id: u.id, label: u.name }));
  }
  const d = def(key);
  if (!canRead(ctx.role, d.readDomain ?? d.domain)) return [];
  const t = tableFor(d.key);
  const conds: (SQL | undefined)[] = [scopeWhere(ctx, d, t), isNull(t.archivedAt)];
  if (opts.productionId && d.scope === "production") conds.push(eq(t.productionId, opts.productionId));
  if (opts.q) conds.push(ilike(sql`${t[d.titleField]}::text`, `%${opts.q}%`));
  const rows = await db.select().from(t).where(and(...conds.filter(Boolean) as SQL[])).orderBy(asc(t[d.defaultSort.key] ?? t.createdAt)).limit(opts.limit ?? 500);
  return (rows as any[]).map((r) => ({ id: r.id as string, label: refLabel(d, r) }));
}

export async function addProductionMember(tx: DbOrTx, orgId: string, productionId: string, userId: string) {
  await tx.insert(productionMembers).values({ orgId, productionId, userId }).onConflictDoNothing();
}

export { ENTITIES, desc };
