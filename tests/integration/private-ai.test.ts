/**
 * Private AI (MOCK-ONLY model server speaking the OpenAI-compatible chat-completions API, like Ollama /
 * vLLM): every AI feature routes to the local model, structured output is schema-constrained and
 * validated, agents run their tool loop on it, and anything that would reach a public service is refused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { memberships } from "@/db/schema";
import { contextForUser } from "@/server/auth/sessions";
import { createBaseFromSpec } from "@/server/platform/spec";
import { __setLocalAiFetcher, aiProvider } from "@/server/platform/local-ai";
import { generateAiCell, generateAiText, generateBaseSpec, __setAiClient } from "@/server/platform/ai";
import { ensureAssistant, getThread, sendAgentMessage, __setAgentClient } from "@/server/platform/agents";
import { chatgptStatusReason } from "@/server/integrations/chatgpt";
import type { Ctx } from "@/server/auth/context";
import { makeOrg, makeUser } from "../support/factory";

const saved = { ...process.env };
const seen: Record<string, unknown>[] = [];
let reply: (body: Record<string, unknown>) => unknown = () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
let owner: Ctx; let baseId: string;
beforeAll(async () => {
  __setAiClient(null); __setAgentClient(null);
  delete process.env.ANTHROPIC_API_KEY;
  process.env.AI_PROVIDER = "local"; process.env.LOCAL_AI_BASE_URL = "http://models.internal:11434/v1"; process.env.LOCAL_AI_MODEL = "qwen2.5:14b";
  __setLocalAiFetcher(async (url, init) => { const body = JSON.parse(String(init?.body)); seen.push({ url, ...body }); return new Response(JSON.stringify(reply(body)), { status: 200, headers: { "Content-Type": "application/json" } }); });
  const org = await makeOrg("PrivateAI");
  const u = await makeUser(org.id, "org_admin"); await db.update(memberships).set({ platformRole: "owner" }).where(and(eq(memberships.userId, u.userId), eq(memberships.orgId, org.id)));
  owner = (await contextForUser(u.userId, org.id))!;
  baseId = (await createBaseFromSpec(owner, { name: "Ops", tables: [{ name: "Tasks", fields: [{ name: "Task", type: "singleLineText" }], records: [{ Task: "Ship it" }] }] })).baseId;
});
afterAll(async () => { __setLocalAiFetcher(null); process.env = saved; await closeDb(); });

describe("private AI (local OpenAI-compatible model, MOCK-ONLY)", () => {
  it("selects the local provider and sends prompts only to the configured server", async () => {
    expect(aiProvider()).toBe("local");
    reply = () => ({ choices: [{ message: { content: "A crisp logline." }, finish_reason: "stop" }] });
    expect(await generateAiText("Write a logline")).toBe("A crisp logline.");
    expect(seen.at(-1)).toMatchObject({ url: "http://models.internal:11434/v1/chat/completions", model: "qwen2.5:14b" });
  });
  it("structured output is requested with the JSON schema and validated", async () => {
    reply = (b) => { expect((b.response_format as { type: string }).type).toBe("json_schema"); return { choices: [{ message: { content: JSON.stringify({ name: "CRM", icon: "briefcase", color: "blue", description: "", tables: [{ name: "Clients", description: "", fields: [{ name: "Name", type: "singleLineText", choices: [], linkTo: "", via: "", target: "", fn: "", formula: "" }], sampleRows: [], views: [] }] }) }, finish_reason: "stop" }] }; };
    const spec = await generateBaseSpec("A small CRM for an agency");
    expect(spec.tables[0].name).toBe("Clients");
    reply = () => ({ choices: [{ message: { content: "not json" }, finish_reason: "stop" }] });
    await expect(generateBaseSpec("A small CRM for an agency")).rejects.toThrow(/structured output/);
  });
  it("the assistant runs its tool loop on the local model", async () => {
    let n = 0;
    reply = (b) => { n++; const msgs = b.messages as { role: string }[];
      if (!msgs.some((m) => m.role === "tool")) return { choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "list_tables", arguments: "{}" } }] }, finish_reason: "tool_calls" }] };
      return { choices: [{ message: { content: "This base has a Tasks table." }, finish_reason: "stop" }] }; };
    const { agent } = await ensureAssistant(owner, baseId);
    const { threadId } = await sendAgentMessage(owner, agent.id, null, "What's in this base?");
    const t = await getThread(owner, threadId);
    expect(n).toBe(2);
    expect(t.items.at(-1)?.text).toBe("This base has a Tasks table.");
    const toolMsg = (seen.at(-1)!.messages as { role: string; content: string }[]).find((m) => m.role === "tool")!;
    expect(toolMsg.content).toContain("# Tasks");
  });
  it("refuses anything that would reach a public service", async () => {
    await expect(generateAiCell("Research Acme", "research")).rejects.toThrow(/Web research isn't available with the private AI/);
    await expect(generateAiCell("Read it", "analyze", [{ type: "application/pdf", bytes: Buffer.from("%PDF"), name: "a.pdf" }])).rejects.toThrow(/PDFs isn't available/);
    expect(chatgptStatusReason()).toMatch(/private AI only/);
  });
  it("AI_PROVIDER=off disables AI even with keys present", async () => {
    process.env.AI_PROVIDER = "off"; process.env.ANTHROPIC_API_KEY = "x";
    expect(aiProvider()).toBe("off");
    process.env.AI_PROVIDER = "local"; delete process.env.ANTHROPIC_API_KEY;
  });
});
