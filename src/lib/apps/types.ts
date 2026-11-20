/**
 * App configuration — the single source of truth for both Builder mode and published App mode.
 * Everything a business app needs (navigation, pages, components, data bindings, visibility, portal
 * scoping) is data, interpreted by one generic renderer. No business is hard-coded.
 */
export type Role = "owner" | "creator" | "editor" | "commenter" | "reader" | "portal";
export const APP_ROLES: Role[] = ["owner", "creator", "editor", "commenter", "reader", "portal"];

export type Cond = { fieldId: string; op: string; value?: unknown };
export type Filter = { conjunction: "and" | "or"; conditions: Cond[] };
export type Agg = "count" | "sum" | "avg" | "min" | "max";
export type Format = "number" | "currency" | "percent" | "days";

/** Bind to a table (optionally via a saved view) with extra filters. */
export interface DataBinding {
  tableId: string; viewId?: string; filter?: Filter; sortFieldId?: string; sortDir?: "asc" | "desc";
  /** Detail pages: only rows whose link field contains the page's current record. */
  relationFieldId?: string;
  /** Portal apps: only rows whose link field contains the visitor's scope records. */
  scopeLinkFieldId?: string;
}

export type ComponentType = "heading" | "text" | "kpi" | "chart" | "table" | "kanban" | "activity" | "record" | "form" | "button" | "divider" | "calendar" | "gallery" | "progress";

export interface ButtonAction {
  kind: "navigate" | "create_record" | "update_record" | "run_automation" | "open_url";
  pageId?: string; tableId?: string; values?: Record<string, unknown>; automationId?: string; url?: string; confirm?: string;
}

export interface Component {
  id: string;
  type: ComponentType;
  w: number;                 // grid columns on desktop, 1–12
  visibleTo?: Role[];        // empty/undefined = everyone who can open the page
  props: {
    title?: string; subtitle?: string; text?: string; icon?: string;
    data?: DataBinding;
    agg?: Agg; fieldId?: string; format?: Format;
    chart?: "bar" | "line" | "donut"; groupFieldId?: string; dateUnit?: "day" | "week" | "month";
    fieldIds?: string[]; limit?: number; detailPageId?: string; allowCreate?: boolean; allowEdit?: boolean; allowMove?: boolean;
    titleFieldId?: string; subtitleFieldId?: string; dateFieldId?: string;
    showRelated?: boolean; showComments?: boolean;
    submitLabel?: string; successMessage?: string; conditional?: Record<string, Cond>; required?: string[];
    label?: string; variant?: "primary" | "secondary" | "danger"; action?: ButtonAction;
    /** progress: goal value; gallery: attachment field for the cover image; table: search box */
    target?: number; imageFieldId?: string; showSearch?: boolean;
  };
}

export interface Page {
  id: string; title: string; slug: string; icon?: string; subtitle?: string;
  /** Large heading on the page (defaults to the title, which is also the navigation label). */
  heading?: string;
  kind: "dashboard" | "detail" | "blank";
  /** Detail pages render one record of this table: /a/<app>/<page>/<recordId>. */
  tableId?: string;
  /** Portal apps: link field on `tableId` that points at the portal table (scopes which records a visitor may open). */
  scopeLinkFieldId?: string;
  parentId?: string;            // nested navigation
  hidden?: boolean;             // not in navigation (e.g. detail pages)
  visibleTo?: Role[];
  components: Component[];
}

export interface AppConfig {
  pages: Page[];
  homePageId?: string;
  /** Portal apps: the visitor's scope = rows of `tableId` whose `emailFieldId` equals their sign-in email. */
  portal?: { tableId: string; emailFieldId: string };
  accent?: string;
}

/** Palette metadata used by the builder. */
export const PALETTE: { group: string; items: { type: ComponentType; label: string; icon: string; w: number }[] }[] = [
  { group: "Data & KPI", items: [{ type: "kpi", label: "KPI card", icon: "gauge", w: 3 }, { type: "chart", label: "Chart", icon: "chart", w: 6 }, { type: "table", label: "Table", icon: "table", w: 12 }, { type: "kanban", label: "Kanban", icon: "kanban", w: 12 }, { type: "activity", label: "Activity", icon: "activity", w: 4 }, { type: "progress", label: "Goal progress", icon: "progress", w: 4 }] },
  { group: "Records", items: [{ type: "calendar", label: "Calendar", icon: "calendar", w: 12 }, { type: "gallery", label: "Gallery", icon: "gallery", w: 12 }] },
  { group: "Content", items: [{ type: "heading", label: "Heading", icon: "heading", w: 12 }, { type: "text", label: "Text", icon: "text", w: 12 }, { type: "divider", label: "Divider", icon: "divider", w: 12 }] },
  { group: "Forms & actions", items: [{ type: "form", label: "Form", icon: "form", w: 6 }, { type: "button", label: "Button", icon: "button", w: 3 }, { type: "record", label: "Record detail", icon: "record", w: 12 }] },
];

export const newId = (p = "c") => `${p}_${Math.random().toString(36).slice(2, 10)}`;
export const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "page";

export function defaultProps(type: ComponentType, tableId?: string): Component["props"] {
  switch (type) {
    case "heading": return { title: "Section title", subtitle: "" };
    case "text": return { text: "Write something helpful for the people using this app." };
    case "kpi": return { title: "Records", data: tableId ? { tableId } : undefined, agg: "count", format: "number", icon: "layers" };
    case "chart": return { title: "Chart", chart: "bar", data: tableId ? { tableId } : undefined, agg: "count" };
    case "table": return { title: "Records", data: tableId ? { tableId } : undefined, fieldIds: [], limit: 25, showSearch: true };
    case "kanban": return { title: "Board", data: tableId ? { tableId } : undefined, fieldIds: [], allowMove: true };
    case "activity": return { title: "Recent activity", data: tableId ? { tableId, sortDir: "desc" } : undefined, limit: 6 };
    case "record": return { showRelated: true, showComments: true, allowEdit: true };
    case "form": return { title: "New record", data: tableId ? { tableId } : undefined, fieldIds: [], submitLabel: "Submit", successMessage: "Saved." };
    case "button": return { label: "Button", variant: "primary", action: { kind: "navigate" } };
    case "divider": return {};
    case "calendar": return { title: "Calendar", data: tableId ? { tableId } : undefined, fieldIds: [] };
    case "gallery": return { title: "Gallery", data: tableId ? { tableId } : undefined, fieldIds: [], limit: 24 };
    case "progress": return { title: "Goal", data: tableId ? { tableId } : undefined, agg: "count", format: "number", target: 100 };
  }
}

/** Structural validation (shared by save/publish and AI apply). Throws a readable message. */
export function validateAppConfig(c: AppConfig): AppConfig {
  if (!c || !Array.isArray(c.pages)) throw new Error("App config needs pages.");
  if (c.pages.length > 60) throw new Error("Apps are limited to 60 pages.");
  const ids = new Set<string>(); const slugs = new Set<string>();
  for (const p of c.pages) {
    if (!p.id || ids.has(p.id)) throw new Error("Pages need unique ids.");
    ids.add(p.id);
    if (!p.slug || slugs.has(p.slug) || !/^[a-z0-9-]{1,48}$/.test(p.slug)) throw new Error(`Page “${p.title}” needs a unique URL name (letters, numbers, dashes).`);
    slugs.add(p.slug);
    if (!p.title?.trim()) throw new Error("Every page needs a title.");
    if (p.kind === "detail" && !p.tableId) throw new Error(`Detail page “${p.title}” needs a table.`);
    if (!Array.isArray(p.components) || p.components.length > 80) throw new Error(`Page “${p.title}” has too many components.`);
    const cids = new Set<string>();
    for (const comp of p.components) {
      if (!comp.id || cids.has(comp.id)) throw new Error(`Components on “${p.title}” need unique ids.`);
      cids.add(comp.id);
      if (!["heading", "text", "kpi", "chart", "table", "kanban", "activity", "record", "form", "button", "divider", "calendar", "gallery", "progress"].includes(comp.type)) throw new Error(`Unknown component “${comp.type}”.`);
      comp.w = Math.min(12, Math.max(1, Math.round(comp.w || 12)));
    }
  }
  if (c.homePageId && !ids.has(c.homePageId)) c.homePageId = c.pages.find((p) => p.kind !== "detail")?.id;
  return c;
}
