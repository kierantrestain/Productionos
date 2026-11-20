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
import { changePassword, myWork, searchEverything, systemStatus } from "@/server/hub/hub";
import type { Ctx } from "@/server/auth/context";
import { makeOrg, makeUser } from "../support/factory";

let owner: Ctx; let editor: Ctx; let openBase: string; let privateBase: string;
const asRole = async (ctx: Ctx, role: string) => { await db.update(memberships).set({ platformRole: role }).where(and(eq(memberships.userId, ctx.userId), eq(memberships.orgId, ctx.orgId))); return (await contextForUser(ctx.userId, ctx.orgId))!; };
const d = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

beforeAll(async () => {
  const org = await makeOrg("Hub");
  owner = await asRole(await makeUser(org.id, "org_admin", { password: "original-password-123" }), "owner");
  editor = await asRole(await makeUser(org.id, "production_manager"), "editor");
  const b = await createBase(owner, { name: "Ops Hub", blank: false }); openBase = b.id;
  const t = await db.transaction((tx) => createTableTx(tx, owner, b.id, "Jobs", [
    { name: "Job", type: "singleLineText" }, { name: "Assignee", type: "user" }, { name: "Due date", type: "date" },
    { name: "Status", type: "singleSelect", options: { choices: [{ id: "s1", name: "Doing" }, { id: "s2", name: "Done" }] } as never },
  ]));
  const f = Object.fromEntries((await db.query.baseFields.findMany({ where: (x, { eq }) => eq(x.tableId, t.id) })).map((x) => [x.name, x.id]));
  await createRecords(owner, t.id, [
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
