/**
 * Business AI agents (in-app only). Each agent has a name, role, instructions and a set of tables.
 * It runs Claude with tools that READ records using the chatting user's own permissions, and PROPOSE
 * writes (create / update / comment), which land in the approval queue — nothing is written until a
 * person approves it, and approval executes with the approver's permissions. No email, chat-app or
 * external sends. Transcripts are append-only and replayed unchanged.
 */
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentMessages, agentThreads, baseAgents, baseApprovals, baseTables } from "@/db/schema";
import { cellText } from "@/lib/platform/cell-text";
import { coerceValue, isComputed, type FieldDefLite } from "@/lib/platform/fields";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { atLeast, baseAccess, requireRole } from "./access";
import { fileApproval } from "./approvals";
import { runView } from "./query";
import { aiConfigured } from "./ai";
import { composioConfigured, isReadTool, listAppTools, myConnections, runAppTool } from "../integrations/composio";
import { chatgptResponses } from "../integrations/chatgpt";

const MODEL = "claude-opus-5-5";
const MAX_STEPS = 8;
const MAX_THREAD_MESSAGES = 120;
type Msg = Anthropic.Beta.Messages.BetaMessageParam;
type Client = { beta: { messages: { create: (body: Record<string, unknown>) => Promise<Anthropic.Beta.Messages.BetaMessage> } } };
let clientOverride: Client | null = null;
/** Test seam: inject a fake model client (MOCK-ONLY tests). */
export function __setAgentClient(c: Client | null) { clientOverride = c; }
function client(): Client {
  if (clientOverride) return clientOverride;
  if (!aiConfigured()) throw invalid("AI isn't configured. An administrator must set ANTHROPIC_API_KEY in the deployment environment.");
  return new Anthropic() as unknown as Client;
}

// ───────── Agent CRUD ─────────
export async function listAgents(ctx: Ctx, baseId: string) {
  await baseAccess(ctx, baseId);
  return db.select().from(baseAgents).where(and(eq(baseAgents.baseId, baseId), eq(baseAgents.orgId, ctx.orgId), isNull(baseAgents.archivedAt))).orderBy(asc(baseAgents.createdAt));
}
export async function saveAgent(ctx: Ctx, baseId: string, input: { id?: string; name: string; emoji?: string; color?: string; role?: string; instructions: string; tableIds: string[]; canPropose: boolean; provider?: string }) {
  requireRole(await baseAccess(ctx, baseId), "creator", "manage agents");
  if (!input.name?.trim()) throw invalid("Name the agent.");
  if ((input.instructions ?? "").length > 8000) throw invalid("Keep instructions under 8,000 characters.");
  const tables = await db.select({ id: baseTables.id }).from(baseTables).where(and(eq(baseTables.baseId, baseId), isNull(baseTables.archivedAt)));
  const tableIds = (input.tableIds ?? []).filter((t) => tables.some((x) => x.id === t));
  const values = { name: input.name.trim().slice(0, 60), emoji: (input.emoji || "🤖").slice(0, 4), color: input.color || "blue", role: input.role?.slice(0, 120) || null, instructions: input.instructions ?? "", tableIds, canPropose: !!input.canPropose, provider: input.provider === "chatgpt" ? "chatgpt" : "claude", updatedAt: new Date() };
  if (input.id) {
    const [row] = await db.update(baseAgents).set(values).where(and(eq(baseAgents.id, input.id), eq(baseAgents.baseId, baseId), eq(baseAgents.orgId, ctx.orgId))).returning();
    if (!row) throw notFound(); await audit(db, ctx, "update_agent", "base_agents", row.id, { meta: { name: row.name } }); return row;
  }
  const [row] = await db.insert(baseAgents).values({ ...values, orgId: ctx.orgId, baseId, createdBy: ctx.userId }).returning();
  await audit(db, ctx, "create_agent", "base_agents", row.id, { meta: { name: row.name } });
  return row;
}
export async function deleteAgent(ctx: Ctx, id: string) {
  const [a] = await db.select().from(baseAgents).where(and(eq(baseAgents.id, id), eq(baseAgents.orgId, ctx.orgId))).limit(1);
  if (!a) throw notFound();
  requireRole(await baseAccess(ctx, a.baseId), "creator", "manage agents");
  await db.update(baseAgents).set({ archivedAt: new Date() }).where(eq(baseAgents.id, id));
  await audit(db, ctx, "delete_agent", "base_agents", id, { meta: { name: a.name } });
}

async function agentContext(ctx: Ctx, agentId: string) {
  const [agent] = await db.select().from(baseAgents).where(and(eq(baseAgents.id, agentId), eq(baseAgents.orgId, ctx.orgId), isNull(baseAgents.archivedAt))).limit(1);
  if (!agent) throw notFound("Agent not found.");
  const { role } = await baseAccess(ctx, agent.baseId);
  const all = await db.select().from(baseTables).where(and(eq(baseTables.baseId, agent.baseId), isNull(baseTables.archivedAt)));
  const tables = agent.tableIds.length ? all.filter((t) => agent.tableIds.includes(t.id)) : all;
  return { agent, role, tables };
}

// ───────── Threads ─────────
export async function listThreads(ctx: Ctx, agentId: string) {
  await agentContext(ctx, agentId);
  return db.select().from(agentThreads).where(and(eq(agentThreads.agentId, agentId), eq(agentThreads.userId, ctx.userId))).orderBy(desc(agentThreads.updatedAt)).limit(50);
}
export type ChatItem = { id: string; kind: "user" | "assistant" | "activity"; text: string };
export async function getThread(ctx: Ctx, threadId: string) {
  const [t] = await db.select().from(agentThreads).where(and(eq(agentThreads.id, threadId), eq(agentThreads.orgId, ctx.orgId))).limit(1);
  if (!t || t.userId !== ctx.userId) throw notFound("Conversation not found.");
  const { agent } = await agentContext(ctx, t.agentId);
  const msgs = await db.select().from(agentMessages).where(eq(agentMessages.threadId, threadId)).orderBy(asc(agentMessages.createdAt));
  const items: ChatItem[] = [];
  for (const m of msgs) {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as { type: string; text?: string; name?: string; input?: Record<string, unknown> }[]);
    for (const [i, b] of blocks.entries()) {
      if (m.role === "user" && b.type === "text") items.push({ id: `${m.id}:${i}`, kind: "user", text: b.text ?? "" });
      else if (m.role === "assistant" && b.type === "text" && b.text?.trim()) items.push({ id: `${m.id}:${i}`, kind: "assistant", text: b.text });
      else if (m.role === "assistant" && b.type === "tool_use") items.push({ id: `${m.id}:${i}`, kind: "activity", text: describeTool(b.name ?? "", b.input ?? {}) });
    }
  }
  const proposals = await db.select().from(baseApprovals).where(and(eq(baseApprovals.threadId, threadId), eq(baseApprovals.orgId, ctx.orgId))).orderBy(asc(baseApprovals.createdAt));
  return { thread: t, agent, items, proposals: proposals.map((p) => ({ id: p.id, kind: p.kind, summary: p.summary, status: p.status, result: p.result })) };
}
function describeTool(name: string, input: Record<string, unknown>) {
  if (name === "search_records") return `Searched ${input.table}${input.query ? ` for “${input.query}”` : ""}`;
  if (name === "get_record") return `Opened a record in ${input.table}`;
  if (name === "list_tables") return "Looked at the base structure";
  if (name === "list_connected_apps") return "Checked your connected apps";
  if (name === "list_app_actions") return `Looked up what it can do in ${input.app}`;
  if (name === "use_app") return isReadTool(String(input.action ?? "")) ? `Read from ${String(input.action).split("_")[0].toLowerCase()} (${input.action})` : `Proposed app action ${input.action} — waiting for your approval`;
  if (name.startsWith("propose_")) return `Proposed: ${name.replace("propose_", "").replace("_", " ")} — waiting for your approval`;
  return name;
}

// ───────── Tools ─────────
const pairs = { type: "array", items: { type: "object", properties: { field: { type: "string" }, value: { type: "string" } }, required: ["field", "value"], additionalProperties: false } };
function toolDefs(canPropose: boolean, apps = false): Anthropic.Beta.Messages.BetaTool[] {
  const t = (name: string, description: string, properties: Record<string, unknown>, required: string[]): Anthropic.Beta.Messages.BetaTool =>
    ({ name, description, strict: true, input_schema: { type: "object", properties, required, additionalProperties: false } }) as Anthropic.Beta.Messages.BetaTool;
  const read = [
    t("list_tables", "List the tables you can use, with their fields, field types and select options.", {}, []),
    t("search_records", "Find records in a table. Returns up to `limit` rows (max 25) with ids and field values as text. Use an empty query to list.", { table: { type: "string" }, query: { type: "string" }, limit: { type: "integer" } }, ["table", "query", "limit"]),
    t("get_record", "Get every visible field of one record.", { table: { type: "string" }, record_id: { type: "string" } }, ["table", "record_id"]),
  ];
  const appTools = apps ? [
    t("list_connected_apps", "List the outside apps (Gmail, Slack, HubSpot…) the person you're talking with has connected.", {}, []),
    t("list_app_actions", "List the actions available for one connected app (by its slug from list_connected_apps). Read actions run immediately; others need the person's approval.", { app: { type: "string" } }, ["app"]),
    t("use_app", "Run an app action with the person's own connected account. `arguments` is a JSON object as a string, matching the action's parameters. Read-only actions (list/get/search/fetch) run now; anything that sends, creates, changes or deletes is filed for the person's approval instead.", { action: { type: "string" }, arguments: { type: "string" }, reason: { type: "string" } }, ["action", "arguments", "reason"]),
  ] : [];
  if (!canPropose) return [...read, ...appTools];
  return [...read, ...appTools,
    t("propose_create_record", "Propose creating a record. It is NOT created until the user approves. Values are field name → text.", { table: { type: "string" }, values: pairs, reason: { type: "string" } }, ["table", "values", "reason"]),
    t("propose_update_record", "Propose changing fields on a record. It is NOT changed until the user approves.", { table: { type: "string" }, record_id: { type: "string" }, values: pairs, reason: { type: "string" } }, ["table", "record_id", "values", "reason"]),
    t("propose_comment", "Propose adding a comment to a record. It is NOT posted until the user approves.", { record_id: { type: "string" }, body: { type: "string" } }, ["record_id", "body"]),
  ];
}

type ToolCtx = { ctx: Ctx; role: string; agent: typeof baseAgents.$inferSelect; tables: (typeof baseTables.$inferSelect)[]; threadId: string };
async function runTool(tc: ToolCtx, name: string, input: Record<string, unknown>): Promise<string> {
  const table = (n: unknown) => { const t = tc.tables.find((x) => x.name.toLowerCase() === String(n ?? "").toLowerCase() || x.id === n); if (!t) throw invalid(`No table “${n}” is available to you. Call list_tables.`); return t; };
  const fieldsFor = async (tableId: string) => (await runView(tc.ctx, tc.role, tableId, {}, { recordIds: [] })).fields;
  const toValues = (fields: FieldDefLite[], pairsIn: unknown) => {
    const out: Record<string, unknown> = {}; const errors: string[] = [];
    for (const { field, value } of (pairsIn as { field: string; value: string }[]) ?? []) {
      const f = fields.find((x) => x.name.toLowerCase() === String(field).toLowerCase());
      if (!f) { errors.push(`unknown field “${field}”`); continue; }
      if (isComputed(f.type) || ["link", "user", "attachment", "button"].includes(f.type)) { errors.push(`“${f.name}” can't be set directly`); continue; }
      const v = f.type === "multipleSelects" ? value.split(",").map((s) => s.trim()).filter(Boolean) : value === "" ? null : value;
      try { coerceValue(f, v); out[f.id] = v; } catch (e) { errors.push((e as Error).message); }
    }
    if (errors.length) throw invalid(`Not proposed: ${errors.join("; ")}`);
    if (!Object.keys(out).length) throw invalid("No values to propose.");
    return out;
  };
  if (name === "list_tables") {
    const out = [];
    for (const t of tc.tables) { const fs = await fieldsFor(t.id); out.push(`# ${t.name}\n${fs.map((f) => `- ${f.name} (${f.type}${f.options.choices?.length ? `: ${f.options.choices.map((c) => c.name).join(" | ")}` : ""})`).join("\n")}`); }
    return out.join("\n\n");
  }
  if (name === "search_records" || name === "get_record") {
    const t = table(input.table);
    const v = await runView(tc.ctx, tc.role, t.id, {}, name === "get_record" ? { recordIds: [String(input.record_id)] } : { search: String(input.query ?? "") });
    const limit = name === "get_record" ? 1 : Math.min(Math.max(Number(input.limit) || 10, 1), 25);
    if (!v.rows.length) return name === "get_record" ? "Record not found (or not visible to this user)." : "No matching records.";
    return `${v.rows.length} match(es)${v.rows.length > limit ? `, showing ${limit}` : ""}:\n` + v.rows.slice(0, limit).map((r) => `- id ${r.id}: ${v.fields.map((f) => `${f.name}: ${cellText(f, r.values[f.id]) || "—"}`).join("; ")}`).join("\n");
  }
  if (name === "list_connected_apps") {
    const cs = (await myConnections(tc.ctx)).filter((c) => c.status === "ACTIVE");
    return cs.length ? `Connected apps: ${[...new Set(cs.map((c) => c.toolkit))].join(", ")}` : "The person hasn't connected any apps yet. They can connect them in Settings → Connected apps.";
  }
  if (name === "list_app_actions") {
    const tools = await listAppTools(String(input.app ?? ""));
    return tools.slice(0, 60).map((x) => `- ${x.slug}${x.readOnly ? " (read)" : " (needs approval)"}: ${x.description.slice(0, 160)}`).join("\n") || "No actions found for that app.";
  }
  if (name === "use_app") {
    const action = String(input.action ?? ""); let args: Record<string, unknown> = {};
    try { args = input.arguments ? JSON.parse(String(input.arguments)) : {}; } catch { throw invalid("`arguments` must be a JSON object string."); }
    if (isReadTool(action)) { const data = await runAppTool(tc.ctx, action, args); return JSON.stringify(data).slice(0, 12_000); }
    if (!tc.agent.canPropose) return "This agent is read-only, so it can't ask to run app actions that send or change things. Explain what you would do instead.";
    const a = await fileApproval({ orgId: tc.ctx.orgId, baseId: tc.agent.baseId, source: "agent", sourceId: tc.agent.id, threadId: tc.threadId, requestedBy: tc.ctx.userId, kind: "app_action", payload: { action, arguments: args }, summary: `${action}: ${String(input.reason ?? "").slice(0, 200)} — runs with your connected account` });
    return `Proposal ${a.id} filed. Only the person you're talking with can approve it, because it uses their own connected account.`;
  }
  if (!tc.agent.canPropose) throw forbidden("This agent is read-only.");
  if (!atLeast(tc.role, "editor")) return "The user has read/comment access only, so changes can't be proposed on their behalf. Explain what you would change instead.";
  const base = { orgId: tc.ctx.orgId, baseId: tc.agent.baseId, source: "agent" as const, sourceId: tc.agent.id, threadId: tc.threadId, requestedBy: tc.ctx.userId };
  if (name === "propose_create_record") {
    const t = table(input.table); const fs = await fieldsFor(t.id); const values = toValues(fs, input.values);
    const a = await fileApproval({ ...base, kind: "create_record", payload: { tableId: t.id, values }, summary: `Create in ${t.name}: ${Object.entries(values).map(([k, v]) => `${fs.find((f) => f.id === k)?.name} = ${String(v)}`).join(", ").slice(0, 300)} — ${String(input.reason ?? "")}` });
    return `Proposal ${a.id} filed. Tell the user it is waiting for their approval.`;
  }
  if (name === "propose_update_record") {
    const t = table(input.table); const fs = await fieldsFor(t.id);
    const exists = await runView(tc.ctx, tc.role, t.id, {}, { recordIds: [String(input.record_id)] });
    if (!exists.rows.length) throw invalid("That record doesn't exist in this table.");
    const values = toValues(fs, input.values);
    const title = cellText(fs[0], exists.rows[0].values[fs[0].id]);
    const a = await fileApproval({ ...base, kind: "update_record", payload: { recordId: String(input.record_id), values }, summary: `Update “${title}” in ${t.name}: ${Object.entries(values).map(([k, v]) => `${fs.find((f) => f.id === k)?.name} → ${String(v)}`).join(", ").slice(0, 300)} — ${String(input.reason ?? "")}` });
    return `Proposal ${a.id} filed. Tell the user it is waiting for their approval.`;
  }
  if (name === "propose_comment") {
    const body = String(input.body ?? "").trim(); if (!body) throw invalid("Empty comment.");
    let found = false;
    for (const t of tc.tables) if ((await runView(tc.ctx, tc.role, t.id, {}, { recordIds: [String(input.record_id)] })).rows.length) { found = true; break; }
    if (!found) throw invalid("That record isn't in a table you can use.");
    const a = await fileApproval({ ...base, kind: "add_comment", payload: { recordId: String(input.record_id), body }, summary: `Comment: “${body.slice(0, 200)}”` });
    return `Proposal ${a.id} filed. Tell the user it is waiting for their approval.`;
  }
  throw invalid(`Unknown tool ${name}`);
}

function systemPrompt(agent: typeof baseAgents.$inferSelect, tables: { name: string }[], user: Ctx, apps = false) {
  return [
    `You are “${agent.name}”${agent.role ? `, ${agent.role}` : ""}, an AI teammate inside the user's business workspace. You are talking with ${user.name}.`,
    agent.instructions ? `Your instructions from the workspace:\n${agent.instructions}` : "",
    `Tables you can use: ${tables.map((t) => t.name).join(", ")}.`,
    "Ground every statement in records you have looked up with your tools; name the records you used. Never invent figures, names, dates, prices or terms — if data is missing, say so.",
    agent.canPropose ? "You cannot change data directly. To change anything, call a propose_ tool; the user approves or rejects it. Propose only what the user asked for or clearly agreed to." : "You are read-only: explain what should change rather than proposing changes.",
    apps ? "You can read from the person's connected apps. Anything that sends, creates, changes or deletes in an outside app is only a proposal the person must approve. Never move money, sign contracts or message people without that approval." : "You only work inside this app: you can't send emails or messages, contact people, move money, sign or send contracts.",
    "Be concise and practical. Use short lists for multiple items.",
  ].filter(Boolean).join("\n\n");
}

/** Send a user message and run the agent loop. Returns the thread id. */
export async function sendAgentMessage(ctx: Ctx, agentId: string, threadId: string | null, text: string) {
  const { agent, role, tables } = await agentContext(ctx, agentId);
  const body = text.trim();
  if (!body || body.length > 8000) throw invalid("Messages must be 1–8,000 characters.");
  let tid = threadId;
  if (tid) {
    const [t] = await db.select().from(agentThreads).where(and(eq(agentThreads.id, tid), eq(agentThreads.agentId, agentId))).limit(1);
    if (!t || t.userId !== ctx.userId) throw notFound("Conversation not found.");
  } else {
    const [t] = await db.insert(agentThreads).values({ orgId: ctx.orgId, agentId, userId: ctx.userId, title: body.slice(0, 80) }).returning();
    tid = t.id;
  }
  const history = await db.select().from(agentMessages).where(eq(agentMessages.threadId, tid)).orderBy(asc(agentMessages.createdAt));
  if (history.length >= MAX_THREAD_MESSAGES) throw invalid("This conversation is full — start a new one.");
  const messages: Msg[] = history.map((m) => ({ role: m.role, content: m.content }) as Msg);
  const save = async (m: Msg) => { messages.push(m); await db.insert(agentMessages).values({ orgId: ctx.orgId, threadId: tid!, role: m.role, content: m.content as unknown }); };
  await save({ role: "user", content: [{ type: "text", text: body }] });
  const apps = composioConfigured();
  const tools = toolDefs(agent.canPropose, apps);
  const tc: ToolCtx = { ctx, role, agent, tables, threadId: tid };
  const system = systemPrompt(agent, tables, ctx, apps);
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = agent.provider === "chatgpt" ? await chatgptTurn(ctx, system, tools, messages) : await client().beta.messages.create({
      model: MODEL, max_tokens: 16000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "medium" }, system, tools, messages,
    });
    await save({ role: "assistant", content: res.content } as unknown as Msg);
    if (res.stop_reason === "refusal") break;
    if (res.stop_reason === "pause_turn") continue;
    const uses = res.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) break;
    const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      try { results.push({ type: "tool_result", tool_use_id: u.id, content: await runTool(tc, u.name, (u.input ?? {}) as Record<string, unknown>) }); }
      catch (e) { results.push({ type: "tool_result", tool_use_id: u.id, content: String((e as Error).message ?? e).slice(0, 1000), is_error: true }); }
    }
    await save({ role: "user", content: results });
  }
  await db.update(agentThreads).set({ updatedAt: new Date() }).where(eq(agentThreads.id, tid));
  return { threadId: tid };
}

/**
 * One agent step on the chatting person's ChatGPT plan (Responses API). The transcript is stored in one
 * format (text / tool_use / tool_result blocks) and translated each turn, so agents can switch provider.
 */
async function chatgptTurn(ctx: Ctx, system: string, tools: Anthropic.Beta.Messages.BetaTool[], messages: Msg[]) {
  const input: Record<string, unknown>[] = [];
  for (const m of messages) {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as unknown as Record<string, unknown>[]);
    for (const b of blocks) {
      if (b.type === "text" && String(b.text ?? "").trim()) input.push({ role: m.role, content: String(b.text) });
      else if (b.type === "tool_use") input.push({ type: "function_call", call_id: String(b.id), name: String(b.name), arguments: JSON.stringify(b.input ?? {}) });
      else if (b.type === "tool_result") input.push({ type: "function_call_output", call_id: String(b.tool_use_id), output: typeof b.content === "string" ? b.content : JSON.stringify(b.content) });
    }
  }
  const r = await chatgptResponses(ctx, {
    instructions: system, input, parallel_tool_calls: false,
    tools: tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: (t as { input_schema: unknown }).input_schema, strict: true })),
  });
  const content: Record<string, unknown>[] = [];
  for (const o of r.output ?? []) {
    if (o.type === "message") for (const c of (o as { content?: { type: string; text?: string }[] }).content ?? []) { if (c.type === "output_text" && c.text) content.push({ type: "text", text: c.text }); }
    else if (o.type === "function_call") { const f = o as { call_id: string; name: string; arguments: string }; let args: unknown = {}; try { args = JSON.parse(f.arguments || "{}"); } catch { /* keep empty */ } content.push({ type: "tool_use", id: f.call_id, name: f.name, input: args }); }
  }
  if (!content.length) content.push({ type: "text", text: "(No reply.)" });
  return { content, stop_reason: content.some((c) => c.type === "tool_use") ? "tool_use" : "end_turn" } as unknown as Anthropic.Beta.Messages.BetaMessage;
}
