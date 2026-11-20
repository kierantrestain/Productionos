/**
 * Airtable field type → Bang On OS field plan, and cell value conversion.
 * Principle: never lossy without saying so. Anything we can't represent natively becomes a text
 * "snapshot" field holding the exported value, with a warning in the reconciliation report.
 */
import { COLORS, type FieldOptions, type FieldType } from "@/lib/platform/fields";
import { parse } from "@/lib/platform/formula";
import type { AtField } from "./reader";

export type PlanKind = "plain" | "link" | "computed" | "fallback";
export interface FieldPlan {
  kind: PlanKind; type: FieldType; options: FieldOptions;
  /** For computed fields: source field ids this depends on (must exist first). */
  deps: string[];
  warning?: string; category?: string;
}

const COLOR_OF = (c?: string) => (COLORS.find((x) => (c ?? "").toLowerCase().startsWith(x)) ?? "gray") as (typeof COLORS)[number];

/** Airtable formula → our syntax with {sourceFieldId} refs kept (replaced by target ids at create time). */
export function translateFormula(src: string, tableFields: AtField[]): { expr: string; refs: string[] } | { error: string } {
  const refs = new Set<string>();
  let bad = "";
  const expr = src.replace(/\{([^}]+)\}/g, (m, inner: string) => {
    const f = tableFields.find((x) => x.id === inner) ?? tableFields.find((x) => x.name === inner) ?? tableFields.find((x) => x.name.toLowerCase() === inner.toLowerCase());
    if (!f) { bad = `references unknown field {${inner}}`; return m; }
    refs.add(f.id);
    return `{${f.id}}`;
  });
  if (bad) return { error: bad };
  try { parse(expr); } catch (e) { return { error: `not supported by our formula engine: ${(e as Error).message}` }; }
  return { expr, refs: [...refs] };
}

export function planField(f: AtField, tableFields: AtField[]): FieldPlan {
  const c = f.config ?? {};
  const plain = (type: FieldType, options: FieldOptions = {}, warning?: string, category?: string): FieldPlan => ({ kind: "plain", type, options, deps: [], warning, category });
  const fallback = (why: string, category = "fallback"): FieldPlan => ({ kind: "fallback", type: "longText", options: {}, deps: [], warning: `${why} — imported as a read-only text snapshot of the exported values`, category });
  switch (f.type) {
    case "singleLineText": return plain("singleLineText");
    case "multilineText": return plain("longText");
    case "richText": return plain("longText", {}, "rich text kept as Markdown source in a long-text field", "richText→longText");
    case "email": return plain("email");
    case "url": return plain("url");
    case "phoneNumber": return plain("phone");
    case "number": return plain("number", { precision: c.precision ?? 0 });
    case "currency": return plain("currency", { precision: c.precision ?? 2, symbol: c.symbol ?? "£" });
    case "percent": return plain("percent", { precision: c.precision ?? 0 });
    case "rating": return plain("rating", { max: c.max ?? 5 });
    case "checkbox": return plain("checkbox");
    case "date": return plain("date");
    case "dateTime": return plain("dateTime");
    case "duration": return plain("duration", {}, c.durationFormat && c.durationFormat !== "h:mm" ? `duration format ${c.durationFormat} shown as h:mm` : undefined, c.durationFormat && c.durationFormat !== "h:mm" ? "durationFormat" : undefined);
    case "singleSelect": case "multipleSelects":
      return plain(f.type, { choices: (c.choices ?? []).map((ch) => ({ id: ch.id, name: ch.name, color: COLOR_OF(ch.color) })) });
    case "multipleAttachments": return plain("attachment", {}, "file bytes are not in the export — attachment entries kept as metadata, marked pending transfer", "attachments pending transfer");
    case "aiText": return plain("aiText", {}, "AI prompt configuration is not exported — generated values kept as text; set a prompt to regenerate", "aiText prompt missing");
    case "autoNumber": return plain("number", { precision: 0 }, "original auto-numbers kept as a number field (new records get no value)", "autoNumber→number");
    case "button": return plain("button", {}, "button action configuration is not exported — set its URL manually", "button config missing");
    case "createdTime": return { kind: "computed", type: "createdTime", options: {}, deps: [] };
    case "lastModifiedTime": return plain("dateTime", {}, "last-modified time kept as a static snapshot", "lastModifiedTime→snapshot");
    case "createdBy": case "lastModifiedBy": case "singleCollaborator": case "multipleCollaborators":
      return plain("singleLineText", {}, "collaborators aren't workspace members here — kept as name/email text", "collaborator→text");
    case "multipleRecordLinks":
      if (!c.linkedTableId) return fallback("link without a linked table");
      return { kind: "link", type: "link", options: { singleRecord: !!c.prefersSingleRecordLink }, deps: [] };
    case "multipleLookupValues":
      if (!c.recordLinkFieldId || !c.fieldIdInLinkedTable || c.isValid === false) return fallback("lookup is invalid in the source");
      return { kind: "computed", type: "lookup", options: {}, deps: [c.recordLinkFieldId, c.fieldIdInLinkedTable] };
    case "rollup":
      if (!c.recordLinkFieldId || !c.fieldIdInLinkedTable || c.isValid === false) return fallback("rollup is invalid in the source");
      // The export doesn't include the rollup's aggregation formula; recreate faithfully as a lookup of the same values.
      return { kind: "computed", type: "lookup", options: {}, deps: [c.recordLinkFieldId, c.fieldIdInLinkedTable], warning: "rollup aggregation function is not in the export — recreated as a lookup of the same linked values; choose the aggregation manually", category: "rollup→lookup" };
    case "count":
      if (!c.recordLinkFieldId) return fallback("count without a link field");
      return { kind: "computed", type: "count", options: {}, deps: [c.recordLinkFieldId], ...(c.filters ? { warning: "count filter conditions not supported — counts all linked records", category: "count filter dropped" } : {}) };
    case "formula": {
      if (c.isValid === false || !c.formula) return fallback("formula is invalid in the source", "formula fallback");
      const t = translateFormula(c.formula, tableFields);
      if ("error" in t) return fallback(`formula ${t.error}`, "formula fallback");
      return { kind: "computed", type: "formula", options: { formula: t.expr }, deps: t.refs };
    }
    default: return fallback(`unsupported field type ${f.type}`, "unsupported type");
  }
}

const special = (v: unknown) => (v && typeof v === "object" && "specialValue" in (v as object) ? String((v as { specialValue: unknown }).specialValue) : null);
/** Plain-text rendering of any exported cell value (used for snapshots and comparisons). */
export function cellToText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(cellToText).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (special(v)) return special(v)!;
    if ("value" in o && "state" in o) return cellToText(o.value);
    if ("valuesByLinkedRecordId" in o) return Object.values(o.valuesByLinkedRecordId as Record<string, unknown>).map(cellToText).filter(Boolean).join(", ");
    if ("filename" in o) return String(o.filename);
    if ("email" in o || "name" in o) return [o.name, o.email ? `<${o.email}>` : ""].filter(Boolean).join(" ");
    return JSON.stringify(o);
  }
  return String(v);
}

/** Convert an exported cell to our stored value for a plain/fallback field. Links are handled separately. */
export function convertCell(f: AtField, plan: FieldPlan, v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (plan.kind === "fallback") { const s = cellToText(v); return s === "" ? undefined : s; }
  switch (f.type) {
    case "singleSelect": return (v as { id?: string }).id ?? undefined;
    case "multipleSelects": return (v as { id: string }[]).map((x) => x.id);
    case "multipleAttachments": return (v as { id: string; filename: string; size?: number; type?: string }[]).map((a) => ({ id: `airtable:${a.id}`, filename: a.filename, size: a.size ?? 0, type: a.type ?? "", pendingTransfer: true }));
    case "aiText": { const s = cellToText(v); return s === "" ? undefined : s; }
    case "createdBy": case "lastModifiedBy": case "singleCollaborator": case "multipleCollaborators": { const s = cellToText(v); return s || undefined; }
    case "number": case "currency": case "percent": case "rating": case "duration": case "autoNumber": return typeof v === "number" ? v : Number.isFinite(Number(v)) ? Number(v) : undefined;
    case "checkbox": return !!v;
    case "date": return String(v).slice(0, 10);
    case "dateTime": case "lastModifiedTime": return new Date(String(v)).toISOString();
    default: return typeof v === "string" ? v : cellToText(v);
  }
}

/** Normalised comparison text for fidelity checks between exported and recomputed values. */
export function comparable(v: unknown): string {
  if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = cellToText(v).trim();
  const n = Number(s);
  return s !== "" && Number.isFinite(n) && /^-?[\d.]+(e-?\d+)?$/i.test(s) ? String(Math.round(n * 1e6) / 1e6) : s;
}
