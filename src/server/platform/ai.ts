/**
 * AI features (Claude). All calls are server-side; the key comes only from the ANTHROPIC_API_KEY
 * environment variable. When it is absent every feature reports "not configured" — nothing is faked.
 *  1. generateBaseSpec  — natural-language description → validated BaseSpec (tables, fields, links, sample rows)
 *  2. generateAiText    — fill an aiText field for records from its prompt template
 *  3. naturalLanguageFilter — "overdue tasks owned by Sam" → view filter conditions
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { FIELD_TYPES, displayValue, operatorsFor, type FieldDefLite } from "@/lib/platform/fields";
import { invalid } from "../errors";
import type { BaseSpec, SpecTable } from "./spec";
import { validateSpec } from "./spec";

const MODEL = "claude-opus-5-5";
export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let _client: Anthropic | null = null;
function client() {
  if (!aiConfigured()) throw invalid("AI is not configured. An administrator must set ANTHROPIC_API_KEY in the deployment environment.");
  return (_client ??= new Anthropic());
}

function guard(r: { stop_reason: string | null }) {
  if (r.stop_reason === "refusal") throw invalid("The AI declined this request. Try rephrasing it.");
  if (r.stop_reason === "max_tokens") throw invalid("The AI response was too long. Try a smaller request.");
}

// ───────────── 1. Base builder ─────────────
const BUILDER_TYPES = FIELD_TYPES.filter((t) => !["lookup", "button", "barcode", "aiText", "attachment", "user", "createdBy", "lastModifiedBy"].includes(t));
const SpecSchema = z.object({
  name: z.string(),
  icon: z.enum(["grid", "clapperboard", "handshake", "kanban", "calendar", "users", "package", "party", "map", "briefcase", "rocket", "heart", "star", "film", "database", "box", "list", "trending", "bot"]),
  color: z.enum(["blue", "cyan", "teal", "green", "yellow", "orange", "red", "pink", "purple", "gray"]),
  description: z.string(),
  tables: z.array(z.object({
    name: z.string(),
    description: z.string(),
    fields: z.array(z.object({
      name: z.string(),
      type: z.enum(BUILDER_TYPES as [string, ...string[]]),
      choices: z.array(z.string()).describe("Only for singleSelect / multipleSelects"),
      linkTo: z.string().describe("Only for link: exact name of the target table"),
      via: z.string().describe("Only for rollup / count: name of a link field in this table"),
      target: z.string().describe("Only for rollup: field name in the linked table"),
      fn: z.string().describe("Only for rollup: sum|avg|min|max|count|concat|earliest|latest"),
      formula: z.string().describe("Only for formula: expression using {Field name} references, e.g. {Budget} - {Spent}"),
    })),
    sampleRows: z.array(z.array(z.object({ field: z.string(), value: z.string() }))).describe("3–6 realistic EXAMPLE rows. Link values = primary-field text of the target row; separate several with ' | '."),
    views: z.array(z.object({ name: z.string(), type: z.enum(["grid", "kanban", "calendar", "gallery", "timeline", "form"]), field: z.string().describe("kanban: singleSelect field; calendar/timeline: date field; else empty") })),
  })),
});

const BUILDER_SYSTEM = `You design relational databases for a no-code platform (bases → tables → typed fields → records).
Rules:
- 1–8 tables. The FIRST field of every table is its primary field and must be singleLineText (or autonumber).
- Field types: ${BUILDER_TYPES.join(", ")}.
- Model relationships with link fields (declare each relationship ONCE, on one side; the inverse is created automatically).
- Use rollup/count over link fields and formula fields where they add real value (totals, days remaining, status flags).
- Use singleSelect with 3–7 choices for statuses/stages/categories. Leave irrelevant properties as empty strings/arrays.
- Sample rows are clearly fictional examples; never use real people's personal data.
- Add a kanban view for any table with a status-like singleSelect, and a calendar view for tables with a key date.`;

export async function generateBaseSpec(description: string): Promise<BaseSpec> {
  const text = description.trim();
  if (text.length < 8) throw invalid("Describe what you want to build in a sentence or two.");
  if (text.length > 4000) throw invalid("Keep the description under 4,000 characters.");
  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(SpecSchema) },
    system: BUILDER_SYSTEM,
    messages: [{ role: "user", content: `Design a base for: ${text}` }],
  });
  guard(res);
  const out = res.parsed_output;
  if (!out) throw invalid("The AI returned an unreadable design. Please try again.");
  const spec: BaseSpec = {
    name: out.name.slice(0, 80), icon: out.icon, color: out.color, description: out.description.slice(0, 500),
    tables: out.tables.map((t): SpecTable => {
      const fields = t.fields.map((f) => ({
        name: f.name.trim(), type: f.type as SpecTable["fields"][number]["type"],
        ...(f.choices.length ? { choices: f.choices } : {}),
        ...(f.type === "link" ? { linkTo: f.linkTo } : {}),
        ...(f.type === "rollup" || f.type === "count" ? { via: f.via } : {}),
        ...(f.type === "rollup" ? { target: f.target, fn: f.fn || "sum" } : {}),
        ...(f.type === "formula" ? { formula: f.formula } : {}),
      }));
      const linkNames = new Set(fields.filter((f) => f.type === "link").map((f) => f.name));
      return {
        name: t.name.trim(), description: t.description, fields,
        records: t.sampleRows.slice(0, 20).map((row) => Object.fromEntries(row.map(({ field, value }) => [field, linkNames.has(field) ? value.split("|").map((s) => s.trim()).filter(Boolean) : value]))),
        views: t.views.filter((v) => v.type !== "grid" || v.name).map((v) => ({
          name: v.name, type: v.type,
          ...(v.type === "kanban" && v.field ? { kanbanBy: v.field } : {}),
          ...((v.type === "calendar" || v.type === "timeline") && v.field ? { dateField: v.field } : {}),
        })),
      };
    }),
  };
  validateSpec(spec);
  return spec;
}

// ───────────── 2. AI text fields ─────────────
/** Substitute {Field name} references with the record's display values. */
export function renderPrompt(template: string, fields: FieldDefLite[], values: Record<string, unknown>) {
  return template.replace(/\{([^{}]+)\}/g, (m, name: string) => {
    const f = fields.find((x) => x.name.toLowerCase() === name.trim().toLowerCase() || x.id === name);
    if (!f) return m;
    const v = values[f.id];
    if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" && "title" in x ? String((x as { title: string }).title) : x && typeof x === "object" && "name" in x ? String((x as { name: string }).name) : String(x))).join(", ");
    if (v && typeof v === "object" && "name" in v) return String((v as { name: string }).name);
    return displayValue(f, v, {});
  });
}

export async function generateAiText(prompt: string): Promise<string> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: "You fill a single cell in a database. Reply with only the cell's content — no preamble, no markdown headings, no quotation marks. Keep it concise unless asked otherwise.",
    messages: [{ role: "user", content: prompt }],
  });
  guard(res);
  return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim().slice(0, 10000);
}

// ───────────── 3. Natural-language filters ─────────────
const FilterSchema = z.object({
  conjunction: z.enum(["and", "or"]),
  conditions: z.array(z.object({ field: z.string(), op: z.string(), value: z.string().describe("Empty for isEmpty/isNotEmpty; ISO date for dates; choice name for selects; 'true'/'false' for checkbox") })),
});

export async function naturalLanguageFilter(query: string, fields: FieldDefLite[], today = new Date()) {
  if (!query.trim()) throw invalid("Type what you want to see.");
  const catalog = fields.map((f) => `- ${f.name} (${f.type})${f.options.choices?.length ? ` choices: ${f.options.choices.map((c) => c.name).join(", ")}` : ""}; ops: ${operatorsFor(f.type).map((o) => o.op).join(", ")}`).join("\n");
  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(FilterSchema) },
    system: `Convert the user's request into filter conditions over these fields. Use only listed field names and ops. Today is ${today.toISOString().slice(0, 10)}.\n${catalog}`,
    messages: [{ role: "user", content: query.slice(0, 1000) }],
  });
  guard(res);
  const out = res.parsed_output;
  if (!out) throw invalid("Couldn't turn that into a filter.");
  const conditions = out.conditions.flatMap((c) => {
    const f = fields.find((x) => x.name.toLowerCase() === c.field.toLowerCase());
    if (!f || !operatorsFor(f.type).some((o) => o.op === c.op)) return [];
    let value: unknown = c.value;
    if (f.type === "checkbox") value = c.value === "true";
    else if (["number", "currency", "percent", "rating", "duration", "count", "autonumber"].includes(f.type) && c.value !== "") value = Number(c.value);
    else if (f.type === "singleSelect" || f.type === "multipleSelects") {
      const ids = c.value.split(/\s*[,|]\s*/).map((n) => f.options.choices?.find((ch) => ch.name.toLowerCase() === n.toLowerCase())?.id ?? n);
      value = ["isAnyOf", "isNoneOf", "hasAnyOf", "hasAllOf", "hasNoneOf"].includes(c.op) ? ids : ids[0];
    }
    return [{ fieldId: f.id, op: c.op, value }];
  });
  if (!conditions.length) throw invalid("Couldn't match that to any fields in this table.");
  return { conjunction: out.conjunction, conditions };
}
