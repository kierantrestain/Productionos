/**
 * Query engine: loads table data, computes derived fields (lookup, rollup, count, formula, system),
 * then applies a view's filters, sorts, groups, search and row colours. Computation is memoised per
 * request across tables, with a cycle guard for mutually-dependent relations.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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

  async users() {
    if (!this.userNames) {
      const rows = await db.select({ id: users.id, name: users.name }).from(users).innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.orgId, this.ctx.orgId)));
      this.userNames = new Map(rows.map((r) => [r.id, r.name]));
    }
    return this.userNames;
  }

  async load(tableId: string): Promise<TableState> {
    const hit = this.tables.get(tableId); if (hit) return hit;
    const [table] = await db.select().from(baseTables).where(and(eq(baseTables.id, tableId), eq(baseTables.orgId, this.ctx.orgId))).limit(1);
    if (!table) throw new Error("table missing");
    const fields = (await db.select().from(baseFields).where(and(eq(baseFields.tableId, tableId), isNull(baseFields.archivedAt))).orderBy(asc(baseFields.sortOrder), asc(baseFields.createdAt)))
      .map((f) => ({ id: f.id, name: f.name, type: f.type as FieldType, options: f.options as FieldOptions, description: f.description, permissions: f.permissions }));
    const records = await db.select().from(baseRecords).where(and(eq(baseRecords.tableId, tableId), isNull(baseRecords.deletedAt))).orderBy(asc(baseRecords.sortOrder), asc(baseRecords.autonumber));
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
    case "isBefore": { const d = asDate(v), w = asDate(want); return !!d && !!w && d < w; }
    case "isAfter": { const d = asDate(v), w = asDate(want); return !!d && !!w && d > w; }
    case "isToday": { const d = asDate(v); return !!d && dayStr(d) === dayStr(now); }
    case "isWithinNextDays": { const d = asDate(v); const n = Number(want); return !!d && d >= new Date(dayStr(now)) && d <= new Date(now.getTime() + n * 864e5); }
    case "isWithinPastDays": { const d = asDate(v); const n = Number(want); return !!d && d <= now && d >= new Date(now.getTime() - n * 864e5); }
  }
  return true;
}

function compare(f: FieldDefLite, a: unknown, b: unknown, ta: string, tb: string): number {
  const ea = isEmpty(a) && a !== false, eb = isEmpty(b) && b !== false;
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // empties last
  switch (f.type) {
    case "number": case "currency": case "percent": case "rating": case "duration": case "autonumber": case "count": return Number(a) - Number(b);
    case "checkbox": return (a ? 1 : 0) - (b ? 1 : 0);
    case "date": case "dateTime": case "createdTime": case "lastModifiedTime": return (asDate(a)?.getTime() ?? 0) - (asDate(b)?.getTime() ?? 0);
    case "singleSelect": { const ch = f.options.choices ?? []; return ch.findIndex((c) => c.id === a) - ch.findIndex((c) => c.id === b); }
    case "rollup": case "formula": if (typeof a === "number" && typeof b === "number") return a - b; break;
  }
  return ta.localeCompare(tb, "en-GB", { numeric: true, sensitivity: "base" });
}

export interface ViewRow { id: string; values: Record<string, unknown>; color: string | null; autonumber: number; createdAt: string; updatedAt: string }

/** Compute a table and apply a view. Fields hidden from the caller's role are removed from output. */
export async function runView(ctx: Ctx, role: string, tableId: string, config: ViewConfig, opts: { search?: string; recordIds?: string[] } = {}) {
  const comp = new Computer(ctx);
  const st = await comp.compute(tableId);
  const names = await comp.users();
  const visible = st.fields.filter((f) => fieldVisible(role, f));
  const text = (f: FieldDefLite, v: unknown) => displayValue(f, v, { recordTitle: (t, id) => comp.titleSync(t, id), userName: (id) => names.get(id) ?? "" });
  // Pre-compute linked tables' titles for display.
  for (const f of st.fields.filter((x) => x.type === "link")) await comp.compute(f.options.linkedTableId!);
  let rows = st.records.filter((r) => !opts.recordIds || opts.recordIds.includes(r.id));
  const vals = (r: Rec) => st.values!.get(r.id)!;
  const conds = (config.filters?.conditions ?? []).filter((c) => st.fields.some((f) => f.id === c.fieldId));
  if (conds.length) {
    const now = new Date();
    const test = (r: Rec) => conds.map((c) => { const f = st.fields.find((x) => x.id === c.fieldId)!; const v = vals(r)[f.id]; return matches(f, v, c.op, c.value, text(f, v), now); });
    rows = rows.filter((r) => (config.filters!.conjunction === "or" ? test(r).some(Boolean) : test(r).every(Boolean)));
  }
  if (opts.search?.trim()) {
    const q = opts.search.trim().toLowerCase();
    rows = rows.filter((r) => visible.some((f) => text(f, vals(r)[f.id]).toLowerCase().includes(q)));
  }
  const sortKeys = [...(config.groups ?? []), ...(config.sorts ?? [])].map((s) => ({ ...s, f: st.fields.find((x) => x.id === s.fieldId) })).filter((s) => s.f) as { fieldId: string; dir: "asc" | "desc"; f: FieldDefLite }[];
  if (sortKeys.length) {
    rows = [...rows].sort((a, b) => {
      for (const s of sortKeys) { const va = vals(a)[s.f.id], vb = vals(b)[s.f.id]; const c = compare(s.f, va, vb, text(s.f, va), text(s.f, vb)); if (c) return s.dir === "desc" ? -c : c; }
      return a.sortOrder - b.sortOrder;
    });
  }
  const colorOf = (r: Rec): string | null => {
    const c = config.color;
    if (c?.mode === "select" && c.fieldId) { const f = st.fields.find((x) => x.id === c.fieldId); const v = vals(r)[c.fieldId]; return f?.options.choices?.find((ch) => ch.id === (Array.isArray(v) ? v[0] : v))?.color ?? null; }
    if (c?.mode === "conditions") { for (const rule of c.rules ?? []) { const f = st.fields.find((x) => x.id === rule.fieldId); if (f && matches(f, vals(r)[f.id], rule.op, rule.value, text(f, vals(r)[f.id]), new Date())) return rule.color; } }
    return r.rowColor;
  };
  const out: ViewRow[] = rows.map((r) => {
    const v = vals(r); const shown: Record<string, unknown> = {};
    for (const f of visible) shown[f.id] = presentForClient(f, v[f.id], comp, names);
    return { id: r.id, values: shown, color: colorOf(r), autonumber: r.autonumber, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
  });
  return { table: st.table, fields: visible, rows: out, total: st.records.length };
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
