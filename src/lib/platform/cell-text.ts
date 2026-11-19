import { displayValue, type FieldDefLite } from "./fields";

type Ref = { id: string; title?: string; name?: string };
/** Plain text for a client-shaped value (links/users arrive as objects). Used by copy, search, export, summaries. */
export function cellText(f: FieldDefLite, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (f.type === "link") return (v as Ref[]).map((x) => x.title ?? "").join(", ");
  if (f.type === "user") return (v as Ref[]).map((x) => x.name ?? "").join(", ");
  if (f.type === "createdBy" || f.type === "lastModifiedBy") return (v as Ref)?.name ?? "";
  if (f.type === "formula" || f.type === "rollup" || f.type === "lookup") {
    if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? (x as Ref).title ?? (x as Ref).name ?? "" : String(x ?? ""))).filter(Boolean).join(", ");
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toLocaleString("en-GB", { maximumFractionDigits: 4 });
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v);
  }
  return displayValue(f, v);
}

