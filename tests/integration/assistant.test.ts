/**
 * The always-available assistant (MOCK-ONLY model client): one per base, invisible in the agent roster,
 * sees only the base it's opened in, reads with the person's own role, and every change — records or
 * structure — is a proposal applied with the person's (or, for structure, a creator's) permissions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { baseApprovals, baseFields, memberships } from "@/db/schema";
import { contextForUser } from "@/server/auth/sessions";
import { createBaseFromSpec } from "@/server/platform/spec";
import { updateBase } from "@/server/platform/schema";
import { ensureAssistant, listAgents, sendAgentMessage, __setAgentClient } from "@/server/platform/agents";
import { decideApproval } from "@/server/platform/approvals";
import { runView } from "@/server/platform/query";
import type { Ctx } from "@/server/auth/context";
import { makeOrg, makeUser } from "../support/factory";

let owner: Ctx; let editor: Ctx; let reader: Ctx; let baseA: string; let baseB: string; let tasks: string;
const asRole = async (ctx: Ctx, role: string) => { await db.update(memberships).set({ platformRole: role }).where(and(eq(memberships.userId, ctx.userId), eq(memberships.orgId, ctx.orgId))); return (await contextForUser(ctx.userId, ctx.orgId))!; };
let script: { name: string; input: Record<string, unknown> }[] = [];
const outputs: string[] = [];
beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY ??= "test-not-real";
  const org = await makeOrg("Assistant");
  owner = await asRole(await makeUser(org.id, "org_admin"), "owner");
  editor = await asRole(await makeUser(org.id, "production_manager"), "editor");
  reader = await asRole(await makeUser(org.id, "crew"), "reader");
  const a = await createBaseFromSpec(owner, { name: "Ops", tables: [{ name: "Tasks", fields: [{ name: "Task", type: "singleLineText" }], records: [{ Task: "Ship it" }] }] });
  baseA = a.baseId; tasks = a.tableIds.Tasks;
  baseB = (await createBaseFromSpec(owner, { name: "Finance", tables: [{ name: "Invoices", fields: [{ name: "Invoice", type: "singleLineText" }], records: [{ Invoice: "INV-SECRET" }] }] })).baseId;
  // Fake model: plays the scripted tool calls, then stops; records each tool result it was given.
  __setAgentClient({ beta: { messages: { create: async (body: Record<string, unknown>) => {
    const last = (body.messages as { role: string; content: unknown }[]).at(-1)!;
    if (Array.isArray(last.content)) for (const b of last.content as { type: string; content?: unknown }[]) if (b.type === "tool_result") outputs.push(String(b.content));
    const next = script.shift();
    return (next ? { content: [{ type: "tool_use", id: `t${Math.random()}`, name: next.name, input: next.input }], stop_reason: "tool_use" } : { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }) as never;
  } } } });
});
afterAll(async () => { __setAgentClient(null); await closeDb(); });

async function run(ctx: Ctx, steps: typeof script) { script = [...steps]; outputs.length = 0; const { agent } = await ensureAssistant(ctx, baseA); return sendAgentMessage(ctx, agent.id, null, "go"); }

describe("assistant scope and access", () => {
  it("is one per base and hidden from the agent roster", async () => {
    const a1 = await ensureAssistant(owner, baseA); const a2 = await ensureAssistant(editor, baseA);
    expect(a1.agent.id).toBe(a2.agent.id);
    expect((await listAgents(owner, baseA)).some((x) => x.id === a1.agent.id)).toBe(false);
  });
  it("only sees the base it's opened in", async () => {
    await run(owner, [{ name: "list_tables", input: {} }, { name: "search_records", input: { table: "Invoices", query: "", limit: 5 } }]);
    expect(outputs[0]).toContain("# Tasks"); expect(outputs[0]).not.toContain("Invoices");
    expect(outputs[1]).toMatch(/No table “Invoices”/);
  });
  it("readers can ask but not change; editors change records but not structure", async () => {
    await run(reader, [{ name: "propose_create_record", input: { table: "Tasks", values: [{ field: "Task", value: "From reader" }], reason: "x" } }]);
    expect(outputs[0]).toMatch(/read\/comment access only/);
    const t = await run(editor, [{ name: "propose_create_record", input: { table: "Tasks", values: [{ field: "Task", value: "From editor" }], reason: "asked" } }, { name: "propose_add_field", input: { table: "Tasks", name: "Priority", type: "singleSelect", choices: "High, Low", reason: "x" } }]);
    expect(outputs[1]).toMatch(/needs creator access/);
    const [p] = await db.select().from(baseApprovals).where(and(eq(baseApprovals.threadId, t.threadId), eq(baseApprovals.kind, "create_record")));
    await decideApproval(editor, p.id, true);
    expect((await runView(editor, "editor", tasks, {})).rows.some((r) => Object.values(r.values).includes("From editor"))).toBe(true);
  });
  it("creators can add fields and tables, applied only after approval", async () => {
    const t = await run(owner, [{ name: "propose_add_field", input: { table: "Tasks", name: "Priority", type: "singleSelect", choices: "High, Low", reason: "x" } }, { name: "propose_add_table", input: { name: "Risks", fields: "Due:date, Owner:singleLineText", reason: "y" } }]);
    const props = await db.select().from(baseApprovals).where(eq(baseApprovals.threadId, t.threadId));
    expect(props.map((p) => p.kind).sort()).toEqual(["create_field", "create_table"]);
    expect((await db.select().from(baseFields).where(and(eq(baseFields.tableId, tasks), eq(baseFields.name, "Priority")))).length).toBe(0); // not before approval
    const field = props.find((p) => p.kind === "create_field")!;
    await expect(decideApproval(editor, field.id, true)).rejects.toThrow();
    await decideApproval(owner, field.id, true);
    const [f] = await db.select().from(baseFields).where(and(eq(baseFields.tableId, tasks), eq(baseFields.name, "Priority")));
    expect(f.options.choices?.map((c) => c.name)).toEqual(["High", "Low"]);
    const tbl = props.find((p) => p.kind === "create_table")!;
    const r = await decideApproval(owner, tbl.id, true);
    expect(r.status).toBe("approved");
  });
  it("can't be used in a base the person has no access to", async () => {
    const outsider = await asRole(await makeUser(owner.orgId, "crew"), "commenter");
    await updateBase(owner, baseB, { visibility: "private" });
    await expect(ensureAssistant(outsider, baseB)).rejects.toThrow();
  });
});
