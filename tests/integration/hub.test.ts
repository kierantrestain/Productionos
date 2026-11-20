/**
 * Workspace hub: My work (assigned / overdue / due today / done excluded), search across bases, tables
 * and records — both scoped to what the person may open (private bases stay invisible) — and password change.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { memberships } from "@/db/schema";
import { contextForUser } from "@/server/auth/sessions";
import { createBase, createField, createTableTx, updateBase } from "@/server/platform/schema";
import { createRecords } from "@/server/platform/records";
import { changePassword, myWork, quickAdd, searchEverything, systemStatus } from "@/server/hub/hub";
import { addComment } from "@/server/platform/records";
import { reorderTables } from "@/server/platform/schema";
import { __setAiClient, generateAiCell } from "@/server/platform/ai";
import type { Ctx } from "@/server/auth/context";
import { makeOrg, makeUser } from "../support/factory";

let owner: Ctx; let editor: Ctx; let reader: Ctx; let openBase: string; let privateBase: string; let jobsTable: string; let jobIds: string[] = [];
const asRole = async (ctx: Ctx, role: string) => { await db.update(memberships).set({ platformRole: role }).where(and(eq(memberships.userId, ctx.userId), eq(memberships.orgId, ctx.orgId))); return (await contextForUser(ctx.userId, ctx.orgId))!; };
const d = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

beforeAll(async () => {
  const org = await makeOrg("Hub");
  owner = await asRole(await makeUser(org.id, "org_admin", { password: "original-password-123" }), "owner");
  editor = await asRole(await makeUser(org.id, "production_manager"), "editor");
  reader = await asRole(await makeUser(org.id, "crew"), "reader");
  const b = await createBase(owner, { name: "Ops Hub", blank: false }); openBase = b.id;
  const t = await db.transaction((tx) => createTableTx(tx, owner, b.id, "Jobs", [
    { name: "Job", type: "singleLineText" }, { name: "Assignee", type: "user" }, { name: "Due date", type: "date" },
    { name: "Status", type: "singleSelect", options: { choices: [{ id: "s1", name: "Doing" }, { id: "s2", name: "Done" }] } as never },
  ]));
  const f = Object.fromEntries((await db.query.baseFields.findMany({ where: (x, { eq }) => eq(x.tableId, t.id) })).map((x) => [x.name, x.id]));
  jobsTable = t.id;
  jobIds = await createRecords(owner, t.id, [
    { [f.Job]: "Late invoice zebra", [f.Assignee]: [editor.userId], [f["Due date"]]: d(-2), [f.Status]: "s1" },
    { [f.Job]: "Call client zebra", [f.Assignee]: [editor.userId], [f["Due date"]]: d(0), [f.Status]: "s1" },
    { [f.Job]: "Finished thing zebra", [f.Assignee]: [editor.userId], [f["Due date"]]: d(-5), [f.Status]: "s2" },
    { [f.Job]: "Someone else's job", [f.Assignee]: [owner.userId], [f["Due date"]]: d(-1), [f.Status]: "s1" },
    { [f.Job]: "Unscheduled for me", [f.Assignee]: [editor.userId] },
  ]);
  const pb = await createBase(owner, { name: "Board Secrets zebra" }); privateBase = pb.id;
  await updateBase(owner, pb.id, { visibility: "private" });
  void createField;
});
afterAll(async () => { await closeDb(); });

describe("My work", () => {
  it("shows my overdue, due-today and assigned items; skips done items and other people's", async () => {
    const w = await myWork(editor);
    const titles = w.items.map((i) => `${i.reason}:${i.title}`);
    expect(titles).toContain("overdue:Late invoice zebra");
    expect(titles).toContain("today:Call client zebra");
    expect(titles).toContain("assigned:Unscheduled for me");
    expect(titles.some((x) => x.includes("Finished thing"))).toBe(false);
    expect(titles.some((x) => x.includes("Someone else"))).toBe(false);
    expect(w.counts.overdue).toBe(1); expect(w.counts.today).toBe(1);
    expect(w.items[0].reason).toBe("overdue"); // priority order
    expect(w.items.every((i) => i.baseId === openBase)).toBe(true);
  });
});

describe("Search everything", () => {
  it("finds bases, tables and records the person can open — never a private base", async () => {
    const mine = await searchEverything(editor, "zebra");
    expect(mine.filter((h) => h.kind === "record").map((h) => h.title).sort()).toEqual(["Call client zebra", "Finished thing zebra", "Late invoice zebra"]);
    expect(mine.some((h) => h.id === privateBase)).toBe(false);
    expect((await searchEverything(editor, "Jobs")).some((h) => h.kind === "table" && h.href.includes(openBase))).toBe(true);
    expect((await searchEverything(owner, "Board Secrets")).some((h) => h.id === privateBase)).toBe(true);
    expect(await searchEverything(editor, "%")).toEqual([]); // wildcards are literal
  });
});

describe("Account settings", () => {
  it("password change requires the current password and a 12+ character new one", async () => {
    await expect(changePassword(owner, "wrong-password", "a-new-password-456")).rejects.toThrow(/current password/);
    await expect(changePassword(owner, "original-password-123", "short")).rejects.toThrow(/12 characters/);
    await changePassword(owner, "original-password-123", "a-new-password-456");
    await expect(changePassword(owner, "original-password-123", "another-password-789")).rejects.toThrow(/current password/);
  });
  it("integration status is computed, never assumed", () => {
    const s = systemStatus();
    expect(s.map((x) => x.key)).toEqual(["ai", "secrets", "mail", "storage", "jobs"]);
    expect(s.every((x) => typeof x.ok === "boolean" && x.detail.length > 0)).toBe(true);
  });
});

describe("Mentions, quick add and table order", () => {
  it("an @mention lands in the mentioned person's My work (and counts as new)", async () => {
    const before = new Date(Date.now() - 1000);
    await addComment(owner, jobIds[0], `Can you chase this, @[Test editor](${editor.userId})?`);
    const w = await myWork(editor, { mentionsSince: before });
    expect(w.mentions[0].body).toBe("Can you chase this, @Test editor?");
    expect(w.mentions[0].record).toBe("Late invoice zebra");
    expect(w.counts.newMentions).toBe(1);
    expect((await myWork(owner)).mentions).toHaveLength(0);
  });
  it("quick add creates a record for editors, refuses readers, and search offers it", async () => {
    const hits = await searchEverything(editor, "Jobs: book the crane");
    expect(hits[0]).toMatchObject({ kind: "create", id: jobsTable, text: "book the crane" });
    expect((await searchEverything(reader, "Jobs: book the crane")).some((h) => h.kind === "create")).toBe(false);
    const r = await quickAdd(editor, jobsTable, "book the crane");
    expect(r.tableId).toBe(jobsTable);
    expect((await searchEverything(editor, "book the crane")).some((h) => h.kind === "record" && h.id === r.recordId)).toBe(true);
    await expect(quickAdd(reader, jobsTable, "nope")).rejects.toThrow();
  });
  it("reordering tables needs creator access", async () => {
    const t2 = await db.transaction((tx) => createTableTx(tx, owner, openBase, "Second", [{ name: "Name", type: "singleLineText" }]));
    await reorderTables(owner, openBase, [t2.id, jobsTable]);
    const order = (await db.query.baseTables.findMany({ where: (x, { eq }) => eq(x.baseId, openBase), orderBy: (x, { asc }) => asc(x.sortOrder) })).map((x) => x.id);
    expect(order.slice(0, 2)).toEqual([t2.id, jobsTable]);
    await expect(reorderTables(editor, openBase, [jobsTable, t2.id])).rejects.toThrow();
  });
});

describe("AI field actions (MOCK-ONLY client)", () => {
  it("analyse sends images/PDFs as content blocks; research enables web search and resumes paused turns", async () => {
    const calls: Record<string, unknown>[] = [];
    let n = 0;
    __setAiClient({ messages: { create: async (req: Record<string, unknown>) => { calls.push(req); n++;
      if ((req.tools as unknown[] | undefined)?.length && n === 2) return { stop_reason: "pause_turn", content: [{ type: "text", text: "…" }] };
      return { stop_reason: "end_turn", content: [{ type: "text", text: "A red logo on white." }] }; } } });
    const png = Buffer.from("89504e47", "hex");
    expect(await generateAiCell("Describe it", "analyze", [{ type: "image/png", bytes: png, name: "a.png" }, { type: "text/plain", bytes: png, name: "skip.txt" }])).toBe("A red logo on white.");
    const content = (calls[0].messages as { content: { type: string }[] }[])[0].content;
    expect(content.map((b) => b.type)).toEqual(["image", "text"]);
    expect(await generateAiCell("Research Acme", "research")).toBe("A red logo on white.");
    expect((calls[1].tools as { type: string }[])[0].type).toBe("web_search_20260209");
    expect(calls.length).toBe(3); // paused once, then resumed
    expect(await generateAiCell("Describe it", "analyze", [])).toMatch(/No readable attachment/);
    __setAiClient(null);
  });
});
