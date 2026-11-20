/**
 * AI full-system planner: natural language → a complete, reviewable plan (data model + app pages +
 * automations). Nothing is created until a person approves. Revisions send the current plan plus the
 * requested change and get a whole new plan back (shown again for approval). Plans are statically
 * validated (every page/component reference must exist in the planned data model) before apply, and
 * applied through the same createSystem path as templates. AI-proposed automations are created OFF.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { FIELD_TYPES } from "@/lib/platform/fields";
import type { Ctx } from "../auth/context";
import { invalid } from "../errors";
import { aiClient } from "../platform/ai";
import { validateSpec, type BaseSpec, type SpecTable } from "../platform/spec";
import { createSystem, type AppSpec, type NPage } from "./templates";

const MODEL = "claude-opus-5-5";
const FTYPES = FIELD_TYPES.filter((t) => !["lookup", "button", "barcode", "aiText", "attachment", "user", "createdBy", "lastModifiedBy", "autonumber", "createdTime", "lastModifiedTime"].includes(t));
const S = z.string();
const Cond = z.object({ field: S, op: z.enum(["is", "isNot", "isAnyOf", "isNoneOf", "contains", "isEmpty", "isNotEmpty", "isChecked", "isNotChecked", ">", "<", ">=", "<="]), value: S.describe("Choice name for selects; number as text; empty for isEmpty etc.") });
const Comp = z.object({
  type: z.enum(["kpi", "chart", "table", "kanban", "activity", "form", "record", "heading", "text", "button"]),
  width: z.number().int().describe("Columns of 12: 3 for KPI cards, 4–8 for charts/tables, 12 for full width"),
  title: S, table: S.describe("Table name the component reads (empty for heading/text/button/record)"),
  aggregation: z.enum(["count", "sum", "avg", "min", "max"]), field: S.describe("Numeric field for sum/avg/min/max, else empty"),
  groupBy: S.describe("Chart/kanban: field to group by (kanban needs a single select)"), chart: z.enum(["bar", "line", "donut"]),
  format: z.enum(["number", "currency", "percent", "days"]), fields: z.array(S).describe("Columns for table/kanban, inputs for form"),
  filter: z.array(Cond), relatedVia: S.describe("Detail pages: link field in `table` that points at the page's record, else empty"),
  opensPage: S.describe("Key of a detail page rows open, else empty"), text: S.describe("Heading subtitle or text body"),
  buttonAction: z.enum(["none", "navigate", "update_record"]), buttonPage: S, buttonSet: z.array(z.object({ field: S, value: S })),
});
const PlanSchema = z.object({
  name: S, description: S,
  color: z.enum(["blue", "cyan", "teal", "green", "yellow", "orange", "red", "pink", "purple", "gray"]),
  tables: z.array(z.object({
    name: S, description: S,
    fields: z.array(z.object({ name: S, type: z.enum(FTYPES as [string, ...string[]]), choices: z.array(S), linkTo: S, via: S, target: S, fn: S, formula: S })),
    sampleRows: z.array(z.array(z.object({ field: S, value: S }))),
  })),
  pages: z.array(z.object({ key: S, title: S, heading: S, icon: z.enum(["dashboard", "users", "funnel", "briefcase", "file", "folder", "check", "chart", "calendar", "receipt", "package", "list", "home", "message"]), kind: z.enum(["dashboard", "detail"]), table: S.describe("Detail pages: the record table"), components: z.array(Comp) })),
  automations: z.array(z.object({ name: S, table: S, when: z.enum(["record_created", "record_updated"]), watchField: S, filter: z.array(Cond), action: z.enum(["add_comment", "create_record"]), comment: S, createIn: S, linkVia: S, set: z.array(z.object({ field: S, value: S })) })),
  summary: S.describe("Two or three sentences explaining the design choices"),
});
export type Plan = z.infer<typeof PlanSchema>;

const SYSTEM = `You design complete business operating systems on a no-code platform: a relational base (tables, typed fields, links, rollups, formulas) plus an app (pages made of components) plus internal automations.
Data rules: 2–9 tables; the first field of every table is singleLineText; field types: ${FTYPES.join(", ")}; link each relationship once (inverse is automatic, named after the source table); rollup/count via a link field; formulas use {Field name}. Fill unused properties with "" or [].
Sample rows: 3–6 clearly fictional example rows per table (no real people); link values = the target row's first-field text, several separated by " | ".
App rules: a dashboard first (4 KPI cards of width 3, a chart, a kanban or table, recent activity), one list page per main table, and a detail page (kind "detail") for the 2–3 most important tables with a "record" component plus related tables (relatedVia = the link field in that table pointing to the page's table). Table/kanban rows should open the matching detail page (opensPage). Forms only use plain fields. Component field names must exist in the referenced table.
Automations: internal only (comment or create a linked record); they will be created switched off for review. Never invent prices, legal terms or personal data.`;

/** Static check that a plan is internally consistent. Returns problems (empty = OK). */
export function checkPlan(p: Plan): string[] {
  const out: string[] = [];
  const t = new Map(p.tables.map((x) => [x.name.toLowerCase(), x]));
  const inverses = (name: string) => p.tables.flatMap((x) => x.fields.filter((f) => f.type === "link" && f.linkTo.toLowerCase() === name.toLowerCase()).map(() => x.name));
  const hasField = (table: string, f: string) => { const tb = t.get(table.toLowerCase()); return !!tb && (tb.fields.some((x) => x.name.toLowerCase() === f.toLowerCase()) || inverses(tb.name).some((n) => n.toLowerCase() === f.toLowerCase())); };
  const keys = new Set(p.pages.map((x) => x.key));
  for (const pg of p.pages) {
    if (pg.kind === "detail" && !t.has(pg.table.toLowerCase())) out.push(`Page “${pg.title}” needs an existing table.`);
    for (const c of pg.components) {
      const table = c.type === "record" ? pg.table : c.table;
      if (["kpi", "chart", "table", "kanban", "activity", "form"].includes(c.type) && !t.has(table.toLowerCase())) { out.push(`“${c.title}” on “${pg.title}” uses unknown table “${table}”.`); continue; }
      for (const f of [c.field, c.groupBy, c.relatedVia, ...c.fields, ...c.filter.map((x) => x.field)].filter(Boolean)) if (table && !hasField(table, f)) out.push(`“${c.title}” refers to unknown field “${table}.${f}”.`);
      if (c.opensPage && !keys.has(c.opensPage)) out.push(`“${c.title}” opens unknown page “${c.opensPage}”.`);
    }
  }
  for (const a of p.automations) if (!t.has(a.table.toLowerCase())) out.push(`Automation “${a.name}” uses unknown table “${a.table}”.`);
  return out;
}

/** Plan → (BaseSpec, AppSpec) for the shared createSystem path. */
export function planToSpecs(p: Plan): { base: BaseSpec; app: AppSpec } {
  const base: BaseSpec = {
    name: p.name.slice(0, 80), color: p.color, icon: "grid", description: p.description.slice(0, 400),
    tables: p.tables.map((t): SpecTable => {
      const fields = t.fields.map((f) => ({ name: f.name.trim(), type: f.type as SpecTable["fields"][number]["type"],
        ...(f.choices.length ? { choices: f.choices } : {}), ...(f.type === "link" ? { linkTo: f.linkTo } : {}),
        ...(f.type === "rollup" || f.type === "count" ? { via: f.via } : {}), ...(f.type === "rollup" ? { target: f.target, fn: f.fn || "sum" } : {}), ...(f.type === "formula" ? { formula: f.formula } : {}) }));
      const links = new Set(fields.filter((f) => f.type === "link").map((f) => f.name));
      return { name: t.name.trim(), description: t.description, fields, records: t.sampleRows.slice(0, 20).map((row) => Object.fromEntries(row.map(({ field, value }) => [field, links.has(field) ? value.split("|").map((s) => s.trim()).filter(Boolean) : value]))) };
    }),
  };
  validateSpec(base);
  const pages: NPage[] = p.pages.map((pg) => ({
    key: pg.key, title: pg.title, heading: pg.heading || undefined, icon: pg.icon, kind: pg.kind, table: pg.kind === "detail" ? pg.table : undefined,
    components: pg.components.map((c) => ({
      type: c.type, w: Math.min(12, Math.max(1, c.width || 12)),
      props: {
        title: c.title || undefined, subtitle: c.type === "heading" ? c.text : undefined, text: c.type === "text" ? c.text : undefined,
        ...(c.table && c.type !== "record" && c.type !== "button" ? { data: { table: c.table, filter: c.filter.length ? c.filter.map((x) => ({ field: x.field, op: x.op, value: x.value === "" ? undefined : x.value })) : undefined, rel: c.relatedVia || undefined } } : {}),
        agg: c.type === "kpi" || c.type === "chart" ? c.aggregation : undefined, field: c.field || undefined, group: c.groupBy || undefined,
        chart: c.type === "chart" ? c.chart : undefined, format: c.format, fields: c.fields.length ? c.fields : undefined, detail: c.opensPage || undefined,
        allowMove: c.type === "kanban" ? true : undefined, allowEdit: c.type === "record" ? true : undefined, showRelated: c.type === "record" ? true : undefined, showComments: c.type === "record" ? true : undefined,
        label: c.type === "button" ? c.title : undefined,
        action: c.type === "button" && c.buttonAction !== "none" ? { kind: c.buttonAction, page: c.buttonPage || undefined, values: c.buttonSet.length ? Object.fromEntries(c.buttonSet.map((x) => [x.field, x.value])) : undefined } : undefined,
      },
    })),
  }));
  const app: AppSpec = {
    name: p.name.slice(0, 80), description: p.description.slice(0, 200), home: p.pages.find((x) => x.kind === "dashboard")?.key, pages,
    automations: p.automations.map((a, i) => ({ key: `a${i}`, name: a.name, enabled: false, trigger: { type: a.when, table: a.table, watch: a.watchField ? [a.watchField] : undefined, filter: a.filter.length ? a.filter.map((x) => ({ field: x.field, op: x.op, value: x.value })) : undefined },
      actions: [a.action === "create_record" ? { type: "create_record" as const, table: a.createIn, link: a.linkVia || undefined, values: Object.fromEntries(a.set.map((x) => [x.field, x.value])) } : { type: "add_comment" as const, body: a.comment || `${a.name}: {${p.tables.find((t) => t.name === a.table)?.fields[0]?.name ?? "Name"}}` }] })),
  };
  return { base, app };
}

export async function planSystem(description: string, previous?: Plan, change?: string): Promise<{ plan: Plan; problems: string[] }> {
  const text = description.trim();
  if (text.length < 8 || text.length > 4000) throw invalid("Describe the system in 8–4,000 characters.");
  const content = previous && change?.trim()
    ? `Original request: ${text}\n\nCurrent plan (JSON):\n${JSON.stringify(previous)}\n\nRevise the plan with this change, keeping everything else unless it conflicts: ${change.trim().slice(0, 2000)}`
    : `Design a complete system for: ${text}`;
  let plan: Plan | null = null; let problems: string[] = [];
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await aiClient().messages.parse({ model: MODEL, max_tokens: 32000, output_config: { effort: "medium", format: zodOutputFormat(PlanSchema) }, system: SYSTEM, messages });
    if (res.stop_reason === "refusal") throw invalid("The AI declined this request. Try rephrasing it.");
    if (res.stop_reason === "max_tokens") throw invalid("The plan was too large. Ask for fewer tables or pages.");
    plan = res.parsed_output; if (!plan) throw invalid("The AI returned an unreadable plan. Try again.");
    problems = checkPlan(plan);
    try { planToSpecs(plan); } catch (e) { problems.push((e as Error).message); }
    if (!problems.length) break;
    // One automatic repair round, with the concrete problems.
    messages.push({ role: "assistant", content: JSON.stringify(plan) }, { role: "user", content: `Fix these problems and return the whole corrected plan:\n- ${problems.join("\n- ")}` });
  }
  return { plan: plan!, problems };
}

export async function applyPlan(ctx: Ctx, plan: Plan) {
  if (!["owner", "creator"].includes(ctx.platformRole)) throw invalid("Only owners and creators can create systems.");
  const problems = checkPlan(plan);
  if (problems.length) throw invalid(`The plan has problems to fix first: ${problems.slice(0, 3).join(" ")}`);
  const { base, app } = planToSpecs(plan);
  return createSystem(ctx, base, app, { templateKey: "ai-plan" });
}
