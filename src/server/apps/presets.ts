/**
 * Interface layouts: turn "a dashboard over Deals" into a working multi-page app config built from the
 * table's real fields (numbers → KPIs/goal, selects → charts/board columns, dates → calendar/trend,
 * attachments → gallery covers). Everything generated is ordinary config the builder can then edit.
 */
import { newId, type AppConfig, type Component, type Page } from "@/lib/apps/types";
import type { Ctx } from "../auth/context";
import { invalid } from "../errors";
import { loadBaseStructure } from "../platform/schema";
import { createApp } from "./apps";

export const LAYOUTS = ["dashboard", "records", "board", "calendar", "gallery", "form", "blank"] as const;
export type Layout = (typeof LAYOUTS)[number];

type F = { id: string; name: string; type: string };
const NUM = ["number", "currency", "percent", "rating", "duration"];
const DATE = ["date", "dateTime"];
const fs = (fields: F[], types: string[]) => fields.filter((f) => types.includes(f.type)).map((f) => f.id);

export function presetConfig(layout: Layout, name: string, table: { id: string; name: string; primaryFieldId: string | null } | null, fields: F[]): AppConfig {
  const c = (type: Component["type"], w: number, props: Component["props"]): Component => ({ id: newId(), type, w, props });
  const home: Page = { id: newId("p"), title: layout === "blank" || !table ? "Home" : table.name, slug: "home", kind: "dashboard", icon: "dashboard", heading: name, components: [] };
  if (layout === "blank" || !table) { home.components.push(c("heading", 12, { title: name, subtitle: "Drag components from the left to build this page." })); return { pages: [home], homePageId: home.id }; }

  const data = { tableId: table.id };
  const money = fields.find((f) => f.type === "currency");
  const num = money ?? fields.find((f) => NUM.includes(f.type));
  const select = fields.find((f) => f.type === "singleSelect");
  const date = fields.find((f) => DATE.includes(f.type));
  const image = fields.find((f) => f.type === "attachment");
  const cols = [table.primaryFieldId, ...fields.filter((f) => f.id !== table.primaryFieldId && !["longText", "attachment", "button"].includes(f.type)).map((f) => f.id)].filter(Boolean).slice(0, 6) as string[];
  const detail: Page = { id: newId("p"), title: `${table.name} detail`, slug: "record", kind: "detail", tableId: table.id, hidden: true, icon: "file", components: [c("record", 12, { showRelated: true, showComments: true, allowEdit: true })] };
  const list = (w = 12, title = `All ${table.name.toLowerCase()}`) => c("table", w, { title, data, fieldIds: cols, limit: 50, detailPageId: detail.id, showSearch: true });
  const fmt = money ? "currency" as const : "number" as const;

  switch (layout) {
    case "dashboard":
      if (select) home.components.push(c("filter", 12, { data, fieldIds: fs(fields, ["singleSelect", "multipleSelects", "checkbox"]).slice(0, 3), showSearch: true }));
      home.components.push(c("kpi", num ? 3 : 4, { title: `Total ${table.name.toLowerCase()}`, data, agg: "count", format: "number", icon: "layers" }));
      if (num) home.components.push(c("kpi", 3, { title: `Total ${num.name.toLowerCase()}`, data, agg: "sum", fieldId: num.id, format: fmt, icon: money ? "money" : "trend" }), c("kpi", 3, { title: `Average ${num.name.toLowerCase()}`, data, agg: "avg", fieldId: num.id, format: fmt, icon: "gauge" }));
      home.components.push(c("progress", num ? 3 : 4, { title: num ? `${num.name} goal` : "Record goal", data, agg: num ? "sum" : "count", fieldId: num?.id, format: fmt, target: 100 }));
      if (select) home.components.push(c("chart", date ? 6 : 12, { title: money ? `${money.name} by ${select.name.toLowerCase()}` : `${table.name} by ${select.name.toLowerCase()}`, chart: money ? "bar" : "donut", data, agg: money ? "sum" : "count", fieldId: money?.id, groupFieldId: select.id, format: money ? "currency" : "number" }));
      if (date) home.components.push(c("chart", select ? 6 : 12, { title: `${table.name} over time`, chart: "line", data, agg: "count", groupFieldId: date.id, dateUnit: "month" }));
      home.components.push(list(8, `Recent ${table.name.toLowerCase()}`), c("activity", 4, { title: "Latest updates", data: { ...data, sortDir: "desc" }, limit: 6, detailPageId: detail.id }));
      break;
    case "records": if (select) home.components.push(c("filter", 12, { data, fieldIds: fs(fields, ["singleSelect", "multipleSelects", "checkbox"]).slice(0, 3), showSearch: true }));
      home.components.push(list(8), c("form", 4, { title: `Add ${table.name.replace(/s$/, "").toLowerCase()}`, data, fieldIds: [], submitLabel: "Add", successMessage: "Added." })); break;
    case "board":
      home.components.push(select ? c("kanban", 12, { title: `${table.name} by ${select.name.toLowerCase()}`, data, groupFieldId: select.id, fieldIds: cols.slice(1, 4), allowMove: true, detailPageId: detail.id })
        : c("text", 12, { text: `Add a single-select field to ${table.name} (e.g. Status) to group cards into columns, then pick it in this board's Data tab.` }));
      if (!select) home.components.push(c("kanban", 12, { title: table.name, data, fieldIds: cols.slice(1, 4), allowMove: true, detailPageId: detail.id }));
      break;
    case "calendar": home.components.push(c("calendar", 12, { title: `${table.name} calendar`, data, dateFieldId: date?.id, detailPageId: detail.id })); break;
    case "gallery": home.components.push(c("gallery", 12, { title: table.name, data, imageFieldId: image?.id, fieldIds: cols.slice(1, 4), limit: 48, detailPageId: detail.id })); break;
    case "form": home.components.push(c("form", 8, { title: `New ${table.name.replace(/s$/, "").toLowerCase()}`, data, fieldIds: [], submitLabel: "Submit", successMessage: "Thanks — your entry was saved." }), c("text", 4, { text: "Each submission creates a record in the table. Choose which fields appear in the form's Data tab." })); break;
  }
  const pages: Page[] = [home];
  if (layout === "dashboard") pages.push({ id: newId("p"), title: `All ${table.name.toLowerCase()}`, slug: "all", kind: "dashboard", icon: "list", components: [list()] });
  if (layout !== "form") pages.push(detail);
  return { pages, homePageId: home.id };
}

export async function createInterfaceApp(ctx: Ctx, input: { baseId: string; name: string; layout: Layout; tableId?: string }) {
  if (!LAYOUTS.includes(input.layout)) throw invalid("Choose a layout.");
  const st = await loadBaseStructure(ctx, input.baseId);
  const table = input.tableId ? st.tables.find((t) => t.id === input.tableId) : st.tables[0];
  if (input.layout !== "blank" && !table) throw invalid("This base has no tables yet. Add a table first, or start blank.");
  const fields = table ? st.fields.filter((f) => f.tableId === table.id).map((f) => ({ id: f.id, name: f.name, type: f.type })) : [];
  const config = presetConfig(input.layout, input.name.trim() || "Interface", table ? { id: table.id, name: table.name, primaryFieldId: table.primaryFieldId } : null, fields);
  return createApp(ctx, { baseId: input.baseId, name: input.name, config, icon: "grid", color: "blue", description: table ? `${input.layout[0].toUpperCase()}${input.layout.slice(1)} over ${table.name}` : undefined });
}
