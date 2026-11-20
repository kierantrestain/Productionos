"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/server/auth/request";
import { invalid, toResult } from "@/server/errors";
import * as C from "@/server/integrations/composio";
import { chatgptConnection, chatgptStatusReason, disconnectChatgpt } from "@/server/integrations/chatgpt";
import { createBaseFromSpec } from "@/server/platform/spec";
import { audit } from "@/server/audit";
import { db } from "@/db";

async function origin() { const h = await headers(); return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`; }

export async function connectionsOverviewAction(search = "") {
  return toResult(async () => {
    const ctx = await requireContext();
    const [catalog, conns, gpt] = await Promise.all([C.listApps(search), C.myConnections(ctx).catch(() => []), chatgptConnection(ctx)]);
    return { ...catalog, configured: C.composioConfigured(), connections: conns, chatgpt: { configuredReason: chatgptStatusReason(), connected: !!gpt, account: gpt?.accountLabel ?? null, since: gpt?.createdAt.toISOString() ?? null } };
  });
}
export async function connectAppAction(toolkit: string) {
  return toResult(async () => C.connectApp(await requireContext(), toolkit, `${await origin()}/workspace/settings?tab=apps&connected=${encodeURIComponent(toolkit)}`));
}
export async function disconnectAppAction(connectionId: string) {
  return toResult(async () => { await C.disconnectApp(await requireContext(), connectionId); revalidatePath("/workspace/settings"); });
}
export async function disconnectChatgptAction() {
  return toResult(async () => { await disconnectChatgpt(await requireContext()); revalidatePath("/workspace/settings"); });
}
export async function appToolsAction(toolkit: string) {
  return toResult(async () => { await requireContext(); return (await C.listAppTools(toolkit)).filter((t) => t.readOnly).slice(0, 100); });
}
/** Preview data from a READ action (never a send/change action). */
export async function previewAppDataAction(tool: string, args: Record<string, unknown>) {
  return toResult(async () => {
    const ctx = await requireContext();
    if (!C.isReadTool(tool)) throw invalid("Only read actions (list, get, search…) can pull data in.");
    const rows = C.rowsFrom(await C.runAppTool(ctx, tool, args ?? {}));
    const f = C.flattenRows(rows);
    return { count: rows.length, cols: f.cols, sample: f.rows.slice(0, 20) };
  });
}
/** Pull a READ action's results into a new table (in an existing base, or a new base). */
export async function importAppDataAction(input: { tool: string; args: Record<string, unknown>; tableName: string; baseId?: string }) {
  return toResult(async () => {
    const ctx = await requireContext();
    if (!C.isReadTool(input.tool)) throw invalid("Only read actions can pull data in.");
    const rows = C.rowsFrom(await C.runAppTool(ctx, input.tool, input.args ?? {}));
    if (!rows.length) throw invalid("That action returned no rows to import.");
    const { cols, rows: flat } = C.flattenRows(rows);
    const name = (input.tableName || input.tool).trim().slice(0, 80);
    const r = await createBaseFromSpec(ctx, { name, tables: [{ name, fields: cols.map((c) => ({ name: c, type: "longText" as const })), records: flat }] }, input.baseId ? { intoBaseId: input.baseId } : {});
    await audit(db, ctx, "import_app_data", "bases", r.baseId, { meta: { tool: input.tool, rows: flat.length } });
    revalidatePath("/", "layout");
    return { baseId: r.baseId, tableId: Object.values(r.tableIds)[0], rows: flat.length };
  });
}
