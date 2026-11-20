/**
 * Query engine: loads table data, computes derived fields (lookup, rollup, count, formula, system),
 * then applies a view's filters, sorts, groups, search and row colours. Computation is memoised per
 * request across tables, with a cycle guard for mutually-dependent relations.
 */
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { baseFields, baseRecords, baseTables, memberships, users, type ViewConfig } from "@/db/schema";
import { displayValue, type FieldDefLite, type FieldOptions, type FieldType } from "@/lib/platform/fields";
import { evaluate, parse, references, type Ast } from "@/lib/platform/formula";
import type { Ctx } from "../auth/context";
import { fieldVisible } from "./access";

type Rec = typeof baseRecords.$inferSelect;
interface TableState { table: typeof baseTables.$inferSelect; fields: FieldDefLite[]; records: Rec[]; byId: Map<string, Rec>; values?: Map<string, Record<string, unknown>> }

export class Computer {
  private tables = new Map<string, TableState>();
  private computing = new Set<string>();
  private userNames?: Map<string, string>;
  constructor(private ctx: Ctx, private now = new Date()) {}
  /** Load only these records of a table (the rest of the table is never read). Set before compute(). */
  private only = new Map<string, string[]>();
  restrict(tableId: string, ids: string[]) { this.only.set(tableId, ids); }

  async users() {
    if (!this.userNames) {
      const rows = await db.select({ id: users.id, name: users.name }).from(users).innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.orgId, this.ctx.orgId)));
      this.userNames = new Map(rows.map((r) => [r.id, r.name]));
    }
    return this.userNames;
  }

  /** All tables computed together must share one base: links can never pull another base's records. */
  private baseId?: string;

  async load(tableId: string): Promise<TableState> {
    const hit = this.tables.get(tableId); if (hit) return hit;
    const [table] = await db.select().from(baseTables).where(and(eq(baseTables.id, tableId), eq(baseTables.orgId, this.ctx.orgId))).limit(1);
    if (!table) throw new Error("table missing");
    this.baseId ??= table.baseId;
    if (table.baseId !== this.baseId) {
      // Cross-base reference (only possible through tampered options): expose nothing from it.
      const empty: TableState = { table, fields: [], records: [], byId: new Map(), values: new Map() };
      this.tables.set(tableId, empty);
      return empty;
    }
    const fields = (await db.select().from(baseFields).where(and(eq(baseFields.tableId, tableId), isNull(baseFields.archivedAt))).orderBy(asc(baseFields.sortOrder), asc(baseFields.createdAt)))
      .map((f) => ({ id: f.id, name: f.name, type: f.type as FieldType, options: f.options as FieldOptions, description: f.description, permissions: f.permissions }));
    const only = this.only.get(tableId);
    const records = only && !only.length ? [] : await db.select().from(baseRecords).where(and(eq(baseRecords.tableId, tableId), isNull(baseRecords.deletedAt), ...(only ? [inArray(baseRecords.id, only.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 5000))] : []))).orderBy(asc(baseRecords.sortOrder), asc(baseRecords.autonumber));
    const st: TableState = { table, fields, records, byId: new Map(records.map((r) => [r.id, r])) };
    this.tables.set(tableId, st);
    return st;
  }

  /** Values (raw + computed) for every record of a table. */
  async compute(tableId: string): Promise<TableState> {
    const st = await this.load(tableId);
    if (st.values) return st;
    if (this.computing.has(tableId)) return st; // cycle: caller falls back to raw values
    this.computing.add(tableId);
    const names = await this.users();
    const values = new Map<string, Record<string, unknown>>();
    for (const r of st.records) {
      const v: Record<string, unknown> = { ...r.data };
      for (const f of st.fields) {
        if (f.type === "autonumber") v[f.id] = r.autonumber;
        else if (f.type === "createdTime") v[f.id] = r.createdAt.toISOString();
        else if (f.type === "lastModifiedTime") v[f.id] = r.updatedAt.toISOString();
        else if (f.type === "createdBy") v[f.id] = r.createdBy;
        else if (f.type === "lastModifiedBy") v[f.id] = r.updatedBy;
      }
      values.set(r.id, v);
    }
    // Relations: lookup / rollup / count.
    for (const f of st.fields.filter((x) => ["lookup", "rollup", "count"].includes(x.type))) {
      const link = st.fields.find((x) => x.id === f.options.linkFieldId);
      if (!link) continue;
      const other = await this.compute(link.options.linkedTableId!);
      const target = other.fields.find((x) => x.id === f.options.targetFieldId);
      for (const r of st.records) {
        const ids = (values.get(r.id)![link.id] as string[] | undefined) ?? [];
        const linked = ids.map((id) => other.byId.get(id)).filter(Boolean) as Rec[];
        if (f.type === "count") { values.get(r.id)![f.id] = linked.length; continue; }
        if (!target) continue;
        const raw = linked.map((lr) => (other.values?.get(lr.id) ?? lr.data)[target.id]).flatMap((x) => (Array.isArray(x) && target.type !== "attachment" ? x : [x]));
        const shown = raw.map((x) => lookupValue(target, x, names, (tid, id) => this.titleSync(tid, id)));
        values.get(r.id)![f.id] = f.type === "lookup" ? shown.filter((x) => x !== null && x !== undefined && x !== "") : rollup(f.options.rollupFn ?? "sum", raw.filter((x) => x !== null && x !== undefined && x !== ""));
      }
    }
    // Formulas in dependency order.
    const formulas = st.fields.filter((x) => x.type === "formula" && x.options.formula);
    const asts = new Map<string, Ast>();
    for (const f of formulas) { try { asts.set(f.id, parse(f.options.formula!)); } catch { /* invalid formula renders #ERROR */ } }
    const order: FieldDefLite[] = []; const seen = new Set<string>();
    const visit = (f: FieldDefLite, path: Set<string>) => {
      if (seen.has(f.id) || path.has(f.id)) return; path.add(f.id);
      for (const ref of references(asts.get(f.id) ?? { k: "num", v: 0 })) { const dep = formulas.find((x) => x.id === ref); if (dep) visit(dep, path); }
      seen.add(f.id); order.push(f);
    };
    formulas.forEach((f) => visit(f, new Set()));
    const fieldById = new Map(st.fields.map((f) => [f.id, f]));
    for (const f of order) {
      const ast = asts.get(f.id);
      for (const r of st.records) {
        const v = values.get(r.id)!;
        v[f.id] = ast ? evaluate(ast, (id) => formulaInput(fieldById.get(id), v[id], names, (tid, rid) => this.titleSync(tid, rid)), this.now) : "#ERROR";
      }
    }
    st.values = values;
    this.computing.delete(tableId);
    return st;
  }

  /** Primary-field title of a record (from computed values when available). */
  titleSync(tableId: string, recordId: string): string {
    const st = this.tables.get(tableId); if (!st) return "";
    const rec = st.byId.get(recordId); if (!rec) return "(deleted)";
    const pf = st.fields.find((f) => f.id === st.table.primaryFieldId) ?? st.fields[0];
    if (!pf) return "";
    const val = (st.values?.get(recordId) ?? rec.data)[pf.id];
    return displayValue(pf, val, { userName: (id) => this.userNames?.get(id) ?? "", recordTitle: () => "" }) || "Unnamed record";
  }
}

function formulaInput(f: FieldDefLite | undefined, v: unknown, names: Map<string, string>, title: (t: string, id: string) => string): unknown {
  if (!f || v === undefined) return null;
  if (f.type === "singleSelect" || f.type === "multipleSelects" || f.type === "link" || f.type === "user" || f.type === "createdBy" || f.type === "lastModifiedBy" || f.type === "attachment")
    return displayValue(f, v, { recordTitle: title, userName: (id) => names.get(id) ?? "" });
  return v;
}

function lookupValue(target: FieldDefLite, x: unknown, names: Map<string, string>, title: (t: string, id: string) => string): unknown {
  if (x === null || x === undefined) return null;
  if (["singleSelect", "multipleSelects", "user", "createdBy", "lastModifiedBy"].includes(target.type)) return displayValue(target, x, { userName: (id) => names.get(id) ?? "" });
  if (target.type === "link") return title(target.options.linkedTableId!, String(x));
  if (target.type === "attachment") return (x as { filename: string }).filename;
  return x;
}

function rollup(fn: string, xs: unknown[]): unknown {
  const nums = xs.map(Number).filter((n) => Number.isFinite(n));
  switch (fn) {
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "avg": return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case "min": return nums.length ? Math.min(...nums) : null;
    case "max": return nums.length ? Math.max(...nums) : null;
    case "count": return nums.length;
    case "countA": return xs.length;
    case "countUnique": return new Set(xs.map(String)).size;
    case "concat": return xs.map(String).join(", ");
    case "and": return xs.every(Boolean);
    case "or": return xs.some(Boolean);
    case "earliest": { const ds = xs.map((x) => new Date(String(x))).filter((d) => !Number.isNaN(d.getTime())); return ds.length ? new Date(Math.min(...ds.map((d) => d.getTime()))).toISOString() : null; }
    case "latest": { const ds = xs.map((x) => new Date(String(x))).filter((d) => !Number.isNaN(d.getTime())); return ds.length ? new Date(Math.max(...ds.map((d) => d.getTime()))).toISOString() : null; }
  }
  return null;
}

// ───────────── Filtering, sorting, grouping ─────────────

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
function asDate(v: unknown): Date | null { if (v === null || v === undefined || v === "") return null; const d = new Date(typeof v === "string" && v.length === 10 ? `${v}T00:00:00Z` : String(v)); return Number.isNaN(d.getTime()) ? null : d; }
const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || v === false || (Array.isArray(v) && v.length === 0);

export function matches(f: FieldDefLite, v: unknown, op: string, want: unknown, text: string, now: Date): boolean {
  const arr = Array.isArray(v) ? (v as unknown[]).map(String) : v === null || v === undefined ? [] : [String(v)];
  const wants = Array.isArray(want) ? want.map(String) : want === undefined || want === null || want === "" ? [] : [String(want)];
  switch (op) {
    case "isEmpty": return isEmpty(v);
    case "isNotEmpty": return !isEmpty(v);
    case "isChecked": return !!v; case "isNotChecked": return !v;
    case "contains": return text.toLowerCase().includes(String(want ?? "").toLowerCase());
    case "doesNotContain": return !text.toLowerCase().includes(String(want ?? "").toLowerCase());
    case "is": {
      if (["date", "dateTime", "createdTime", "lastModifiedTime"].includes(f.type)) { const d = asDate(v), w = asDate(want); return !!d && !!w && dayStr(d) === dayStr(w); }
      if (f.type === "singleSelect") return v === want;
      return text.toLowerCase() === String(want ?? "").toLowerCase();
    }
    case "isNot": return f.type === "singleSelect" ? v !== want : text.toLowerCase() !== String(want ?? "").toLowerCase();
    case "isAnyOf": return wants.includes(String(v));
    case "isNoneOf": return !wants.includes(String(v));
    case "hasAnyOf": return wants.some((w) => arr.includes(w));
    case "hasAllOf": return wants.every((w) => arr.includes(w));
    case "hasNoneOf": return !wants.some((w) => arr.includes(w));
    case "=": return Number(v) === Number(want); case "!=": return Number(v) !== Number(want);
    case "<": return v !== null && Number(v) < Number(want); case "<=": return v !== null && Number(v) <= Number(want);
    case ">": return v !== null && Number(v) > Number(want); case ">=": return v !== null && Number(v) >= Number(want);
    case "isBefore": { const d = asDate(v), w = want === "today" ? new Date(dayStr(now)) : asDate(want); return !!d && !!w && d < w; }
    case "isAfter": { const d = asDate(v), w = want === "today" ? new Date(new Date(dayStr(now)).getTime() + 864e5 - 1) : asDate(want); return !!d && !!w && d > w; }
    case "isToday": { const d = asDate(v); return !!d && dayStr(d) === dayStr(now); }
    case "isWithinNextDays": { const d = asDate(v); const n = Number(want); return !!d && d >= new Date(dayStr(now)) && d <= new Date(now.getTime() + n * 864e5); }
    case "isWithinPastDays": { const d = asDate(v); const n = Number(want); return !!d && d <= now && d >= new Date(now.getTime() - n * 864e5); }
  }
  return true;
}

const COLLATOR = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });
function compare(f: FieldDefLite, a: unknown, b: unknown, ta: () => string, tb: () => string): number {
  const ea = isEmpty(a) && a !== false, eb = isEmpty(b) && b !== false;
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // empties last
  switch (f.type) {
    case "number": case "currency": case "percent": case "rating": case "duration": case "autonumber": case "count": return Number(a) - Number(b);
    case "checkbox": return (a ? 1 : 0) - (b ? 1 : 0);
    case "date": case "dateTime": case "createdTime": case "lastModifiedTime": return (asDate(a)?.getTime() ?? 0) - (asDate(b)?.getTime() ?? 0);
    case "singleSelect": { const ch = f.options.choices ?? []; return ch.findIndex((c) => c.id === a) - ch.findIndex((c) => c.id === b); }
    case "rollup": case "formula": if (typeof a === "number" && typeof b === "number") return a - b; break;
  }
  return COLLATOR.compare(ta(), tb());
}

export interface ViewRow { id: string; values: Record<string, unknown>; color: string | null; autonumber: number; createdAt: string; updatedAt: string }

/** Compute a table and apply a view. Fields hidden from the caller's role are removed from output. */
export async function runView(ctx: Ctx, role: string, tableId: string, config: ViewConfig, opts: { search?: string; recordIds?: string[]; limit?: number; offset?: number } = {}) {
  const comp = new Computer(ctx);
  // Capacity: never load a whole table when the caller only needs some of it.
  const meta = await tableMeta(ctx, tableId);
  const selfLink = !!meta && meta.fields.some((f) => f.type === "link" && f.options.linkedTableId === tableId);
  let plan: SqlPlan | null = null;
  if (meta && !selfLink) {
    if (opts.recordIds) comp.restrict(tableId, opts.recordIds);
    else if (opts.limit !== undefined) { plan = await sqlPlan(meta, config, opts, role, ctx); if (plan) comp.restrict(tableId, plan.ids); }
  }
  const st = await comp.compute(tableId);
  const names = await comp.users();
  const visible = st.fields.filter((f) => fieldVisible(role, f));
  const text = (f: FieldDefLite, v: unknown) => displayValue(f, v, { recordTitle: (t, id) => comp.titleSync(t, id), userName: (id) => names.get(id) ?? "" });
  // Pre-compute linked tables' titles for display.
  for (const f of st.fields.filter((x) => x.type === "link")) await comp.compute(f.options.linkedTableId!);
  let rows = plan ? plan.ids.map((id) => st.byId.get(id)).filter(Boolean) as Rec[] : st.records.filter((r) => !opts.recordIds || opts.recordIds.includes(r.id));
  const vals = (r: Rec) => st.values!.get(r.id)!;
  // Display text is only needed for text-based ops/sorts; memoise it per row+field (it can be expensive).
  const memo = new Map<string, string>();
  const textOf = (f: FieldDefLite, r: Rec) => { const k = `${r.id}\u0000${f.id}`; let t = memo.get(k); if (t === undefined) { t = text(f, vals(r)[f.id]); memo.set(k, t); } return t; };
  const TEXT_OPS = new Set(["contains", "doesNotContain", "is", "isNot"]);
  const conds = plan ? [] : (config.filters?.conditions ?? []).filter((c) => st.fields.some((f) => f.id === c.fieldId));
  if (conds.length) {
    const now = new Date();
    const byId = new Map(st.fields.map((f) => [f.id, f]));
    const test = (r: Rec) => conds.map((c) => { const f = byId.get(c.fieldId)!; const v = vals(r)[f.id]; return matches(f, v, c.op, c.value, TEXT_OPS.has(c.op) ? textOf(f, r) : "", now); });
    rows = rows.filter((r) => (config.filters!.conjunction === "or" ? test(r).some(Boolean) : test(r).every(Boolean)));
  }
  if (!plan && opts.search?.trim()) {
    const q = opts.search.trim().toLowerCase();
    rows = rows.filter((r) => visible.some((f) => textOf(f, r).toLowerCase().includes(q)));
  }
  const sortKeys = [...(config.groups ?? []), ...(config.sorts ?? [])].map((s) => ({ ...s, f: st.fields.find((x) => x.id === s.fieldId) })).filter((s) => s.f) as { fieldId: string; dir: "asc" | "desc"; f: FieldDefLite }[];
  if (sortKeys.length && !plan) {
    rows = [...rows].sort((a, b) => {
      for (const s of sortKeys) { const va = vals(a)[s.f.id], vb = vals(b)[s.f.id]; const c = compare(s.f, va, vb, () => textOf(s.f, a), () => textOf(s.f, b)); if (c) return s.dir === "desc" ? -c : c; }
      return a.sortOrder - b.sortOrder;
    });
  }
  const colorOf = (r: Rec): string | null => {
    const c = config.color;
    if (c?.mode === "select" && c.fieldId) { const f = st.fields.find((x) => x.id === c.fieldId); const v = vals(r)[c.fieldId]; return f?.options.choices?.find((ch) => ch.id === (Array.isArray(v) ? v[0] : v))?.color ?? null; }
    if (c?.mode === "conditions") { for (const rule of c.rules ?? []) { const f = st.fields.find((x) => x.id === rule.fieldId); if (f && matches(f, vals(r)[f.id], rule.op, rule.value, text(f, vals(r)[f.id]), new Date())) return rule.color; } }
    return r.rowColor;
  };
  const matched = plan ? plan.matched : rows.length;
  if (!plan && (opts.limit !== undefined || opts.offset)) rows = rows.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? rows.length));
  const out: ViewRow[] = rows.map((r) => {
    const v = vals(r); const shown: Record<string, unknown> = {};
    for (const f of visible) shown[f.id] = presentForClient(f, v[f.id], comp, names);
    return { id: r.id, values: shown, color: colorOf(r), autonumber: r.autonumber, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
  });
  const total = plan ? plan.total : opts.recordIds && meta && !selfLink ? await countRecords(tableId) : st.records.length;
  return { table: st.table, fields: visible, rows: out, total, matched };
}

// ───────────── Large tables: filter / sort / page in Postgres ─────────────
/** Tables at least this big use the SQL path for paged views (smaller tables stay fully in memory). */
const FAST_MIN_ROWS = () => Number(process.env.FAST_VIEW_MIN_ROWS ?? 3000);
type Meta = { table: typeof baseTables.$inferSelect; fields: FieldDefLite[] };
type SqlPlan = { ids: string[]; matched: number; total: number };
async function tableMeta(ctx: Ctx, tableId: string): Promise<Meta | null> {
  const [table] = await db.select().from(baseTables).where(and(eq(baseTables.id, tableId), eq(baseTables.orgId, ctx.orgId))).limit(1);
  if (!table) return null;
  const fields = (await db.select().from(baseFields).where(and(eq(baseFields.tableId, tableId), isNull(baseFields.archivedAt)))).map((f) => ({ id: f.id, name: f.name, type: f.type as FieldType, options: f.options as FieldOptions, description: f.description, permissions: f.permissions }));
  return { table, fields };
}
async function countRecords(tableId: string, where?: SQL) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(baseRecords).where(and(eq(baseRecords.tableId, tableId), isNull(baseRecords.deletedAt), ...(where ? [where] : [])));
  return r?.n ?? 0;
}
const TEXT_T = new Set(["singleLineText", "longText", "email", "url", "phone"]);
const NUM_T = new Set(["number", "currency", "percent", "rating", "duration"]);
const DATE_T = new Set(["date", "dateTime"]);
const raw = (fid: string) => sql`${baseRecords.data}->>${fid}`;
const jv = (fid: string) => sql`${baseRecords.data}->${fid}`;
const numExpr = (fid: string) => sql`(CASE WHEN jsonb_typeof(${jv(fid)}) = 'number' THEN (${raw(fid)})::numeric WHEN ${raw(fid)} ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (${raw(fid)})::numeric END)`;
const tsExpr = (fid: string) => sql`(CASE WHEN ${raw(fid)} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (${raw(fid)} || 'T00:00:00Z')::timestamptz WHEN ${raw(fid)} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:?[0-9]{2})?$' THEN (${raw(fid)})::timestamptz END)`;
const emptyExpr = (fid: string) => sql`(${jv(fid)} IS NULL OR ${jv(fid)} IN ('null'::jsonb, '""'::jsonb, 'false'::jsonb, '[]'::jsonb))`;
const likeEsc = (v: string) => `%${v.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const day0 = (d: Date) => new Date(dayStr(d));
/** A text[] built server-side from a JSON parameter (array parameters must not be expanded into tuples). */
const textArr = (xs: string[]) => sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(xs)}::jsonb))`;
function dateWant(v: unknown): Date | null { return asDate(v); }

/** SQL for one condition, exactly matching matches() — or null when it can't be expressed (falls back to memory). */
function condSql(f: FieldDefLite, op: string, want: unknown, now: Date): SQL | null {
  if (op === "isEmpty" || op === "isNotEmpty") { if (!(TEXT_T.has(f.type) || NUM_T.has(f.type) || DATE_T.has(f.type) || ["checkbox", "singleSelect", "multipleSelects", "attachment"].includes(f.type))) return null; return op === "isEmpty" ? emptyExpr(f.id) : sql`NOT ${emptyExpr(f.id)}`; }
  if (TEXT_T.has(f.type)) {
    const w = String(want ?? "");
    if (op === "contains") return sql`coalesce(${raw(f.id)}, '') ILIKE ${likeEsc(w)}`;
    if (op === "doesNotContain") return sql`coalesce(${raw(f.id)}, '') NOT ILIKE ${likeEsc(w)}`;
    if (op === "is") return sql`lower(coalesce(${raw(f.id)}, '')) = lower(${w})`;
    if (op === "isNot") return sql`lower(coalesce(${raw(f.id)}, '')) <> lower(${w})`;
    return null;
  }
  if (NUM_T.has(f.type)) {
    const n = Number(want); if (!Number.isFinite(n)) return null;
    if (op === "=") return sql`coalesce(${numExpr(f.id)}, 0) = ${n}`;
    if (op === "!=") return sql`coalesce(${numExpr(f.id)}, 0) <> ${n}`;
    const cmp = { "<": sql`<`, "<=": sql`<=`, ">": sql`>`, ">=": sql`>=` }[op as "<"];
    return cmp ? sql`${numExpr(f.id)} ${cmp} ${n}` : null;
  }
  if (f.type === "checkbox") return op === "isChecked" ? sql`${jv(f.id)} = 'true'::jsonb` : op === "isNotChecked" ? sql`(${jv(f.id)} IS NULL OR ${jv(f.id)} <> 'true'::jsonb)` : null;
  if (f.type === "singleSelect") {
    const wants = Array.isArray(want) ? want.map(String) : want === undefined || want === null || want === "" ? [] : [String(want)];
    if (op === "is") return typeof want === "string" ? sql`${raw(f.id)} = ${want}` : null;
    if (op === "isNot") return typeof want === "string" ? sql`${raw(f.id)} IS DISTINCT FROM ${want}` : null;
    if (op === "isAnyOf") return wants.length ? sql`${raw(f.id)} = ANY(${textArr(wants)})` : sql`false`;
    if (op === "isNoneOf") return wants.length ? sql`NOT (coalesce(${raw(f.id)}, '') = ANY(${textArr(wants)}))` : sql`true`;
    return null;
  }
  if (f.type === "multipleSelects" || f.type === "user") {
    const wants = Array.isArray(want) ? want.map(String) : want === undefined || want === null || want === "" ? [] : [String(want)];
    if (op === "hasAnyOf") return wants.length ? sql`coalesce(${jv(f.id)}, '[]'::jsonb) ?| ${textArr(wants)}` : sql`false`;
    if (op === "hasAllOf") return sql`coalesce(${jv(f.id)}, '[]'::jsonb) ?& ${textArr(wants)}`;
    if (op === "hasNoneOf") return wants.length ? sql`NOT (coalesce(${jv(f.id)}, '[]'::jsonb) ?| ${textArr(wants)})` : sql`true`;
    return null;
  }
  if (DATE_T.has(f.type)) {
    const t = tsExpr(f.id);
    if (op === "isBefore") { const w = want === "today" ? day0(now) : dateWant(want); return w ? sql`${t} < ${w.toISOString()}::timestamptz` : sql`false`; }
    if (op === "isAfter") { const w = want === "today" ? new Date(day0(now).getTime() + 864e5 - 1) : dateWant(want); return w ? sql`${t} > ${w.toISOString()}::timestamptz` : sql`false`; }
    if (op === "isToday") return sql`(${t} AT TIME ZONE 'UTC')::date = ${dayStr(now)}::date`;
    if (op === "is") { const w = dateWant(want); return w ? sql`(${t} AT TIME ZONE 'UTC')::date = ${dayStr(w)}::date` : sql`false`; }
    if (op === "isWithinNextDays") { const n = Number(want); return Number.isFinite(n) ? sql`(${t} >= ${day0(now).toISOString()}::timestamptz AND ${t} <= ${new Date(now.getTime() + n * 864e5).toISOString()}::timestamptz)` : sql`false`; }
    if (op === "isWithinPastDays") { const n = Number(want); return Number.isFinite(n) ? sql`(${t} <= ${now.toISOString()}::timestamptz AND ${t} >= ${new Date(now.getTime() - n * 864e5).toISOString()}::timestamptz)` : sql`false`; }
    return null;
  }
  return null;
}
/** Sort key matching compare(): empties are NULL (last ascending, first descending — Postgres defaults). */
function sortSql(f: FieldDefLite): SQL | null {
  if (NUM_T.has(f.type)) return numExpr(f.id);
  if (TEXT_T.has(f.type)) return sql`lower(NULLIF(${raw(f.id)}, ''))`;
  if (DATE_T.has(f.type)) return tsExpr(f.id);
  if (f.type === "checkbox") return sql`(CASE WHEN ${jv(f.id)} = 'true'::jsonb THEN 1 WHEN ${jv(f.id)} = 'false'::jsonb THEN 0 END)`;
  if (f.type === "singleSelect") { const ch = f.options.choices ?? []; if (!ch.length) return sql`NULL::int`; return sql`(CASE WHEN ${raw(f.id)} IS NULL OR ${raw(f.id)} = '' THEN NULL ${sql.join(ch.map((c, i) => sql`WHEN ${raw(f.id)} = ${c.id} THEN ${i}`), sql` `)} ELSE -1 END)`; }
  if (f.type === "autonumber") return sql`${baseRecords.autonumber}`;
  if (f.type === "createdTime") return sql`${baseRecords.createdAt}`;
  if (f.type === "lastModifiedTime") return sql`${baseRecords.updatedAt}`;
  return null;
}
/**
 * Search on large tables, in Postgres, over fields the caller can see: stored text/number values,
 * select choice names, people's names and linked records' names. (Formula / lookup results and
 * formatted dates are matched only on smaller tables, which search fully in memory.)
 */
async function searchSql(meta: Meta, q: string, role: string, ctx: Ctx): Promise<SQL> {
  const visible = meta.fields.filter((f) => fieldVisible(role, f));
  const like = likeEsc(q);
  const ors: SQL[] = [];
  const plainKeys = visible.filter((f) => TEXT_T.has(f.type) || NUM_T.has(f.type) || DATE_T.has(f.type) || ["attachment", "barcode", "aiText"].includes(f.type)).map((f) => f.id);
  if (plainKeys.length) ors.push(sql`EXISTS (SELECT 1 FROM jsonb_each_text(${baseRecords.data}) e WHERE e.key = ANY(${textArr(plainKeys)}) AND e.value ILIKE ${like})`);
  const n = q.toLowerCase();
  for (const f of visible.filter((x) => x.type === "singleSelect" || x.type === "multipleSelects")) {
    const ids = (f.options.choices ?? []).filter((c) => c.name.toLowerCase().includes(n)).map((c) => c.id);
    if (ids.length) ors.push(f.type === "singleSelect" ? sql`${raw(f.id)} = ANY(${textArr(ids)})` : sql`coalesce(${jv(f.id)}, '[]'::jsonb) ?| ${textArr(ids)}`);
  }
  const userFs = visible.filter((x) => ["user", "createdBy", "lastModifiedBy"].includes(x.type));
  if (userFs.length) {
    const people = (await db.select({ id: users.id }).from(users).innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.orgId, ctx.orgId))).where(sql`${users.name} ILIKE ${like}`).limit(200)).map((u) => u.id);
    if (people.length) for (const f of userFs) ors.push(f.type === "user" ? sql`coalesce(${jv(f.id)}, '[]'::jsonb) ?| ${textArr(people)}` : f.type === "createdBy" ? sql`${baseRecords.createdBy} = ANY(${textArr(people)}::uuid[])` : sql`${baseRecords.updatedBy} = ANY(${textArr(people)}::uuid[])`);
  }
  for (const f of visible.filter((x) => x.type === "link" && x.options.linkedTableId)) {
    const [lt] = await db.select({ pf: baseTables.primaryFieldId }).from(baseTables).where(and(eq(baseTables.id, f.options.linkedTableId!), eq(baseTables.baseId, meta.table.baseId))).limit(1);
    if (!lt?.pf) continue;
    const hits = (await db.select({ id: baseRecords.id }).from(baseRecords).where(and(eq(baseRecords.tableId, f.options.linkedTableId!), isNull(baseRecords.deletedAt), sql`${baseRecords.data}->>${lt.pf} ILIKE ${like}`)).limit(1000)).map((r) => r.id);
    if (hits.length) ors.push(sql`coalesce(${jv(f.id)}, '[]'::jsonb) ?| ${textArr(hits)}`);
  }
  return ors.length ? sql`(${sql.join(ors, sql` OR `)})` : sql`false`;
}

async function sqlPlan(meta: Meta, config: ViewConfig, opts: { search?: string; limit?: number; offset?: number }, role: string, ctx: Ctx): Promise<SqlPlan | null> {
  const total = await countRecords(meta.table.id);
  if (total < FAST_MIN_ROWS()) return null;
  const byId = new Map(meta.fields.map((f) => [f.id, f]));
  const now = new Date();
  const parts: SQL[] = [];
  for (const c of config.filters?.conditions ?? []) {
    const f = byId.get(c.fieldId); if (!f) continue;
    const q = condSql(f, c.op, c.value, now); if (!q) return null;
    parts.push(q);
  }
  let where = parts.length ? (config.filters?.conjunction === "or" ? sql`(${sql.join(parts, sql` OR `)})` : sql`(${sql.join(parts, sql` AND `)})`) : undefined;
  if (opts.search?.trim()) { const sq = await searchSql(meta, opts.search.trim().slice(0, 200), role, ctx); where = where ? sql`(${where} AND ${sq})` : sq; }
  const order: SQL[] = [];
  for (const s of [...(config.groups ?? []), ...(config.sorts ?? [])]) {
    const f = byId.get(s.fieldId); if (!f) continue;
    const e = sortSql(f); if (!e) return null;
    order.push(s.dir === "desc" ? sql`${e} DESC NULLS FIRST` : sql`${e} ASC NULLS LAST`);
  }
  order.push(sql`${baseRecords.sortOrder} ASC`, sql`${baseRecords.autonumber} ASC`);
  const limit = Math.min(Math.max(opts.limit ?? 1000, 0), 5000), offset = Math.max(opts.offset ?? 0, 0);
  const [rows, matched] = await Promise.all([
    db.select({ id: baseRecords.id }).from(baseRecords).where(and(eq(baseRecords.tableId, meta.table.id), isNull(baseRecords.deletedAt), ...(where ? [where] : []))).orderBy(...order).limit(limit).offset(offset),
    where ? countRecords(meta.table.id, where) : Promise.resolve(total),
  ]);
  return { ids: rows.map((r) => r.id), matched, total };
}

/** Client-friendly cell shapes: links carry titles, users carry names. */
function presentForClient(f: FieldDefLite, v: unknown, comp: Computer, names: Map<string, string>): unknown {
  if (v === undefined) return null;
  if (f.type === "link") return ((v as string[]) ?? []).map((id) => ({ id, title: comp.titleSync(f.options.linkedTableId!, id) }));
  if (f.type === "user") return ((v as string[]) ?? []).map((id) => ({ id, name: names.get(id) ?? "Unknown" }));
  if (f.type === "createdBy" || f.type === "lastModifiedBy") return v ? { id: v, name: names.get(String(v)) ?? "Unknown" } : null;
  return v;
}

/** Records of a table for a link picker, with titles, filtered by text. */
export async function searchTitles(ctx: Ctx, tableId: string, q: string, limit = 50) {
  const comp = new Computer(ctx);
  const st = await comp.compute(tableId);
  const term = q.trim().toLowerCase();
  return st.records.map((r) => ({ id: r.id, title: comp.titleSync(tableId, r.id) })).filter((r) => !term || r.title.toLowerCase().includes(term)).slice(0, limit);
}

export async function tableIdsOf(baseId: string) {
  return (await db.select({ id: baseTables.id }).from(baseTables).where(and(eq(baseTables.baseId, baseId), isNull(baseTables.archivedAt)))).map((t) => t.id);
}
export { inArray };

/**
 * Totals and grouped totals for large tables, computed in Postgres (dashboards, KPIs, charts).
 * Returns null whenever the result couldn't match the in-memory engine exactly, so callers fall back.
 */
export async function aggregateLarge(ctx: Ctx, role: string, tableId: string, config: ViewConfig, spec: { agg?: string; fieldId?: string; groupFieldId?: string }): Promise<{ value: number; count: number } | { groups: { key: string | null; value: number; count: number }[] } | null> {
  const meta = await tableMeta(ctx, tableId);
  if (!meta) return null;
  const total = await countRecords(tableId);
  if (total < FAST_MIN_ROWS()) return null;
  const byId = new Map(meta.fields.map((f) => [f.id, f]));
  const agg = spec.agg ?? "count";
  const vf = agg !== "count" && spec.fieldId ? byId.get(spec.fieldId) : undefined;
  if (agg !== "count" && (!vf || !NUM_T.has(vf.type) || !fieldVisible(role, vf))) return null;
  const g = spec.groupFieldId ? byId.get(spec.groupFieldId) : undefined;
  if (spec.groupFieldId && (!g || g.type !== "singleSelect" || !fieldVisible(role, g))) return null;
  const now = new Date(); const parts: SQL[] = [];
  for (const c of config.filters?.conditions ?? []) { const f = byId.get(c.fieldId); if (!f) continue; const q = condSql(f, c.op, c.value, now); if (!q) return null; parts.push(q); }
  const where = and(eq(baseRecords.tableId, tableId), isNull(baseRecords.deletedAt), ...(parts.length ? [config.filters?.conjunction === "or" ? sql`(${sql.join(parts, sql` OR `)})` : sql`(${sql.join(parts, sql` AND `)})`] : []));
  const ne = vf ? numExpr(vf.id) : sql`NULL::numeric`;
  const cols = { n: sql<number>`count(*)::int`, nn: sql<number>`count(${ne})::int`, sum: sql<string | null>`sum(${ne})`, avg: sql<string | null>`avg(${ne})`, min: sql<string | null>`min(${ne})`, max: sql<string | null>`max(${ne})` };
  const pick = (r: { n: number; nn: number; sum: string | null; avg: string | null; min: string | null; max: string | null }) => {
    const v = agg === "count" ? r.n : !r.nn ? 0 : Number(agg === "sum" ? r.sum : agg === "avg" ? r.avg : agg === "min" ? r.min : r.max);
    return Math.round(v * 100) / 100;
  };
  if (!g) { const [r] = await db.select(cols).from(baseRecords).where(where); return { value: pick(r), count: r.n }; }
  const key = sql<string | null>`NULLIF(${raw(g.id)}, '')`;
  const rows = await db.select({ key, ...cols }).from(baseRecords).where(where).groupBy(sql`1`);
  return { groups: rows.map((r) => ({ key: r.key, value: pick(r), count: r.n })) };
}
