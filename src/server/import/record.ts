/** Field access over one exported Airtable record (fields keyed by field ID) via the table schema. */
export interface AtField { id: string; name: string; type: string; options?: Record<string, unknown> }
export interface AtTable { id: string; name: string; fields: AtField[] }
export interface AtRecord { id: string; createdTime?: string; fields: Record<string, unknown> }

export const norm = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
export const snake = (s: string) => s.normalize("NFKD").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Computed / system field types: kept in raw lineage, not reported as unmapped. */
export const COMPUTED_TYPES = new Set(["formula", "rollup", "multipleLookupValues", "count", "button", "createdTime", "lastModifiedTime", "autoNumber", "createdBy", "lastModifiedBy", "externalSyncSource", "aiText"]);

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/** Remove temporary signed attachment URLs (they are secrets) from values kept for lineage. */
export function scrubUrls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrubUrls);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) if (k !== "url" && k !== "thumbnails") out[k] = scrubUrls(x);
    return out;
  }
  return v;
}

export class Rec {
  readonly used = new Set<string>();
  private byNorm: Map<string, AtField>;
  constructor(public table: AtTable, public rec: AtRecord, byNorm?: Map<string, AtField>) {
    this.byNorm = byNorm ?? new Map(table.fields.map((f) => [norm(f.name), f]));
  }
  get id() { return this.rec.id; }
  /** First candidate field that exists in the schema and has a non-empty value; marks all matching fields as consumed. */
  raw(cands: string[]): unknown {
    let found: unknown = undefined;
    for (const c of cands) {
      const f = this.byNorm.get(norm(c));
      if (!f) continue;
      this.used.add(f.id);
      const v = this.rec.fields[f.id];
      if (found === undefined && v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) found = v;
    }
    return found;
  }
  s(cands: string[], max = 20000): string | null {
    const v = this.raw(cands);
    const out = toText(v);
    return out == null ? null : out.slice(0, max);
  }
  i(cands: string[]): number | null {
    const v = this.raw(cands);
    if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
    if (typeof v === "string") { const m = v.match(/-?\d+/); return m ? parseInt(m[0], 10) : null; }
    return null;
  }
  /** Money in major units (pounds) → minor units. */
  m(cands: string[]): number | null {
    const v = this.raw(cands);
    if (typeof v === "number") return Math.round(v * 100);
    if (typeof v === "string") { const n = parseFloat(v.replace(/[£$€,\s]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : null; }
    return null;
  }
  d(cands: string[]): string | null {
    const v = this.raw(cands);
    if (typeof v !== "string") return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const dt = new Date(v);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
  }
  /** Time of day as HH:MM (Europe/London for full datetimes). */
  t(cands: string[]): string | null {
    const v = this.raw(cands);
    if (typeof v !== "string") return null;
    const hm = v.match(/^(\d{1,2})[:.](\d{2})/);
    if (hm) return `${hm[1].padStart(2, "0")}:${hm[2]}`;
    const dt = new Date(v);
    if (Number.isNaN(dt.getTime())) return null;
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/London" }).format(dt);
  }
  b(cands: string[]): boolean | null {
    const v = this.raw(cands);
    if (v === undefined) return null;
    if (typeof v === "boolean") return v;
    return ["yes", "true", "y", "checked", "1"].includes(String(v).toLowerCase());
  }
  /** Linked record IDs. */
  links(cands: string[]): string[] {
    const v = this.raw(cands);
    if (!Array.isArray(v)) return typeof v === "string" && v.startsWith("rec") ? [v] : [];
    return v.map((x) => (typeof x === "string" ? x : (x as { id?: string })?.id)).filter((x): x is string => typeof x === "string" && x.startsWith("rec"));
  }
  /** Map a select value onto an allowed option list (with synonyms), else fallback. */
  sel<T extends string>(cands: string[], options: readonly T[], fallback: T, synonyms: Record<string, T> = {}): T {
    const v = this.s(cands);
    if (!v) return fallback;
    const k = snake(v);
    if ((options as readonly string[]).includes(k)) return k as T;
    for (const [syn, target] of Object.entries(synonyms)) if (k === syn || k.includes(syn)) return target;
    return fallback;
  }
}

export function toText(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) { const parts = v.map(toText).filter(Boolean); return parts.length ? parts.join(", ") : null; }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
    if (typeof o.filename === "string") return o.filename;
    if (typeof o.text === "string") return o.text;
    if (typeof o.value === "string") return o.value;
    if (o.state === "error") return null;
  }
  return null;
}
