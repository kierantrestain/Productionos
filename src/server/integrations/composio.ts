/**
 * Composio connector: lets each person connect their own accounts (Gmail, Slack, HubSpot, Notion, …)
 * through Composio-hosted sign-in, then pull data in and let agents use those apps.
 *
 * Server-side only. Requires COMPOSIO_API_KEY (deployment secret). Without it every call reports
 * "not configured" — nothing is faked. Connections are personal: the Composio user id is scoped to
 * workspace + person, so nobody can use someone else's connected account.
 *
 * Endpoints follow Composio's v3 REST API (hosted connect links via /connected_accounts/link with
 * Composio-managed auth configs). Paths are kept in one place so they can be adjusted after the first
 * live run against a real key.
 */
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { db } from "@/db";
import { invalid } from "../errors";

const BASE = () => (process.env.COMPOSIO_API_BASE || "https://backend.composio.dev/api/v3").replace(/\/$/, "");
export const composioConfigured = () => Boolean(process.env.COMPOSIO_API_KEY);
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (u, i) => fetch(u, i);
/** Test seam (MOCK-ONLY tests). */
export function __setComposioFetcher(f: Fetcher | null) { fetcher = f ?? ((u, i) => fetch(u, i)); }

export const composioUserId = (ctx: Pick<Ctx, "orgId" | "userId">) => `bangon:${ctx.orgId}:${ctx.userId}`;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!composioConfigured()) throw invalid("App connections aren't configured yet: an administrator must set COMPOSIO_API_KEY.");
  const r = await fetcher(`${BASE()}${path}`, { method, headers: { "x-api-key": process.env.COMPOSIO_API_KEY!, "Content-Type": "application/json", Accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const text = await r.text();
  let j: unknown = null; try { j = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!r.ok) { const m = (j as { error?: { message?: string }; message?: string } | null); throw invalid(`The app connection service returned ${r.status}${m?.error?.message || m?.message ? `: ${m?.error?.message ?? m?.message}` : ""}.`); }
  return j as T;
}

export type AppInfo = { slug: string; name: string; description: string; logo: string | null; categories: string[]; live: boolean };

/** Popular apps shown before a key is configured (and as a fast first paint). Logos load from Composio's logo CDN with a lettered fallback. */
export const FEATURED: AppInfo[] = ([
  ["gmail", "Gmail", "Email", "Read, search and send email."], ["googlecalendar", "Google Calendar", "Calendar", "Events, availability and scheduling."],
  ["googlesheets", "Google Sheets", "Spreadsheets", "Read and write spreadsheet rows."], ["googledrive", "Google Drive", "Files", "Find and fetch files and folders."],
  ["slack", "Slack", "Messaging", "Channels, messages and people."], ["notion", "Notion", "Docs", "Pages, databases and notes."],
  ["hubspot", "HubSpot", "CRM", "Contacts, companies and deals."], ["salesforce", "Salesforce", "CRM", "Accounts, leads and opportunities."],
  ["github", "GitHub", "Developer", "Repos, issues and pull requests."], ["linear", "Linear", "Project management", "Issues, projects and cycles."],
  ["jira", "Jira", "Project management", "Issues, sprints and boards."], ["asana", "Asana", "Project management", "Tasks and projects."],
  ["trello", "Trello", "Project management", "Boards, lists and cards."], ["airtable", "Airtable", "Database", "Bases, tables and records."],
  ["outlook", "Outlook", "Email", "Microsoft mail and calendar."], ["microsoft_teams", "Microsoft Teams", "Messaging", "Chats and channels."],
  ["dropbox", "Dropbox", "Files", "Files and shared folders."], ["shopify", "Shopify", "E-commerce", "Orders, products and customers."],
  ["stripe", "Stripe", "Payments", "Payments, customers and invoices."], ["xero", "Xero", "Accounting", "Invoices, contacts and bills."],
  ["quickbooks", "QuickBooks", "Accounting", "Invoices, customers and expenses."], ["calendly", "Calendly", "Calendar", "Scheduled meetings."],
  ["zoom", "Zoom", "Meetings", "Meetings and recordings."], ["typeform", "Typeform", "Forms", "Forms and responses."],
  ["mailchimp", "Mailchimp", "Marketing", "Audiences and campaigns."], ["intercom", "Intercom", "Support", "Conversations and contacts."],
  ["zendesk", "Zendesk", "Support", "Tickets and users."], ["clickup", "ClickUp", "Project management", "Tasks, lists and spaces."],
  ["monday", "monday.com", "Project management", "Boards and items."], ["youtube", "YouTube", "Media", "Channels, videos and analytics."],
  ["instagram", "Instagram", "Social", "Posts and insights."], ["linkedin", "LinkedIn", "Social", "Profile and posts."],
] as const).map(([slug, name, cat, description]) => ({ slug, name, description, logo: `https://logos.composio.dev/api/${slug}`, categories: [cat], live: false }));

type ToolkitItem = { slug: string; name: string; meta?: { logo?: string; description?: string; categories?: { name?: string; id?: string }[] } };
export async function listApps(search = ""): Promise<{ apps: AppInfo[]; live: boolean }> {
  if (!composioConfigured()) {
    const n = search.trim().toLowerCase();
    return { apps: FEATURED.filter((a) => !n || `${a.name} ${a.categories.join(" ")} ${a.description}`.toLowerCase().includes(n)), live: false };
  }
  const q = new URLSearchParams({ limit: "200", ...(search.trim() ? { search: search.trim().slice(0, 60) } : {}) });
  const r = await call<{ items?: ToolkitItem[] }>("GET", `/toolkits?${q}`);
  return { live: true, apps: (r.items ?? []).filter((t) => t.slug).map((t) => ({ slug: t.slug, name: t.name || t.slug, description: t.meta?.description ?? "", logo: t.meta?.logo ?? `https://logos.composio.dev/api/${t.slug}`, categories: (t.meta?.categories ?? []).map((c) => c.name ?? c.id ?? "").filter(Boolean), live: true })) };
}

const safeSlug = (s: string) => { if (!/^[a-z0-9_-]{1,60}$/i.test(s)) throw invalid("Unknown app."); return s.toLowerCase(); };

/** Find (or create) the Composio-managed auth config for a toolkit, so no per-app OAuth setup is needed. */
async function authConfigFor(toolkit: string) {
  const list = await call<{ items?: { id: string; toolkit?: { slug?: string }; status?: string }[] }>("GET", `/auth_configs?toolkit_slug=${encodeURIComponent(toolkit)}`);
  const found = (list.items ?? []).find((x) => (x.toolkit?.slug ?? toolkit) === toolkit && x.status !== "DISABLED");
  if (found) return found.id;
  const made = await call<{ auth_config?: { id: string }; id?: string }>("POST", "/auth_configs", { toolkit: { slug: toolkit }, auth_config: { type: "use_composio_managed_auth" } });
  const id = made.auth_config?.id ?? made.id;
  if (!id) throw invalid("Couldn't set up sign-in for this app.");
  return id;
}

/** Start connecting an app for the signed-in person: returns Composio's hosted sign-in URL. */
export async function connectApp(ctx: Ctx, toolkit: string, callbackUrl: string) {
  const slug = safeSlug(toolkit);
  const authConfigId = await authConfigFor(slug);
  const r = await call<{ redirect_url?: string; redirectUrl?: string; id?: string }>("POST", "/connected_accounts/link", { user_id: composioUserId(ctx), auth_config_id: authConfigId, callback_url: callbackUrl });
  const url = r.redirect_url ?? r.redirectUrl;
  if (!url || !/^https:\/\//.test(url)) throw invalid("The app didn't return a sign-in link.");
  await audit(db, ctx, "connect_app_start", "user_connections", null, { meta: { toolkit: slug } });
  return { url };
}

export type Connection = { id: string; toolkit: string; status: string; createdAt: string | null };
export async function myConnections(ctx: Ctx): Promise<Connection[]> {
  if (!composioConfigured()) return [];
  const r = await call<{ items?: { id: string; status?: string; toolkit?: { slug?: string }; created_at?: string }[] }>("GET", `/connected_accounts?user_ids=${encodeURIComponent(composioUserId(ctx))}&limit=200`);
  return (r.items ?? []).map((x) => ({ id: x.id, toolkit: x.toolkit?.slug ?? "", status: x.status ?? "UNKNOWN", createdAt: x.created_at ?? null })).filter((x) => x.toolkit);
}

export async function disconnectApp(ctx: Ctx, connectionId: string) {
  const mine = await myConnections(ctx);
  const c = mine.find((x) => x.id === connectionId);
  if (!c) throw invalid("That connection isn't yours or no longer exists.");
  await call("DELETE", `/connected_accounts/${encodeURIComponent(connectionId)}`);
  await audit(db, ctx, "disconnect_app", "user_connections", null, { meta: { toolkit: c.toolkit } });
}

export type AppTool = { slug: string; name: string; description: string; readOnly: boolean; parameters: Record<string, unknown> };
/** A tool is treated as read-only only when its name clearly says so; everything else needs approval when an agent uses it. */
export const isReadTool = (slug: string) => /(^|_)(LIST|GET|FETCH|SEARCH|FIND|READ|RETRIEVE|QUERY|DESCRIBE|COUNT)(_|$)/i.test(slug) && !/(SEND|CREATE|UPDATE|DELETE|REMOVE|POST|REPLY|INVITE|MOVE|ARCHIVE|PATCH|SET|ADD)/i.test(slug);
export async function listAppTools(toolkit: string): Promise<AppTool[]> {
  const slug = safeSlug(toolkit);
  const r = await call<{ items?: { slug: string; name?: string; description?: string; input_parameters?: Record<string, unknown> }[] }>("GET", `/tools?toolkit_slug=${encodeURIComponent(slug)}&limit=200`);
  return (r.items ?? []).map((t) => ({ slug: t.slug, name: t.name ?? t.slug, description: (t.description ?? "").slice(0, 400), readOnly: isReadTool(t.slug), parameters: t.input_parameters ?? {} }));
}

/** Run one tool with the person's own connected account. Callers decide whether approval is required first. */
export async function runAppTool(ctx: Pick<Ctx, "orgId" | "userId">, toolSlug: string, args: Record<string, unknown>) {
  if (!/^[A-Z0-9_]{3,120}$/i.test(toolSlug)) throw invalid("Unknown app action.");
  const r = await call<{ data?: unknown; successful?: boolean; error?: string | null }>("POST", `/tools/execute/${encodeURIComponent(toolSlug)}`, { user_id: composioUserId(ctx), arguments: args ?? {} });
  if (r.successful === false) throw invalid(`The app said: ${r.error ?? "the action failed"}`);
  return r.data ?? null;
}

/** Find the first list of records in an app response (e.g. { data: { messages: [...] } }) for importing. */
export function rowsFrom(data: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4 || data == null) return [];
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object" && !Array.isArray(x)).slice(0, 1000) as Record<string, unknown>[];
  if (typeof data === "object") { for (const v of Object.values(data as Record<string, unknown>)) { const r = rowsFrom(v, depth + 1); if (r.length) return r; } }
  return [];
}
/** Flatten app rows into simple columns (nested values become text) for a new table. */
export function flattenRows(rows: Record<string, unknown>[]) {
  const cols: string[] = [];
  const flat = rows.map((r) => {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      const key = k.replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()).slice(0, 60);
      if (!cols.includes(key) && cols.length < 40) cols.push(key);
      if (cols.includes(key)) o[key] = v == null ? "" : typeof v === "object" ? JSON.stringify(v).slice(0, 2000) : String(v).slice(0, 5000);
    }
    return o;
  });
  return { cols, rows: flat };
}
