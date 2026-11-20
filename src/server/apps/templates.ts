/**
 * App templates. Each template = a base spec + an app spec written with table/field NAMES. The same
 * generic resolver turns names into ids and the same renderer runs every app — Agency CRM, Production OS
 * and Client Portal are configurations, not separate hard-coded applications.
 * All template data is fictional demo data and is labelled as such.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { baseFields, baseTables } from "@/db/schema";
import { newId, slugify, validateAppConfig, type AppConfig, type Component, type Page, type Role } from "@/lib/apps/types";
import type { Ctx } from "../auth/context";
import { invalid } from "../errors";
import { saveAutomation, type Action, type Trigger } from "../platform/automations";
import { createBaseFromSpec, type BaseSpec } from "../platform/spec";
import { templateSpec } from "../platform/templates";
import { createApp, publishApp } from "./apps";

// ───────── Name-based spec ─────────
type NCond = { field: string; op: string; value?: unknown };
type NData = { table: string; view?: string; filter?: NCond[]; rel?: string; scope?: string; sort?: string; dir?: "asc" | "desc" };
type NComp = { type: Component["type"]; w: number; visibleTo?: Role[]; props?: Omit<Component["props"], "data" | "fieldId" | "groupFieldId" | "fieldIds" | "detailPageId" | "titleFieldId" | "subtitleFieldId" | "action" | "required"> & {
  data?: NData; field?: string; group?: string; fields?: string[]; detail?: string; title_field?: string; subtitle_field?: string; date_field?: string; image_field?: string; required?: string[];
  action?: { kind: "navigate" | "create_record" | "update_record" | "run_automation" | "open_url"; page?: string; table?: string; values?: Record<string, unknown>; automation?: string; url?: string; confirm?: string };
} };
export type NPage = { key: string; title: string; heading?: string; subtitle?: string; icon?: string; kind?: Page["kind"]; table?: string; scope?: string; hidden?: boolean; parent?: string; visibleTo?: Role[]; components: NComp[] };
export type NAutomation = { key: string; name: string; enabled?: boolean; trigger: { type: Trigger["type"]; table: string; watch?: string[]; filter?: NCond[] }; actions: { type: "update_record" | "create_record" | "add_comment"; table?: string; link?: string; values?: Record<string, unknown>; body?: string }[] };
export type AppSpec = { name: string; description?: string; audience?: "workspace" | "portal"; portal?: { table: string; email: string }; home?: string; pages: NPage[]; automations?: NAutomation[] };

/** Resolve a name-based app spec against a base. Unknown names fail loudly (no silent half-apps). */
export async function resolveAppSpec(baseId: string, spec: AppSpec, automationIds: Record<string, string> = {}): Promise<AppConfig> {
  const tables = await db.select().from(baseTables).where(and(eq(baseTables.baseId, baseId), isNull(baseTables.archivedAt)));
  const fields = tables.length ? await db.select().from(baseFields).where(isNull(baseFields.archivedAt)) : [];
  const T = (n: string) => { const t = tables.find((x) => x.name.toLowerCase() === n.toLowerCase()); if (!t) throw invalid(`App spec refers to unknown table “${n}”.`); return t; };
  const F = (table: string, n: string) => { const t = T(table); const f = fields.find((x) => x.tableId === t.id && x.name.toLowerCase() === n.toLowerCase()); if (!f) throw invalid(`App spec refers to unknown field “${table}.${n}”.`); return f; };
  const val = (table: string, field: string, v: unknown) => {
    const f = F(table, field);
    if ((f.type === "singleSelect" || f.type === "multipleSelects") && v !== undefined) {
      const map = (x: unknown) => f.options?.choices?.find((c) => c.name === x)?.id ?? x;
      return Array.isArray(v) ? v.map(map) : map(v);
    }
    return v;
  };
  const cond = (table: string, c: NCond) => ({ fieldId: F(table, c.field).id, op: c.op, value: val(table, c.field, c.value) });
  const pageIds = Object.fromEntries(spec.pages.map((p) => [p.key, `p_${p.key}`]));
  const pages: Page[] = spec.pages.map((p) => ({
    id: pageIds[p.key], title: p.title, heading: p.heading, subtitle: p.subtitle, slug: slugify(p.key), icon: p.icon, kind: p.kind ?? "dashboard",
    tableId: p.table ? T(p.table).id : undefined, scopeLinkFieldId: p.scope && p.table ? F(p.table, p.scope).id : undefined,
    hidden: p.hidden ?? p.kind === "detail", parentId: p.parent ? pageIds[p.parent] : undefined, visibleTo: p.visibleTo,
    components: p.components.map((c): Component => {
      const pr = c.props ?? {};
      const tbl = pr.data?.table ?? (c.type === "record" ? p.table : undefined);
      const { data, field, group, fields: fl, detail, title_field, subtitle_field, date_field, image_field, action, required, ...rest } = pr;
      return {
        id: newId(), type: c.type, w: c.w, visibleTo: c.visibleTo,
        props: {
          ...rest,
          data: data ? { tableId: T(data.table).id, viewId: undefined, filter: data.filter ? { conjunction: "and", conditions: data.filter.map((x) => cond(data.table, x)) } : undefined, relationFieldId: data.rel ? F(data.table, data.rel).id : undefined, scopeLinkFieldId: data.scope ? F(data.table, data.scope).id : undefined, sortFieldId: data.sort ? F(data.table, data.sort).id : undefined, sortDir: data.dir } : undefined,
          fieldId: field && tbl ? F(tbl, field).id : undefined,
          groupFieldId: group && tbl ? F(tbl, group).id : undefined,
          fieldIds: fl && tbl ? fl.map((n) => F(tbl, n).id) : undefined,
          required: required && tbl ? required.map((n) => F(tbl, n).id) : undefined,
          detailPageId: detail ? pageIds[detail] : undefined,
          titleFieldId: title_field && tbl ? F(tbl, title_field).id : undefined,
          subtitleFieldId: subtitle_field && tbl ? F(tbl, subtitle_field).id : undefined,
          dateFieldId: date_field && tbl ? F(tbl, date_field).id : undefined,
          imageFieldId: image_field && tbl ? F(tbl, image_field).id : undefined,
          action: action ? {
            kind: action.kind, pageId: action.page ? pageIds[action.page] : undefined, url: action.url, confirm: action.confirm,
            tableId: action.table ? T(action.table).id : undefined, automationId: action.automation ? automationIds[action.automation] : undefined,
            values: action.values ? Object.fromEntries(Object.entries(action.values).map(([k, v]) => { const t = action.table ?? p.table!; return [F(t, k).id, v]; })) : undefined,
          } : undefined,
        },
      };
    }),
  }));
  return validateAppConfig({ pages, homePageId: spec.home ? pageIds[spec.home] : pages[0]?.id, portal: spec.portal ? { tableId: T(spec.portal.table).id, emailFieldId: F(spec.portal.table, spec.portal.email).id } : undefined });
}

async function createAutomations(ctx: Ctx, baseId: string, list: NAutomation[] = []) {
  const ids: Record<string, string> = {};
  const tables = await db.select().from(baseTables).where(eq(baseTables.baseId, baseId));
  const fields = await db.select().from(baseFields).where(isNull(baseFields.archivedAt));
  const T = (n: string) => tables.find((t) => t.name === n)!.id;
  const F = (t: string, n: string) => fields.find((f) => f.tableId === T(t) && f.name === n)!;
  for (const a of list) {
    const choice = (t: string, n: string, v: unknown) => F(t, n).options?.choices?.find((c) => c.name === v)?.id ?? v;
    const trigger: Trigger = { type: a.trigger.type, tableId: T(a.trigger.table), watchFieldIds: a.trigger.watch?.map((w) => F(a.trigger.table, w).id), conditions: a.trigger.filter ? { conjunction: "and", conditions: a.trigger.filter.map((c) => ({ fieldId: F(a.trigger.table, c.field).id, op: c.op, value: choice(a.trigger.table, c.field, c.value) })) } : undefined };
    const actions: Action[] = a.actions.map((x) => x.type === "add_comment" ? { type: "add_comment", body: x.body! }
      : x.type === "create_record" ? { type: "create_record", tableId: T(x.table!), linkFieldId: x.link ? F(x.table!, x.link).id : undefined, values: Object.fromEntries(Object.entries(x.values ?? {}).map(([k, v]) => [F(x.table!, k).id, v])) }
      : { type: "update_record", values: Object.fromEntries(Object.entries(x.values ?? {}).map(([k, v]) => [F(a.trigger.table, k).id, v])) });
    const row = await saveAutomation(ctx, baseId, { name: a.name, trigger, actions, isEnabled: !!a.enabled });
    ids[a.key] = row.id;
  }
  return ids;
}

// ───────── Templates ─────────
const AGENCY_BASE: BaseSpec = {
  name: "Agency CRM", icon: "handshake", color: "blue", description: "Demo data — fictional clients and deals.", tables: [
    { name: "Clients", fields: [
      { name: "Client", type: "singleLineText" }, { name: "Industry", type: "singleSelect", choices: ["Media", "Retail", "Events", "Technology", "Hospitality"] },
      { name: "Email", type: "email" }, { name: "Status", type: "singleSelect", choices: [{ name: "Active", color: "green" }, { name: "Prospect", color: "blue" }, { name: "Former", color: "gray" }] },
      { name: "Pipeline", type: "rollup", via: "Deals", target: "Value", fn: "sum" }, { name: "Notes", type: "longText" },
    ], records: [
      { Client: "Riverside Media", Industry: "Media", Email: "hello@riverside.example", Status: "Prospect" }, { Client: "Vertex", Industry: "Technology", Email: "team@vertex.example", Status: "Prospect" },
      { Client: "Horizon", Industry: "Retail", Email: "brand@horizon.example", Status: "Prospect" }, { Client: "Maple Films", Industry: "Media", Email: "studio@maple.example", Status: "Active" },
      { Client: "Northside", Industry: "Retail", Email: "ops@northside.example", Status: "Prospect" }, { Client: "Peak Apparel", Industry: "Retail", Email: "info@peak.example", Status: "Prospect" },
      { Client: "Summit Events", Industry: "Events", Email: "events@summit.example", Status: "Prospect" }, { Client: "Oceanic Content", Industry: "Media", Email: "hi@oceanic.example", Status: "Active" },
    ] },
    { name: "Contacts", fields: [{ name: "Name", type: "singleLineText" }, { name: "Email", type: "email" }, { name: "Phone", type: "phone" }, { name: "Role", type: "singleLineText" }, { name: "Client", type: "link", linkTo: "Clients", inverseName: "Contacts", singleRecord: true }],
      records: [{ Name: "Liban A.", Email: "liban@maple.example", Role: "Producer", Client: "Maple Films" }, { Name: "Theo T.", Email: "theo@vertex.example", Role: "Marketing lead", Client: "Vertex" }, { Name: "Kieran T.", Email: "kieran@horizon.example", Role: "Founder", Client: "Horizon" }] },
    { name: "Deals", fields: [
      { name: "Deal", type: "singleLineText" }, { name: "Summary", type: "singleLineText" }, { name: "Client", type: "link", linkTo: "Clients", inverseName: "Deals", singleRecord: true },
      { name: "Value", type: "currency", options: { precision: 0 } },
      { name: "Stage", type: "singleSelect", choices: [{ name: "Qualified", color: "gray" }, { name: "Proposal", color: "blue" }, { name: "Negotiation", color: "orange" }, { name: "Won", color: "green" }, { name: "Lost", color: "red" }] },
      { name: "Source", type: "singleSelect", choices: ["Direct", "Referral", "Partner", "Inbound"] }, { name: "Owner", type: "singleLineText" },
      { name: "Due date", type: "date" }, { name: "Cycle days", type: "number" },
    ], records: [
      { Deal: "Riverside Campaign", Summary: "Brand campaign and content series", Client: "Riverside Media", Value: 12000, Stage: "Qualified", Source: "Inbound", Owner: "Liban A.", "Due date": "2026-11-28", "Cycle days": 18 },
      { Deal: "Vertex Brand Refresh", Summary: "Full rebrand, assets and launch", Client: "Vertex", Value: 28000, Stage: "Proposal", Source: "Referral", Owner: "Theo T.", "Due date": "2026-11-30", "Cycle days": 26 },
      { Deal: "Horizon Rebrand", Summary: "Identity, content and rollout", Client: "Horizon", Value: 22000, Stage: "Negotiation", Source: "Direct", Owner: "Kieran T.", "Due date": "2026-12-06", "Cycle days": 34 },
      { Deal: "Maple Films", Summary: "3x show production and delivery", Client: "Maple Films", Value: 36000, Stage: "Won", Source: "Partner", Owner: "Liban A.", "Due date": "2026-11-12", "Cycle days": 41 },
      { Deal: "Northside Launch", Summary: "Product launch and media campaign", Client: "Northside", Value: 18000, Stage: "Proposal", Source: "Inbound", Owner: "Theo T.", "Due date": "2026-12-04", "Cycle days": 22 },
      { Deal: "Peak Apparel", Summary: "Seasonal lookbook shoot", Client: "Peak Apparel", Value: 8000, Stage: "Qualified", Source: "Direct", Owner: "Kieran T.", "Due date": "2026-12-12", "Cycle days": 12 },
      { Deal: "Summit Event", Summary: "Conference film and highlights", Client: "Summit Events", Value: 11000, Stage: "Negotiation", Source: "Referral", Owner: "Liban A.", "Due date": "2026-12-09", "Cycle days": 30 },
      { Deal: "Oceanic Content", Summary: "Always-on social content", Client: "Oceanic Content", Value: 18000, Stage: "Won", Source: "Partner", Owner: "Theo T.", "Due date": "2026-11-05", "Cycle days": 45 },
    ], views: [{ name: "Pipeline", type: "kanban", kanbanBy: "Stage" }] },
    { name: "Projects", fields: [
      { name: "Project", type: "singleLineText" }, { name: "Client", type: "link", linkTo: "Clients", inverseName: "Projects", singleRecord: true },
      { name: "Status", type: "singleSelect", choices: [{ name: "Planning", color: "gray" }, { name: "Active", color: "blue" }, { name: "Review", color: "orange" }, { name: "Done", color: "green" }] },
      { name: "Due date", type: "date" }, { name: "Budget", type: "currency", options: { precision: 0 } }, { name: "Progress", type: "percent" },
    ], records: [{ Project: "Maple Films — Season 1", Client: "Maple Films", Status: "Active", "Due date": "2027-02-28", Budget: 36000, Progress: 0.35 }, { Project: "Oceanic Q1 content", Client: "Oceanic Content", Status: "Planning", "Due date": "2027-03-31", Budget: 18000, Progress: 0.1 }] },
    { name: "Tasks", fields: [{ name: "Task", type: "singleLineText" }, { name: "Project", type: "link", linkTo: "Projects", inverseName: "Tasks", singleRecord: true }, { name: "Status", type: "singleSelect", choices: [{ name: "To do", color: "gray" }, { name: "In progress", color: "blue" }, { name: "Done", color: "green" }] }, { name: "Due date", type: "date" }, { name: "Assignee", type: "singleLineText" }],
      records: [{ Task: "Episode 1 rough cut", Project: "Maple Films — Season 1", Status: "In progress", "Due date": "2026-12-02", Assignee: "Liban A." }, { Task: "Brand guidelines", Project: "Oceanic Q1 content", Status: "Done", "Due date": "2026-11-18", Assignee: "Theo T." }, { Task: "Kick-off workshop", Project: "Oceanic Q1 content", Status: "To do", "Due date": "2026-12-05", Assignee: "Kieran T." }] },
    { name: "Invoices", fields: [{ name: "Invoice", type: "singleLineText" }, { name: "Client", type: "link", linkTo: "Clients", inverseName: "Invoices", singleRecord: true }, { name: "Amount", type: "currency", options: { precision: 0 } }, { name: "Status", type: "singleSelect", choices: [{ name: "Draft", color: "gray" }, { name: "Sent", color: "blue" }, { name: "Paid", color: "green" }, { name: "Overdue", color: "red" }] }, { name: "Due date", type: "date" }],
      records: [{ Invoice: "INV-1042", Client: "Maple Films", Amount: 12000, Status: "Paid", "Due date": "2026-11-15" }, { Invoice: "INV-1043", Client: "Oceanic Content", Amount: 6000, Status: "Sent", "Due date": "2026-12-01" }, { Invoice: "INV-1044", Client: "Maple Films", Amount: 12000, Status: "Overdue", "Due date": "2026-11-10" }] },
    { name: "Activity", fields: [{ name: "Activity", type: "singleLineText" }, { name: "Type", type: "singleSelect", choices: ["Deal won", "Comment", "File", "New client", "Task"] }, { name: "Detail", type: "singleLineText" }, { name: "Deal", type: "link", linkTo: "Deals", inverseName: "Activity", singleRecord: true }],
      records: [{ Activity: "Deal won — Maple Films (£36,000)", Type: "Deal won", Detail: "Marked as Won by Liban A.", Deal: "Maple Films" }, { Activity: "Comment added — Horizon Rebrand", Type: "Comment", Detail: "New assets uploaded for review.", Deal: "Horizon Rebrand" }, { Activity: "File uploaded — Northside Launch", Type: "File", Detail: "Proposal v3.pdf (4.8 MB)", Deal: "Northside Launch" }, { Activity: "New client — Riverside Media", Type: "New client", Detail: "Added to Clients by Kieran T." }, { Activity: "Task completed — Vertex Brand Refresh", Type: "Task", Detail: "Brand guidelines approved.", Deal: "Vertex Brand Refresh" }] },
  ],
};
const OPEN = [{ field: "Stage", op: "isNoneOf", value: ["Won", "Lost"] }];
const AGENCY_APP: AppSpec = {
  name: "Agency CRM", description: "Sales, clients and project delivery in one place.", home: "dashboard",
  pages: [
    { key: "dashboard", title: "Dashboard", heading: "Agency CRM", subtitle: "Sales, clients and project delivery in one place · demo data", icon: "dashboard", components: [
      { type: "kpi", w: 3, props: { title: "Open deals", icon: "layers", agg: "count", data: { table: "Deals", filter: OPEN } } },
      { type: "kpi", w: 3, props: { title: "Pipeline value", icon: "trend", agg: "sum", field: "Value", format: "currency", data: { table: "Deals", filter: OPEN } } },
      { type: "kpi", w: 3, props: { title: "Won", icon: "check", agg: "sum", field: "Value", format: "currency", data: { table: "Deals", filter: [{ field: "Stage", op: "is", value: "Won" }] } } },
      { type: "kpi", w: 3, props: { title: "Avg. deal cycle", icon: "calendar", agg: "avg", field: "Cycle days", format: "days", data: { table: "Deals" } } },
      { type: "chart", w: 5, props: { title: "Deals by stage", subtitle: "Pipeline value by stage (demo data)", chart: "bar", agg: "sum", field: "Value", group: "Stage", format: "currency", data: { table: "Deals", filter: [{ field: "Stage", op: "isNot", value: "Lost" }] } } },
      { type: "kanban", w: 7, props: { title: "Pipeline summary", group: "Stage", fields: ["Value"], allowMove: true, detail: "deal", data: { table: "Deals", filter: [{ field: "Stage", op: "isNot", value: "Lost" }] } } },
      { type: "table", w: 8, props: { title: "Active deals", subtitle: "Demo data", fields: ["Deal", "Client", "Value", "Stage", "Owner", "Due date"], limit: 8, detail: "deal", data: { table: "Deals", filter: OPEN.concat([]), sort: "Due date" } } },
      { type: "activity", w: 4, props: { title: "Recent activity", title_field: "Activity", subtitle_field: "Detail", limit: 5, data: { table: "Activity", dir: "desc" } } },
    ] },
    { key: "contacts", title: "Contacts", icon: "users", components: [{ type: "table", w: 12, props: { title: "All contacts", fields: ["Name", "Email", "Phone", "Role", "Client"], limit: 100, data: { table: "Contacts" } } }] },
    { key: "pipeline", title: "Pipeline", icon: "funnel", components: [
      { type: "button", w: 3, visibleTo: ["editor"], props: { label: "Add deal", action: { kind: "navigate", page: "new-deal" } } },
      { type: "kanban", w: 12, props: { title: "Deals by stage", group: "Stage", fields: ["Client", "Value"], allowMove: true, detail: "deal", data: { table: "Deals" } } },
    ] },
    { key: "clients", title: "Clients", icon: "briefcase", components: [{ type: "table", w: 12, props: { title: "Clients", fields: ["Client", "Industry", "Status", "Pipeline", "Email"], limit: 100, detail: "client", data: { table: "Clients" } } }] },
    { key: "invoices", title: "Invoices", icon: "receipt", components: [
      { type: "kpi", w: 4, props: { title: "Outstanding", icon: "money", agg: "sum", field: "Amount", format: "currency", data: { table: "Invoices", filter: [{ field: "Status", op: "isAnyOf", value: ["Sent", "Overdue"] }] } } },
      { type: "kpi", w: 4, props: { title: "Overdue", icon: "clock", agg: "sum", field: "Amount", format: "currency", data: { table: "Invoices", filter: [{ field: "Status", op: "is", value: "Overdue" }] } } },
      { type: "kpi", w: 4, props: { title: "Paid", icon: "check", agg: "sum", field: "Amount", format: "currency", data: { table: "Invoices", filter: [{ field: "Status", op: "is", value: "Paid" }] } } },
      { type: "table", w: 12, props: { title: "All invoices", fields: ["Invoice", "Client", "Amount", "Status", "Due date"], limit: 100, data: { table: "Invoices", sort: "Due date" } } },
    ] },
    { key: "projects", title: "Projects", icon: "folder", components: [{ type: "table", w: 12, props: { title: "Projects", fields: ["Project", "Client", "Status", "Due date", "Budget", "Progress"], limit: 100, data: { table: "Projects" } } }] },
    { key: "tasks", title: "Tasks", icon: "check", components: [{ type: "kanban", w: 12, props: { title: "Tasks", group: "Status", fields: ["Project", "Due date"], allowMove: true, data: { table: "Tasks" } } }] },
    { key: "reports", title: "Reports", icon: "chart", components: [
      { type: "chart", w: 6, props: { title: "Pipeline by source", chart: "donut", agg: "sum", field: "Value", group: "Source", format: "currency", data: { table: "Deals" } } },
      { type: "chart", w: 6, props: { title: "Deal value by due month", chart: "line", agg: "sum", field: "Value", group: "Due date", dateUnit: "month", format: "currency", data: { table: "Deals" } } },
    ] },
    { key: "deal", title: "Deal", kind: "detail", table: "Deals", components: [
      { type: "button", w: 3, visibleTo: ["editor"], props: { label: "Mark as won", action: { kind: "update_record", values: { Stage: "Won" }, confirm: "Mark this deal as won?" } } },
      { type: "record", w: 8, props: { allowEdit: true, showRelated: true, showComments: true } },
      { type: "form", w: 4, visibleTo: ["editor"], props: { title: "Log activity", fields: ["Activity", "Type", "Detail"], required: ["Activity"], submitLabel: "Log", successMessage: "Logged.", data: { table: "Activity", rel: "Deal" } } },
    ] },
    { key: "client", title: "Client", kind: "detail", table: "Clients", components: [
      { type: "record", w: 12, props: { allowEdit: true, showRelated: true, showComments: true } },
      { type: "table", w: 6, props: { title: "Deals", fields: ["Deal", "Value", "Stage"], detail: "deal", data: { table: "Deals", rel: "Client" } } },
      { type: "table", w: 6, props: { title: "Invoices", fields: ["Invoice", "Amount", "Status"], data: { table: "Invoices", rel: "Client" } } },
    ] },
    { key: "new-deal", title: "New deal", kind: "dashboard", hidden: true, visibleTo: ["editor"], components: [
      { type: "form", w: 6, props: { title: "Add a deal", fields: ["Deal", "Summary", "Value", "Stage", "Source", "Owner", "Due date"], required: ["Deal", "Value", "Stage"], submitLabel: "Add deal", successMessage: "Deal added to the pipeline.", data: { table: "Deals" } } },
    ] },
  ],
  automations: [{ key: "won", name: "Deal won → log activity", enabled: true, trigger: { type: "record_updated", table: "Deals", watch: ["Stage"], filter: [{ field: "Stage", op: "is", value: "Won" }] }, actions: [{ type: "create_record", table: "Activity", link: "Deal", values: { Activity: "Deal won — {Deal} ({Value})", Type: "Deal won", Detail: "Marked as Won" } }] }],
};

const PRODUCTION_APP: AppSpec = {
  name: "Production OS", description: "Productions, scenes, shoot days, people and budget.", home: "dashboard",
  pages: [
    { key: "dashboard", title: "Overview", heading: "Production OS", subtitle: "Every production at a glance · demo data", icon: "dashboard", components: [
      { type: "kpi", w: 3, props: { title: "Productions", icon: "layers", agg: "count", data: { table: "Productions" } } },
      { type: "kpi", w: 3, props: { title: "Scenes", icon: "file", agg: "count", data: { table: "Scenes" } } },
      { type: "kpi", w: 3, props: { title: "Shoot days", icon: "calendar", agg: "count", data: { table: "Shoot days" } } },
      { type: "kpi", w: 3, props: { title: "Approved budget", icon: "money", agg: "sum", field: "Approved", format: "currency", data: { table: "Budget" } } },
      { type: "kanban", w: 12, props: { title: "Productions by stage", group: "Stage", fields: ["Format", "Delivery date"], allowMove: true, detail: "production", data: { table: "Productions" } } },
      { type: "chart", w: 6, props: { title: "Scenes by status", chart: "bar", agg: "count", group: "Status", data: { table: "Scenes" } } },
      { type: "table", w: 6, props: { title: "Upcoming shoot days", fields: ["Day", "Date", "Call time", "Scene count"], data: { table: "Shoot days", sort: "Date" } } },
    ] },
    { key: "productions", title: "Productions", icon: "clapper", components: [{ type: "table", w: 12, props: { title: "Productions", fields: ["Title", "Format", "Stage", "Start", "Delivery date", "Variance"], detail: "production", data: { table: "Productions" } } }] },
    { key: "stripboard", title: "Stripboard", icon: "list", components: [{ type: "kanban", w: 12, props: { title: "Scenes by status", group: "Status", fields: ["Heading", "Pages (8ths)"], allowMove: true, data: { table: "Scenes" } } }] },
    { key: "schedule", title: "Shoot days", icon: "calendar", components: [{ type: "table", w: 12, props: { title: "Shoot days", fields: ["Day", "Date", "Call time", "Scene count", "Pages"], data: { table: "Shoot days", sort: "Date" } } }] },
    { key: "people", title: "Cast & crew", icon: "users", visibleTo: ["editor"], components: [{ type: "table", w: 12, props: { title: "People", fields: ["Name", "Role", "Department", "Email", "Contract signed"], data: { table: "People" } } }] },
    { key: "budget", title: "Budget", icon: "receipt", visibleTo: ["creator"], components: [
      { type: "chart", w: 6, props: { title: "Approved by line", chart: "donut", agg: "sum", field: "Approved", group: "Line", format: "currency", data: { table: "Budget" } } },
      { type: "table", w: 6, props: { title: "Budget lines", fields: ["Line", "Code", "Approved", "Actual", "Variance"], data: { table: "Budget" } } },
    ] },
    { key: "production", title: "Production", kind: "detail", table: "Productions", components: [
      { type: "record", w: 12, props: { allowEdit: true, showRelated: true, showComments: true } },
      { type: "table", w: 12, props: { title: "Episodes", fields: ["Title", "Number", "Status", "Scene count", "Delivery"], data: { table: "Episodes", rel: "Production" } } },
    ] },
  ],
};

const PORTAL_BASE: BaseSpec = {
  name: "Client Portal", icon: "users", color: "teal", description: "Demo data — fictional clients.", tables: [
    { name: "Clients", fields: [{ name: "Client", type: "singleLineText" }, { name: "Email", type: "email" }, { name: "Account manager", type: "singleLineText" }],
      records: [{ Client: "Northwind Studio (demo)", Email: "client-portal@demo.productionos.test", "Account manager": "Sam Lee" }, { Client: "Harbour Fitness (demo)", Email: "other-client@demo.productionos.test", "Account manager": "Sam Lee" }] },
    { name: "Projects", fields: [{ name: "Project", type: "singleLineText" }, { name: "Client", type: "link", linkTo: "Clients", inverseName: "Projects", singleRecord: true }, { name: "Status", type: "singleSelect", choices: [{ name: "Planning", color: "gray" }, { name: "In production", color: "blue" }, { name: "Review", color: "orange" }, { name: "Complete", color: "green" }] }, { name: "Due date", type: "date" }, { name: "Progress", type: "percent" }],
      records: [{ Project: "Spring campaign", Client: "Northwind Studio (demo)", Status: "In production", "Due date": "2027-03-14", Progress: 0.6 }, { Project: "Website video", Client: "Northwind Studio (demo)", Status: "Review", "Due date": "2027-01-20", Progress: 0.9 }, { Project: "Gym launch film", Client: "Harbour Fitness (demo)", Status: "Planning", "Due date": "2027-04-02", Progress: 0.1 }] },
    { name: "Deliverables", fields: [{ name: "Deliverable", type: "singleLineText" }, { name: "Project", type: "link", linkTo: "Projects", inverseName: "Deliverables", singleRecord: true }, { name: "Client", type: "link", linkTo: "Clients", inverseName: "Deliverables", singleRecord: true }, { name: "Status", type: "singleSelect", choices: [{ name: "Not started", color: "gray" }, { name: "In progress", color: "blue" }, { name: "Ready for review", color: "orange" }, { name: "Approved", color: "green" }] }, { name: "Due date", type: "date" }],
      records: [{ Deliverable: "Hero film 60s", Project: "Spring campaign", Client: "Northwind Studio (demo)", Status: "In progress", "Due date": "2027-02-28" }, { Deliverable: "Cutdowns 15s x3", Project: "Spring campaign", Client: "Northwind Studio (demo)", Status: "Not started", "Due date": "2027-03-07" }, { Deliverable: "Website edit", Project: "Website video", Client: "Northwind Studio (demo)", Status: "Ready for review", "Due date": "2027-01-15" }, { Deliverable: "Launch teaser", Project: "Gym launch film", Client: "Harbour Fitness (demo)", Status: "Not started", "Due date": "2027-03-20" }] },
    { name: "Invoices", fields: [{ name: "Invoice", type: "singleLineText" }, { name: "Client", type: "link", linkTo: "Clients", inverseName: "Invoices", singleRecord: true }, { name: "Amount", type: "currency", options: { precision: 0 } }, { name: "Status", type: "singleSelect", choices: [{ name: "Sent", color: "blue" }, { name: "Paid", color: "green" }, { name: "Overdue", color: "red" }] }, { name: "Due date", type: "date" }],
      records: [{ Invoice: "NW-001", Client: "Northwind Studio (demo)", Amount: 8000, Status: "Paid", "Due date": "2026-11-01" }, { Invoice: "NW-002", Client: "Northwind Studio (demo)", Amount: 8000, Status: "Sent", "Due date": "2026-12-15" }, { Invoice: "HF-001", Client: "Harbour Fitness (demo)", Amount: 5000, Status: "Sent", "Due date": "2026-12-20" }] },
    { name: "Requests", fields: [{ name: "Request", type: "singleLineText" }, { name: "Client", type: "link", linkTo: "Clients", inverseName: "Requests", singleRecord: true }, { name: "Details", type: "longText" }, { name: "Priority", type: "singleSelect", choices: ["Low", "Normal", "Urgent"] }, { name: "Status", type: "singleSelect", choices: [{ name: "New", color: "blue" }, { name: "In progress", color: "orange" }, { name: "Done", color: "green" }] }] },
  ],
};
const PORTAL_APP: AppSpec = {
  name: "Client Portal", description: "Your projects, deliverables and invoices.", audience: "portal", portal: { table: "Clients", email: "Email" }, home: "overview",
  pages: [
    { key: "overview", title: "Overview", heading: "Welcome", subtitle: "Your projects, deliverables and invoices", icon: "home", components: [
      { type: "kpi", w: 4, props: { title: "Active projects", icon: "layers", agg: "count", data: { table: "Projects", scope: "Client", filter: [{ field: "Status", op: "isNot", value: "Complete" }] } } },
      { type: "kpi", w: 4, props: { title: "Awaiting your review", icon: "check", agg: "count", data: { table: "Deliverables", scope: "Client", filter: [{ field: "Status", op: "is", value: "Ready for review" }] } } },
      { type: "kpi", w: 4, props: { title: "Amount due", icon: "money", agg: "sum", field: "Amount", format: "currency", data: { table: "Invoices", scope: "Client", filter: [{ field: "Status", op: "isAnyOf", value: ["Sent", "Overdue"] }] } } },
      { type: "table", w: 7, props: { title: "Your projects", fields: ["Project", "Status", "Due date", "Progress"], detail: "project", data: { table: "Projects", scope: "Client" } } },
      { type: "form", w: 5, props: { title: "Request something", fields: ["Request", "Priority", "Details"], required: ["Request"], submitLabel: "Send request", successMessage: "Thanks — your account manager has it.", data: { table: "Requests", scope: "Client" } } },
    ] },
    { key: "deliverables", title: "Deliverables", icon: "package", components: [{ type: "table", w: 12, props: { title: "Deliverables", fields: ["Deliverable", "Project", "Status", "Due date"], data: { table: "Deliverables", scope: "Client", sort: "Due date" } } }] },
    { key: "invoices", title: "Invoices", icon: "receipt", components: [{ type: "table", w: 12, props: { title: "Invoices", fields: ["Invoice", "Amount", "Status", "Due date"], data: { table: "Invoices", scope: "Client", sort: "Due date" } } }] },
    { key: "requests", title: "My requests", icon: "message", components: [{ type: "table", w: 12, props: { title: "Requests", fields: ["Request", "Priority", "Status"], data: { table: "Requests", scope: "Client" } } }] },
    { key: "project", title: "Project", kind: "detail", table: "Projects", scope: "Client", components: [
      { type: "record", w: 12, props: { showRelated: false, showComments: false } },
      { type: "table", w: 12, props: { title: "Deliverables", fields: ["Deliverable", "Status", "Due date"], data: { table: "Deliverables", rel: "Project", scope: "Client" } } },
    ] },
  ],
};

export const APP_TEMPLATES: Record<string, { name: string; description: string; category: string; icon: string; color: string; base: () => BaseSpec; app: AppSpec }> = {
  "agency-crm": { name: "Agency CRM", description: "Dashboard, pipeline, clients, projects, tasks, invoices and reports — with deal detail pages, actions and an automation.", category: "Apps", icon: "handshake", color: "blue", base: () => structuredClone(AGENCY_BASE), app: AGENCY_APP },
  "production-os": { name: "Production OS", description: "Production overview, stripboard, shoot days, cast & crew and budget — built on the same builder.", category: "Apps", icon: "clapperboard", color: "red", base: () => templateSpec("production"), app: PRODUCTION_APP },
  "client-portal": { name: "Client Portal", description: "A published portal where each client sees only their own projects, deliverables and invoices and can send requests.", category: "Apps", icon: "users", color: "teal", base: () => structuredClone(PORTAL_BASE), app: PORTAL_APP },
};

/** Build base + automations + app from a template, publish v1. One code path for every template (and AI plans). */
export async function createSystem(ctx: Ctx, base: BaseSpec, app: AppSpec, opts: { templateKey?: string; publish?: boolean } = {}) {
  const b = await createBaseFromSpec(ctx, base);
  const autoIds = await createAutomations(ctx, b.baseId, app.automations);
  const config = await resolveAppSpec(b.baseId, app, autoIds);
  const row = await createApp(ctx, { baseId: b.baseId, name: app.name, audience: app.audience ?? "workspace", config, description: app.description, templateKey: opts.templateKey, icon: base.icon, color: base.color });
  if (opts.publish !== false) await publishApp(ctx, row.id, "Initial version");
  return { baseId: b.baseId, appId: row.id, slug: row.slug };
}
export async function createAppFromTemplate(ctx: Ctx, key: string) {
  const t = APP_TEMPLATES[key]; if (!t) throw invalid("Unknown app template.");
  return createSystem(ctx, t.base(), t.app, { templateKey: key });
}
