/**
 * Composio app connections and Sign in with ChatGPT — MOCK-ONLY: every outside call goes to a fake
 * fetcher (no real Composio / OpenAI traffic). Verifies scoping (connections are personal), the
 * read-vs-approval rule for agent app actions, PKCE + state checks, encrypted token storage, and an
 * agent turn on the ChatGPT plan through the Responses API shape.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { closeDb, db } from "@/db";
import { baseApprovals, memberships, userConnections } from "@/db/schema";
import { contextForUser } from "@/server/auth/sessions";
import { createBaseFromSpec } from "@/server/platform/spec";
import * as C from "@/server/integrations/composio";
import * as G from "@/server/integrations/chatgpt";
import { saveAgent, sendAgentMessage, __setAgentClient } from "@/server/platform/agents";
import { decideApproval } from "@/server/platform/approvals";
import type { Ctx } from "@/server/auth/context";
import { makeOrg, makeUser } from "../support/factory";

let owner: Ctx; let editor: Ctx; let baseId: string;
const asRole = async (ctx: Ctx, role: string) => { await db.update(memberships).set({ platformRole: role }).where(and(eq(memberships.userId, ctx.userId), eq(memberships.orgId, ctx.orgId))); return (await contextForUser(ctx.userId, ctx.orgId))!; };
const calls: { url: string; method: string; body: unknown }[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

beforeAll(async () => {
  process.env.COMPOSIO_API_KEY = "test-not-real"; process.env.ANTHROPIC_API_KEY ??= "test-not-real";
  process.env.OPENAI_SIWC_CLIENT_ID = "test-client"; process.env.SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  const org = await makeOrg("Connectors");
  owner = await asRole(await makeUser(org.id, "org_admin"), "owner");
  editor = await asRole(await makeUser(org.id, "production_manager"), "editor");
  baseId = (await createBaseFromSpec(owner, { name: "CRM", tables: [{ name: "Deals", fields: [{ name: "Deal", type: "singleLineText" }], records: [{ Deal: "Acme" }] }] })).baseId;
  C.__setComposioFetcher(async (url, init) => {
    const u = new URL(url); const method = init?.method ?? "GET"; const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u.pathname + u.search, method, body });
    if (u.pathname.endsWith("/toolkits")) return json({ items: [{ slug: "gmail", name: "Gmail", meta: { logo: "https://cdn.example/gmail.svg", description: "Mail", categories: [{ name: "Email" }] } }] });
    if (u.pathname.endsWith("/auth_configs") && method === "GET") return json({ items: [] });
    if (u.pathname.endsWith("/auth_configs") && method === "POST") return json({ auth_config: { id: "ac_1" } });
    if (u.pathname.endsWith("/connected_accounts/link")) return json({ redirect_url: "https://connect.composio.dev/link/abc" });
    if (u.pathname.endsWith("/connected_accounts") && method === "GET") return json({ items: u.searchParams.get("user_ids") === C.composioUserId(editor) ? [{ id: "ca_ed", status: "ACTIVE", toolkit: { slug: "gmail" } }] : [] });
    if (u.pathname.includes("/connected_accounts/") && method === "DELETE") return json({ ok: true });
    if (u.pathname.endsWith("/tools")) return json({ items: [{ slug: "GMAIL_FETCH_EMAILS", name: "Fetch emails" }, { slug: "GMAIL_SEND_EMAIL", name: "Send email" }] });
    if (u.pathname.includes("/tools/execute/")) return json({ successful: true, data: { messages: [{ id: "m1", subject: "Hello", from_address: "a@b.c" }, { id: "m2", subject: "Invoice", from_address: "d@e.f" }] } });
    return json({ error: { message: "unexpected" } }, 404);
  });
});
afterAll(async () => { C.__setComposioFetcher(null); G.__setChatgptFetcher(null); __setAgentClient(null); delete process.env.COMPOSIO_API_KEY; delete process.env.OPENAI_SIWC_CLIENT_ID; await closeDb(); });

describe("Composio app connections (MOCK-ONLY)", () => {
  it("catalogue carries logos and categories; connect uses a managed auth config and the person's own scoped user id", async () => {
    const { apps, live } = await C.listApps();
    expect(live).toBe(true); expect(apps[0]).toMatchObject({ slug: "gmail", logo: "https://cdn.example/gmail.svg", categories: ["Email"] });
    const r = await C.connectApp(editor, "gmail", "https://app.example/workspace/settings?tab=apps");
    expect(r.url).toBe("https://connect.composio.dev/link/abc");
    const link = calls.find((c) => c.url.endsWith("/connected_accounts/link"))!;
    expect(link.body).toMatchObject({ user_id: `bangon:${editor.orgId}:${editor.userId}`, auth_config_id: "ac_1" });
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/auth_configs"))).toBe(true);
    await expect(C.connectApp(editor, "../evil", "x")).rejects.toThrow(/Unknown app/);
  });
  it("connections are personal: others can't see or disconnect them", async () => {
    expect((await C.myConnections(editor)).map((c) => c.id)).toEqual(["ca_ed"]);
    expect(await C.myConnections(owner)).toEqual([]);
    await expect(C.disconnectApp(owner, "ca_ed")).rejects.toThrow(/isn't yours/);
  });
  it("read actions are recognised; data flattens into importable rows", async () => {
    expect(C.isReadTool("GMAIL_FETCH_EMAILS")).toBe(true);
    expect(C.isReadTool("GMAIL_SEND_EMAIL")).toBe(false);
    expect(C.isReadTool("HUBSPOT_LIST_AND_DELETE_CONTACTS")).toBe(false);
    const rows = C.rowsFrom(await C.runAppTool(editor, "GMAIL_FETCH_EMAILS", { max_results: 2 }));
    const f = C.flattenRows(rows);
    expect(f.cols).toEqual(["Id", "Subject", "From Address"]); expect(f.rows[1].Subject).toBe("Invoice");
  });
  it("agents read from apps directly but app actions that send need the requester's own approval", async () => {
    const agent = await saveAgent(owner, baseId, { name: "Inbox helper", instructions: "", tableIds: [], canPropose: true });
    let turn = 0;
    __setAgentClient({ beta: { messages: { create: async () => {
      turn++;
      if (turn === 1) return { content: [{ type: "tool_use", id: "t1", name: "use_app", input: { action: "GMAIL_FETCH_EMAILS", arguments: "{}", reason: "check inbox" } }], stop_reason: "tool_use" } as never;
      if (turn === 2) return { content: [{ type: "tool_use", id: "t2", name: "use_app", input: { action: "GMAIL_SEND_EMAIL", arguments: "{\"to\":\"x@y.z\"}", reason: "reply to Acme" } }], stop_reason: "tool_use" } as never;
      return { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" } as never;
    } } } });
    const before = calls.filter((c) => c.url.includes("/tools/execute/")).length;
    const { threadId } = await sendAgentMessage(editor, agent.id, null, "Reply to Acme");
    const executed = calls.filter((c) => c.url.includes("/tools/execute/")).slice(before).map((c) => c.url);
    expect(executed).toEqual(["/api/v3/tools/execute/GMAIL_FETCH_EMAILS"]); // the send did NOT run
    const [ap] = await db.select().from(baseApprovals).where(and(eq(baseApprovals.threadId, threadId), eq(baseApprovals.kind, "app_action")));
    expect(ap.status).toBe("pending");
    await expect(decideApproval(owner, ap.id, true)).rejects.toThrow(/connected account/);
    await decideApproval(editor, ap.id, true);
    expect(calls.at(-1)!.url).toBe("/api/v3/tools/execute/GMAIL_SEND_EMAIL");
    expect(calls.at(-1)!.body).toMatchObject({ user_id: C.composioUserId(editor), arguments: { to: "x@y.z" } });
  });
});

describe("Sign in with ChatGPT (MOCK-ONLY)", () => {
  it("PKCE S256 + state; tokens stored encrypted; agents run on the person's plan via the Responses API", async () => {
    const seen: { url: string; body: string; auth?: string }[] = [];
    G.__setChatgptFetcher(async (url, init) => {
      seen.push({ url, body: String(init?.body ?? ""), auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      if (url.includes("openid-configuration")) return new Response("nope", { status: 503 });
      if (url.endsWith("/oauth/token")) return json({ access_token: "at-secret-123", refresh_token: "rt-secret", expires_in: 3600, id_token: `x.${Buffer.from(JSON.stringify({ email: "kieran@example.com" })).toString("base64url")}.y` });
      if (url.endsWith("/responses")) {
        const b = JSON.parse(String(init?.body));
        if (!b.input.some((i: { type?: string }) => i.type === "function_call_output")) return json({ output: [{ type: "function_call", call_id: "c1", name: "search_records", arguments: JSON.stringify({ table: "Deals", query: "", limit: 5 }) }] });
        return json({ output: [{ type: "message", content: [{ type: "output_text", text: "You have one deal: Acme." }] }] });
      }
      return new Response("?", { status: 404 });
    });
    const s = await G.startChatgptConnect("https://app.example/api/connect/chatgpt/callback");
    const u = new URL(s.url);
    expect(u.origin + u.pathname).toBe("https://auth.openai.com/api/accounts/authorize"); // documented fallback when discovery is unavailable
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe(s.state);
    await expect(G.finishChatgptConnect(editor, { code: "c", state: "forged", expectedState: s.state, verifier: s.verifier, redirectUri: "x" })).rejects.toThrow(/expired or was tampered/);
    const r = await G.finishChatgptConnect(editor, { code: "c", state: s.state, expectedState: s.state, verifier: s.verifier, redirectUri: "https://app.example/api/connect/chatgpt/callback" });
    expect(r.account).toBe("kieran@example.com");
    expect(seen.find((x) => x.url.endsWith("/oauth/token"))!.body).toContain(`code_verifier=${s.verifier}`);
    const [row] = await db.select().from(userConnections).where(eq(userConnections.userId, editor.userId));
    expect(row.accessTokenEnc).not.toContain("at-secret-123");

    const agent = await saveAgent(owner, baseId, { name: "GPT analyst", instructions: "", tableIds: [], canPropose: false, provider: "chatgpt" });
    const { threadId } = await sendAgentMessage(editor, agent.id, null, "What deals do we have?");
    const resp = seen.filter((x) => x.url.endsWith("/responses"));
    expect(resp).toHaveLength(2);
    expect(resp[0].auth).toBe("Bearer at-secret-123");
    expect(JSON.parse(resp[1].body).input.some((i: { type?: string; output?: string }) => i.type === "function_call_output" && i.output?.includes("Acme"))).toBe(true);
    expect(threadId).toBeTruthy();
    // someone without a connection gets a clear message, not a silent fallback to the workspace key
    await expect(sendAgentMessage(owner, agent.id, null, "Hi")).rejects.toThrow(/Connect your ChatGPT plan/);
    await G.disconnectChatgpt(editor);
    expect(await G.chatgptConnection(editor)).toBeNull();
  });
});
