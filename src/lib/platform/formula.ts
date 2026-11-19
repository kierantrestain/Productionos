/**
 * Airtable-compatible formula language. Pure, sandboxed (no eval): tokenizer → Pratt parser → AST
 * interpreter. Field references are written {Field name} by users and stored as {id} so renames
 * never break formulas.
 */
type Tok = { t: "num" | "str" | "ref" | "id" | "op" | "(" | ")" | ","; v: string };
export type Ast =
  | { k: "num"; v: number } | { k: "str"; v: string } | { k: "bool"; v: boolean }
  | { k: "ref"; id: string } | { k: "call"; fn: string; args: Ast[] }
  | { k: "un"; op: string; a: Ast } | { k: "bin"; op: string; a: Ast; b: Ast };

export class FormulaError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { let j = i; while (j < src.length && /[0-9.eE]/.test(src[j])) j++; out.push({ t: "num", v: src.slice(i, j) }); i = j; continue; }
    if (c === '"' || c === "'") { let j = i + 1, s = ""; while (j < src.length && src[j] !== c) { if (src[j] === "\\" && j + 1 < src.length) { s += src[j + 1]; j += 2; } else s += src[j++]; } if (j >= src.length) throw new FormulaError("Unclosed text quote"); out.push({ t: "str", v: s }); i = j + 1; continue; }
    if (c === "{") { const j = src.indexOf("}", i); if (j < 0) throw new FormulaError("Unclosed {field} reference"); out.push({ t: "ref", v: src.slice(i + 1, j) }); i = j + 1; continue; }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++; out.push({ t: "id", v: src.slice(i, j) }); i = j; continue; }
    const two = src.slice(i, i + 2);
    if (["!=", "<=", ">=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/&=<>!%".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    if (c === "(" || c === ")" || c === ",") { out.push({ t: c, v: c }); i++; continue; }
    throw new FormulaError(`Unexpected character “${c}”`);
  }
  return out;
}

const PREC: Record<string, number> = { "||": 1, "&&": 2, "=": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "&": 5, "+": 6, "-": 6, "*": 7, "/": 7, "%": 7 };

export function parse(src: string): Ast {
  const toks = tokenize(src); let p = 0;
  const peek = () => toks[p]; const next = () => toks[p++];
  const expect = (t: Tok["t"]) => { const k = next(); if (!k || k.t !== t) throw new FormulaError(`Expected ${t === "(" ? "“(”" : t === ")" ? "“)”" : t}`); return k; };
  const primary = (): Ast => {
    const k = next();
    if (!k) throw new FormulaError("Formula ended unexpectedly");
    if (k.t === "num") { const n = Number(k.v); if (!Number.isFinite(n)) throw new FormulaError(`Bad number ${k.v}`); return { k: "num", v: n }; }
    if (k.t === "str") return { k: "str", v: k.v };
    if (k.t === "ref") return { k: "ref", id: k.v };
    if (k.t === "op" && (k.v === "-" || k.v === "!")) return { k: "un", op: k.v, a: expr(8) };
    if (k.t === "(") { const e = expr(0); expect(")"); return e; }
    if (k.t === "id") {
      const name = k.v.toUpperCase();
      if (name === "TRUE" && peek()?.t !== "(") return { k: "bool", v: true };
      if (name === "FALSE" && peek()?.t !== "(") return { k: "bool", v: false };
      expect("(");
      const args: Ast[] = [];
      if (peek()?.t !== ")") { do { args.push(expr(0)); } while (peek()?.t === "," && next()); }
      expect(")");
      if (!FUNCS[name]) throw new FormulaError(`Unknown function ${k.v}()`);
      return { k: "call", fn: name, args };
    }
    throw new FormulaError(`Unexpected “${k.v}”`);
  };
  const expr = (min: number): Ast => {
    let left = primary();
    while (peek()?.t === "op" && PREC[peek()!.v] !== undefined && PREC[peek()!.v] > min) {
      const op = next().v; left = { k: "bin", op, a: left, b: expr(PREC[op]) };
    }
    return left;
  };
  const ast = expr(0);
  if (p < toks.length) throw new FormulaError(`Unexpected “${toks[p].v}”`);
  return ast;
}

export function references(ast: Ast, out = new Set<string>()): Set<string> {
  if (ast.k === "ref") out.add(ast.id);
  else if (ast.k === "call") ast.args.forEach((a) => references(a, out));
  else if (ast.k === "un") references(ast.a, out);
  else if (ast.k === "bin") { references(ast.a, out); references(ast.b, out); }
  return out;
}

/** {Field name} → {fieldId}. Throws when a name doesn't exist. */
export function toStored(formula: string, fields: { id: string; name: string }[]) {
  return formula.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const f = fields.find((x) => x.name === name) ?? fields.find((x) => x.id === name) ?? fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!f) throw new FormulaError(`Unknown field {${name}}`);
    return `{${f.id}}`;
  });
}
export function toDisplay(formula: string, fields: { id: string; name: string }[]) {
  return formula.replace(/\{([^}]+)\}/g, (_m, id: string) => `{${fields.find((x) => x.id === id)?.name ?? "deleted field"}}`);
}

// ───────────── Evaluation ─────────────

type V = unknown;
const isBlank = (v: V) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const toNum = (v: V): number => { if (Array.isArray(v)) return v.reduce((a: number, x) => a + toNum(x), 0); if (typeof v === "boolean") return v ? 1 : 0; if (isBlank(v)) return 0; const n = Number(v); return Number.isFinite(n) ? n : 0; };
const toStr = (v: V): string => (v === null || v === undefined ? "" : Array.isArray(v) ? v.map(toStr).join(", ") : v instanceof Date ? v.toISOString() : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));
const toBool = (v: V): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.length > 0 : !!v);
const toDate = (v: V): Date | null => { if (isBlank(v)) return null; const d = v instanceof Date ? v : new Date(typeof v === "string" && v.length === 10 ? `${v}T00:00:00Z` : String(v)); return Number.isNaN(d.getTime()) ? null : d; };
const UNIT_MS: Record<string, number> = { milliseconds: 1, seconds: 1e3, minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 };
const unit = (u: V) => { const s = toStr(u || "days").toLowerCase().replace(/s?$/, "s"); return s; };
function addMonths(d: Date, n: number) { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; }
function fmtDate(d: Date, f: string) {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  const M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return f.replace(/YYYY|MMMM|MMM|MM|DD|HH|mm|ss|D|M/g, (t) => ({ YYYY: String(d.getUTCFullYear()), MMMM: M[d.getUTCMonth()], MMM: M[d.getUTCMonth()].slice(0, 3), MM: p(d.getUTCMonth() + 1), DD: p(d.getUTCDate()), HH: p(d.getUTCHours()), mm: p(d.getUTCMinutes()), ss: p(d.getUTCSeconds()), D: String(d.getUTCDate()), M: String(d.getUTCMonth() + 1) } as Record<string, string>)[t]);
}
const flat = (args: V[]) => args.flatMap((a) => (Array.isArray(a) ? a : [a]));

const FUNCS: Record<string, (a: V[], now: Date) => V> = {
  IF: (a) => (toBool(a[0]) ? a[1] : a.length > 2 ? a[2] : null),
  SWITCH: (a) => { for (let i = 1; i + 1 < a.length; i += 2) if (toStr(a[0]) === toStr(a[i])) return a[i + 1]; return a.length % 2 === 0 ? a[a.length - 1] : null; },
  AND: (a) => flat(a).every(toBool), OR: (a) => flat(a).some(toBool), NOT: (a) => !toBool(a[0]), XOR: (a) => flat(a).filter(toBool).length % 2 === 1,
  BLANK: () => null, ISBLANK: (a) => isBlank(a[0]), ISERROR: () => false,
  SUM: (a) => flat(a).reduce((s: number, x) => s + toNum(x), 0),
  AVERAGE: (a) => { const xs = flat(a).filter((x) => !isBlank(x)); return xs.length ? xs.reduce((s: number, x) => s + toNum(x), 0) / xs.length : 0; },
  MIN: (a) => { const xs = flat(a).filter((x) => !isBlank(x)).map(toNum); return xs.length ? Math.min(...xs) : 0; },
  MAX: (a) => { const xs = flat(a).filter((x) => !isBlank(x)).map(toNum); return xs.length ? Math.max(...xs) : 0; },
  COUNT: (a) => flat(a).filter((x) => typeof x === "number" || (!isBlank(x) && Number.isFinite(Number(x)))).length,
  COUNTA: (a) => flat(a).filter((x) => !isBlank(x)).length, COUNTALL: (a) => flat(a).length,
  ROUND: (a) => { const f = 10 ** toNum(a[1] ?? 0); return Math.round(toNum(a[0]) * f) / f; },
  ROUNDUP: (a) => { const f = 10 ** toNum(a[1] ?? 0); return Math.ceil(toNum(a[0]) * f) / f; },
  ROUNDDOWN: (a) => { const f = 10 ** toNum(a[1] ?? 0); return Math.floor(toNum(a[0]) * f) / f; },
  INT: (a) => Math.floor(toNum(a[0])), ABS: (a) => Math.abs(toNum(a[0])), SQRT: (a) => Math.sqrt(toNum(a[0])),
  POWER: (a) => toNum(a[0]) ** toNum(a[1]), MOD: (a) => toNum(a[0]) % toNum(a[1]), CEILING: (a) => Math.ceil(toNum(a[0])), FLOOR: (a) => Math.floor(toNum(a[0])),
  VALUE: (a) => toNum(toStr(a[0]).replace(/[^0-9.-]/g, "")),
  CONCATENATE: (a) => a.map(toStr).join(""), ARRAYJOIN: (a) => (Array.isArray(a[0]) ? a[0] : [a[0]]).map(toStr).filter(Boolean).join(a.length > 1 ? toStr(a[1]) : ", "),
  ARRAYUNIQUE: (a) => [...new Set(flat([a[0]]).map(toStr))], ARRAYCOMPACT: (a) => flat([a[0]]).filter((x) => !isBlank(x)),
  UPPER: (a) => toStr(a[0]).toUpperCase(), LOWER: (a) => toStr(a[0]).toLowerCase(), TRIM: (a) => toStr(a[0]).trim(), LEN: (a) => toStr(a[0]).length,
  LEFT: (a) => toStr(a[0]).slice(0, toNum(a[1])), RIGHT: (a) => { const s = toStr(a[0]); const n = toNum(a[1]); return n ? s.slice(-n) : ""; },
  MID: (a) => toStr(a[0]).substr(Math.max(toNum(a[1]) - 1, 0), toNum(a[2])),
  FIND: (a) => toStr(a[1]).indexOf(toStr(a[0])) + 1, SEARCH: (a) => toStr(a[1]).toLowerCase().indexOf(toStr(a[0]).toLowerCase()) + 1,
  SUBSTITUTE: (a) => toStr(a[0]).split(toStr(a[1])).join(toStr(a[2])), REPLACE: (a) => { const s = toStr(a[0]); const st = toNum(a[1]) - 1; return s.slice(0, st) + toStr(a[3]) + s.slice(st + toNum(a[2])); },
  REPT: (a) => toStr(a[0]).repeat(Math.max(0, Math.min(toNum(a[1]), 1000))),
  REGEX_MATCH: (a) => { try { return new RegExp(toStr(a[1])).test(toStr(a[0])); } catch { return false; } },
  T: (a) => (typeof a[0] === "string" ? a[0] : ""), RECORD_ID: () => null,
  TODAY: (_a, now) => now.toISOString().slice(0, 10), NOW: (_a, now) => now.toISOString(),
  YEAR: (a) => toDate(a[0])?.getUTCFullYear() ?? null, MONTH: (a) => { const d = toDate(a[0]); return d ? d.getUTCMonth() + 1 : null; },
  DAY: (a) => toDate(a[0])?.getUTCDate() ?? null, WEEKDAY: (a) => toDate(a[0])?.getUTCDay() ?? null,
  HOUR: (a) => toDate(a[0])?.getUTCHours() ?? null, MINUTE: (a) => toDate(a[0])?.getUTCMinutes() ?? null,
  DATEADD: (a) => { const d = toDate(a[0]); if (!d) return null; const u = unit(a[2]); const n = toNum(a[1]); if (u === "months") return addMonths(d, n).toISOString(); if (u === "years") return addMonths(d, n * 12).toISOString(); return new Date(d.getTime() + n * (UNIT_MS[u] ?? 864e5)).toISOString(); },
  DATETIME_DIFF: (a) => { const x = toDate(a[0]), y = toDate(a[1]); if (!x || !y) return null; const u = unit(a[2]); if (u === "months") return (x.getUTCFullYear() - y.getUTCFullYear()) * 12 + x.getUTCMonth() - y.getUTCMonth(); if (u === "years") return x.getUTCFullYear() - y.getUTCFullYear(); return Math.trunc((x.getTime() - y.getTime()) / (UNIT_MS[u] ?? 864e5)); },
  DATETIME_FORMAT: (a) => { const d = toDate(a[0]); return d ? fmtDate(d, a.length > 1 ? toStr(a[1]) : "YYYY-MM-DD") : null; },
  DATESTR: (a) => toDate(a[0])?.toISOString().slice(0, 10) ?? null,
  IS_BEFORE: (a) => { const x = toDate(a[0]), y = toDate(a[1]); return !!x && !!y && x < y; }, IS_AFTER: (a) => { const x = toDate(a[0]), y = toDate(a[1]); return !!x && !!y && x > y; },
  IS_SAME: (a) => { const x = toDate(a[0]), y = toDate(a[1]); return !!x && !!y && x.toISOString().slice(0, 10) === y.toISOString().slice(0, 10); },
  WORKDAY_DIFF: (a) => { const x = toDate(a[0]), y = toDate(a[1]); if (!x || !y) return null; let n = 0; const s = x < y ? x : y, e = x < y ? y : x; for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() % 6 !== 0) n++; return x <= y ? n : -n; },
};
export const FUNCTION_NAMES = Object.keys(FUNCS).sort();

/** Evaluate an AST against a value resolver. Never throws for runtime data problems; returns #ERROR text. */
export function evaluate(ast: Ast, resolve: (fieldId: string) => V, now = new Date()): V {
  const ev = (n: Ast): V => {
    switch (n.k) {
      case "num": return n.v; case "str": return n.v; case "bool": return n.v;
      case "ref": return resolve(n.id);
      case "un": return n.op === "-" ? -toNum(ev(n.a)) : !toBool(ev(n.a));
      case "call": {
        if (n.fn === "IF") return toBool(ev(n.args[0])) ? (n.args[1] ? ev(n.args[1]) : null) : n.args[2] ? ev(n.args[2]) : null; // lazy
        return FUNCS[n.fn](n.args.map(ev), now);
      }
      case "bin": {
        const a = ev(n.a), b = ev(n.b);
        switch (n.op) {
          case "+": { const da = toDate(a); if (typeof a === "string" && /^\d{4}-\d{2}-\d{2}/.test(a) && da && typeof b === "number") return new Date(da.getTime() + b * 864e5).toISOString().slice(0, 10); return toNum(a) + toNum(b); }
          case "-": return toNum(a) - toNum(b); case "*": return toNum(a) * toNum(b);
          case "/": return toNum(b) === 0 ? null : toNum(a) / toNum(b); case "%": return toNum(a) % toNum(b);
          case "&": return toStr(a) + toStr(b);
          case "=": return typeof a === "number" || typeof b === "number" ? toNum(a) === toNum(b) : toStr(a) === toStr(b);
          case "!=": return typeof a === "number" || typeof b === "number" ? toNum(a) !== toNum(b) : toStr(a) !== toStr(b);
          case "<": return toNum(a) < toNum(b); case "<=": return toNum(a) <= toNum(b); case ">": return toNum(a) > toNum(b); case ">=": return toNum(a) >= toNum(b);
          case "&&": return toBool(a) && toBool(b); case "||": return toBool(a) || toBool(b);
        }
      }
    }
    return null;
  };
  const r = ev(ast);
  return typeof r === "number" && !Number.isFinite(r) ? null : r;
}
