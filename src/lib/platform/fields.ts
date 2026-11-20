/**
 * Field-type system for the base platform — shared by server (validation, coercion, compute)
 * and client (editors, rendering). Values in records are stored keyed by field id.
 */
export const FIELD_TYPES = [
  "singleLineText", "longText", "number", "currency", "percent", "rating", "checkbox",
  "singleSelect", "multipleSelects", "date", "dateTime", "duration", "email", "url", "phone",
  "link", "lookup", "rollup", "count", "formula", "attachment", "user", "autonumber",
  "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy", "aiText", "barcode", "button",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const COLORS = ["blue", "cyan", "teal", "green", "yellow", "orange", "red", "pink", "purple", "gray"] as const;
export type Color = (typeof COLORS)[number];

export interface SelectChoice { id: string; name: string; color: Color }
export interface FieldOptions {
  choices?: SelectChoice[];               // singleSelect / multipleSelects
  precision?: number;                     // number, currency, percent
  symbol?: string;                        // currency
  max?: number;                           // rating
  icon?: string;                          // rating / checkbox
  includeTime?: boolean;                  // date
  dateFormat?: "iso" | "uk" | "us" | "friendly";
  linkedTableId?: string;                 // link
  inverseFieldId?: string;                // link
  singleRecord?: boolean;                 // link: limit to one record
  linkFieldId?: string;                   // lookup / rollup / count
  targetFieldId?: string;                 // lookup / rollup
  rollupFn?: RollupFn;                    // rollup
  formula?: string;                       // formula (stored with {fld_id} references)
  resultType?: "text" | "number" | "date" | "boolean";
  prompt?: string;                        // aiText: prompt template with {Field} refs
  label?: string; url?: string;           // button
  action?: "open_url" | "update_record" | "run_automation"; values?: Record<string, unknown>; automationId?: string; // button
}
export const ROLLUP_FNS = ["sum", "avg", "min", "max", "count", "countA", "countUnique", "concat", "and", "or", "earliest", "latest"] as const;
export type RollupFn = (typeof ROLLUP_FNS)[number];

export interface FieldDefLite { id: string; name: string; type: FieldType; options: FieldOptions; description?: string | null; permissions?: { edit?: string; hiddenBelow?: string } }

export const COMPUTED: ReadonlySet<FieldType> = new Set(["lookup", "rollup", "count", "formula", "autonumber", "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy", "button"]);
export const isComputed = (t: FieldType) => COMPUTED.has(t);

export const FIELD_META: Record<FieldType, { label: string; icon: string; group: "basic" | "choice" | "date" | "relation" | "computed" | "advanced"; description: string }> = {
  singleLineText: { label: "Single line text", icon: "A", group: "basic", description: "A short piece of text" },
  longText: { label: "Long text", icon: "¶", group: "basic", description: "Multiple lines of text" },
  number: { label: "Number", icon: "#", group: "basic", description: "Integer or decimal" },
  currency: { label: "Currency", icon: "£", group: "basic", description: "Money with a currency symbol" },
  percent: { label: "Percent", icon: "%", group: "basic", description: "A percentage" },
  rating: { label: "Rating", icon: "★", group: "choice", description: "1 to 5 (or 10) stars" },
  checkbox: { label: "Checkbox", icon: "☑", group: "choice", description: "Yes / no" },
  singleSelect: { label: "Single select", icon: "◉", group: "choice", description: "Pick one coloured option" },
  multipleSelects: { label: "Multiple select", icon: "☰", group: "choice", description: "Pick several coloured options" },
  date: { label: "Date", icon: "📅", group: "date", description: "A calendar date, optionally with time" },
  dateTime: { label: "Date & time", icon: "🕒", group: "date", description: "Date with time" },
  duration: { label: "Duration", icon: "⏱", group: "date", description: "Hours and minutes (stored as seconds)" },
  email: { label: "Email", icon: "@", group: "basic", description: "An email address" },
  url: { label: "URL", icon: "🔗", group: "basic", description: "A web link" },
  phone: { label: "Phone number", icon: "☎", group: "basic", description: "A telephone number" },
  link: { label: "Link to another record", icon: "↔", group: "relation", description: "Relate records across tables (two-way)" },
  lookup: { label: "Lookup", icon: "⤴", group: "relation", description: "Show a field from linked records" },
  rollup: { label: "Rollup", icon: "Σ", group: "relation", description: "Summarise a field across linked records" },
  count: { label: "Count", icon: "№", group: "relation", description: "Count linked records" },
  formula: { label: "Formula", icon: "ƒ", group: "computed", description: "Compute a value from other fields" },
  attachment: { label: "Attachment", icon: "📎", group: "advanced", description: "Files and images" },
  user: { label: "User", icon: "👤", group: "advanced", description: "A workspace collaborator" },
  autonumber: { label: "Autonumber", icon: "1", group: "computed", description: "Unique incrementing number" },
  createdTime: { label: "Created time", icon: "⏲", group: "computed", description: "When the record was created" },
  lastModifiedTime: { label: "Last modified time", icon: "⏲", group: "computed", description: "When the record last changed" },
  createdBy: { label: "Created by", icon: "👤", group: "computed", description: "Who created the record" },
  lastModifiedBy: { label: "Last modified by", icon: "👤", group: "computed", description: "Who last changed the record" },
  aiText: { label: "AI text", icon: "✦", group: "advanced", description: "Generated by AI from a prompt using other fields" },
  barcode: { label: "Barcode", icon: "▥", group: "advanced", description: "A scannable code value" },
  button: { label: "Button", icon: "▶", group: "advanced", description: "Opens a URL built from the record" },
};

export const newChoiceId = () => `sel${Math.random().toString(36).slice(2, 10)}`;

/** Coerce raw input into the stored value for a field type. Throws with a readable message. */
export function coerceValue(f: FieldDefLite, v: unknown): unknown {
  if (isComputed(f.type)) throw new Error(`${f.name} is calculated automatically`);
  if (v === undefined || v === null || v === "") return f.type === "checkbox" ? false : null;
  const num = (x: unknown) => { const n = typeof x === "number" ? x : Number(String(x).replace(/[£$€,%\s]/g, "")); if (!Number.isFinite(n)) throw new Error(`${f.name} must be a number`); return n; };
  switch (f.type) {
    case "singleLineText": case "barcode": { const s = String(v).replace(/\r?\n/g, " "); if (s.length > 10_000) throw new Error(`${f.name} is too long`); return s; }
    case "longText": case "aiText": { const s = String(v); if (s.length > 100_000) throw new Error(`${f.name} is too long`); return s; }
    case "number": case "currency": { const n = num(v); const p = f.options.precision ?? (f.type === "currency" ? 2 : 0); return Number(n.toFixed(Math.min(Math.max(p, 0), 8))); }
    case "percent": { const n = num(v); return typeof v === "string" && v.includes("%") ? n / 100 : n; }
    case "rating": { const n = Math.round(num(v)); const max = f.options.max ?? 5; if (n < 0 || n > max) throw new Error(`${f.name} must be 0–${max}`); return n; }
    case "duration": { if (typeof v === "string" && v.includes(":")) { const [h, m, s] = v.split(":").map(Number); return (h || 0) * 3600 + (m || 0) * 60 + (s || 0); } return Math.round(num(v)); }
    case "checkbox": return v === true || v === "true" || v === 1 || v === "1" || v === "yes" || v === "✓";
    case "singleSelect": {
      const s = String(v); const c = f.options.choices?.find((x) => x.id === s || x.name === s);
      if (!c) throw new Error(`“${s}” is not an option for ${f.name}`); return c.id;
    }
    case "multipleSelects": {
      const arr = Array.isArray(v) ? v : String(v).split(",").map((x) => x.trim()).filter(Boolean);
      return [...new Set(arr.map((x) => { const c = f.options.choices?.find((y) => y.id === x || y.name === x); if (!c) throw new Error(`“${x}” is not an option for ${f.name}`); return c.id; }))];
    }
    case "date": { const s = String(v); const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s); if (Number.isNaN(d.getTime())) throw new Error(`${f.name} must be a date`); return f.options.includeTime ? d.toISOString() : d.toISOString().slice(0, 10); }
    case "dateTime": { const d = new Date(String(v)); if (Number.isNaN(d.getTime())) throw new Error(`${f.name} must be a date and time`); return d.toISOString(); }
    case "email": { const s = String(v).trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error(`${f.name} must be an email address`); return s; }
    case "url": { let s = String(v).trim(); if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`; try { new URL(s); } catch { throw new Error(`${f.name} must be a URL`); } return s; }
    case "phone": return String(v).trim().slice(0, 40);
    case "link": {
      const arr = (Array.isArray(v) ? v : [v]).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
      return f.options.singleRecord ? arr.slice(0, 1) : [...new Set(arr)];
    }
    case "attachment": { if (!Array.isArray(v)) throw new Error(`${f.name} must be a list of files`); return v.map((a) => ({ id: String((a as { id: string }).id), filename: String((a as { filename: string }).filename), size: Number((a as { size?: number }).size ?? 0), type: String((a as { type?: string }).type ?? "") })); }
    case "user": return (Array.isArray(v) ? v : [v]).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    default: return v;
  }
}

/** Plain-text rendering used for search, CSV export, sorting fallbacks and chips. */
// Intl formatters are expensive to construct: cache them (hot path for sort/search/filter/export).
const nfCache = new Map<string, Intl.NumberFormat>();
const nf = (min: number, max: number) => { const k = `${min}:${max}`; let f = nfCache.get(k); if (!f) { f = new Intl.NumberFormat("en-GB", { minimumFractionDigits: min, maximumFractionDigits: max }); nfCache.set(k, f); } return f; };
const DF_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DF_DT = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function displayValue(f: FieldDefLite, v: unknown, ctx: { recordTitle?: (tableId: string, id: string) => string; userName?: (id: string) => string } = {}): string {
  if (v === null || v === undefined || v === "") return "";
  switch (f.type) {
    case "checkbox": return v ? "✓" : "";
    case "singleSelect": return f.options.choices?.find((c) => c.id === v)?.name ?? "";
    case "multipleSelects": return (v as string[]).map((id) => f.options.choices?.find((c) => c.id === id)?.name ?? "").filter(Boolean).join(", ");
    case "currency": return `${f.options.symbol ?? "£"}${nf(f.options.precision ?? 2, f.options.precision ?? 2).format(Number(v))}`;
    case "percent": return `${nf(0, f.options.precision ?? 0).format(Number(v) * 100)}%`;
    case "number": return nf(f.options.precision ?? 0, f.options.precision ?? 0).format(Number(v));
    case "rating": return "★".repeat(Number(v));
    case "duration": { const s = Number(v); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`; }
    case "date": return f.options.includeTime ? DF_DT.format(new Date(String(v))) : DF_DAY.format(new Date(`${String(v).slice(0, 10)}T12:00:00Z`));
    case "dateTime": case "createdTime": case "lastModifiedTime": return DF_DT.format(new Date(String(v)));
    case "link": return (v as string[]).map((id) => ctx.recordTitle?.(f.options.linkedTableId!, id) ?? id).join(", ");
    case "user": case "createdBy": case "lastModifiedBy": return (Array.isArray(v) ? v : [v]).map((id) => ctx.userName?.(String(id)) ?? String(id)).join(", ");
    case "attachment": return (v as { filename: string }[]).map((a) => a.filename).join(", ");
    case "lookup": case "rollup": return Array.isArray(v) ? v.map((x) => (x === null || x === undefined ? "" : String(x))).filter(Boolean).join(", ") : String(v);
    default: return Array.isArray(v) ? v.join(", ") : String(v);
  }
}

/** Filter operators available per field type (Airtable semantics). */
export function operatorsFor(t: FieldType): { op: string; label: string; needsValue: boolean }[] {
  const empty = [{ op: "isEmpty", label: "is empty", needsValue: false }, { op: "isNotEmpty", label: "is not empty", needsValue: false }];
  const text = [{ op: "contains", label: "contains", needsValue: true }, { op: "doesNotContain", label: "does not contain", needsValue: true }, { op: "is", label: "is", needsValue: true }, { op: "isNot", label: "is not", needsValue: true }, ...empty];
  const numeric = [{ op: "=", label: "=", needsValue: true }, { op: "!=", label: "≠", needsValue: true }, { op: "<", label: "<", needsValue: true }, { op: "<=", label: "≤", needsValue: true }, { op: ">", label: ">", needsValue: true }, { op: ">=", label: "≥", needsValue: true }, ...empty];
  const dates = [{ op: "is", label: "is", needsValue: true }, { op: "isBefore", label: "is before", needsValue: true }, { op: "isAfter", label: "is after", needsValue: true }, { op: "isToday", label: "is today", needsValue: false }, { op: "isWithinNextDays", label: "is within next … days", needsValue: true }, { op: "isWithinPastDays", label: "is within past … days", needsValue: true }, ...empty];
  switch (t) {
    case "number": case "currency": case "percent": case "rating": case "duration": case "autonumber": case "count": return numeric;
    case "checkbox": return [{ op: "isChecked", label: "is checked", needsValue: false }, { op: "isNotChecked", label: "is not checked", needsValue: false }];
    case "singleSelect": return [{ op: "is", label: "is", needsValue: true }, { op: "isNot", label: "is not", needsValue: true }, { op: "isAnyOf", label: "is any of", needsValue: true }, { op: "isNoneOf", label: "is none of", needsValue: true }, ...empty];
    case "multipleSelects": case "link": case "user": return [{ op: "hasAnyOf", label: "has any of", needsValue: true }, { op: "hasAllOf", label: "has all of", needsValue: true }, { op: "hasNoneOf", label: "has none of", needsValue: true }, { op: "contains", label: "contains text", needsValue: true }, ...empty];
    case "date": case "dateTime": case "createdTime": case "lastModifiedTime": return dates;
    case "formula": case "rollup": case "lookup": return [...text, ...numeric.slice(2, 6)];
    default: return text;
  }
}

export const ROW_HEIGHTS = { short: 32, medium: 56, tall: 88, extra: 128 } as const;
