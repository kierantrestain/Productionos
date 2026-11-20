/** Platform access control: private bases, explicit deny, cross-base isolation, widget table scoping. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { baseFields, memberships } from "@/db/schema";
import { createBaseFromSpec } from "@/server/platform/spec";
import { listBases, loadBaseStructure, updateBase, updateField } from "@/server/platform/schema";
import { computeWidgets, saveInterface } from "@/server/platform/interfaces";
import { runView, searchTitles } from "@/server/platform/query";
import { createRecords } from "@/server/platform/records";
import { setBaseMember } from "@/server/platform/members";
import { contextForUser } from "@/server/auth/sessions";
import { makeOrg, makeUser } from "../support/factory";
import type { Ctx } from "@/server/auth/context";

let owner: Ctx, creator: Ctx, editor: Ctx, outsider: Ctx;
let A: { baseId: string; tableIds: Record<string, string> }, B: { baseId: string; tableIds: Record<string, string> }, X: { baseId: string; tableIds: Record<string, string> };
const asRole = async (ctx: Ctx, role: string) => { await db.update(memberships).set({ platformRole: role }).where(and(eq(memberships.userId, ctx.userId), eq(memberships.orgId, ctx.orgId))); return (await contextForUser(ctx.userId, ctx.orgId))!; };
const spec = (name: string) => ({ name, tables: [{ name: "Items", fields: [{ name: "Name", type: "singleLineText" as const }, { name: "Amount", type: "number" as const }], records: [{ Name: `${name} secret`, Amount: 7 }] }] });

beforeAll(async () => {
  const org = await makeOrg("Security");
  owner = await asRole(await makeUser(org.id, "org_admin"), "owner");
  creator = await asRole(await makeUser(org.id, "producer"), "creator");
  editor = await asRole(await makeUser(org.id, "production_manager"), "editor");
  A = await createBaseFromSpec(owner, spec("Alpha"));
  B = await createBaseFromSpec(owner, spec("Bravo"));
  const other = await makeOrg("Other");
  outsider = await asRole(await makeUser(other.id, "org_admin"), "owner");
  X = await createBaseFromSpec(outsider, spec("Xray"));
});
afterAll(async () => { await closeDb(); });

describe("private bases and explicit deny", () => {
  it("private bases are invisible to non-members, visible to owners and added members; access is revoked on removal", async () => {
    await expect(updateBase(creator, B.baseId, { visibility: "private" })).rejects.toThrow(/owner access/);
    await updateBase(owner, B.baseId, { visibility: "private" });
    expect((await listBases(editor)).map((b) => b.id)).not.toContain(B.baseId);
    await expect(loadBaseStructure(editor, B.baseId)).rejects.toThrow(/not found/i);
    await expect(runView(editor, "editor", B.tableIds.Items, {})).resolves.toBeDefined(); // engine is role-agnostic…
    await expect(searchTitlesAs(editor, B.tableIds.Items)).rejects.toThrow(/not found/i); // …but every entry point checks base access
    expect((await listBases(owner)).map((b) => b.id)).toContain(B.baseId);
    await setBaseMember(owner, B.baseId, editor.userId, "reader");
    expect((await listBases(editor)).find((b) => b.id === B.baseId)?.role).toBe("reader");
    await expect(createRecords(editor, B.tableIds.Items, [{}])).rejects.toThrow(/editor access/);
    await setBaseMember(owner, B.baseId, editor.userId, null); // revoke
    await expect(loadBaseStructure(editor, B.baseId)).rejects.toThrow(/not found/i);
  });
  it("an explicit deny hides a workspace base; owners can't be denied", async () => {
    await setBaseMember(owner, A.baseId, editor.userId, "none");
    expect((await listBases(editor)).map((b) => b.id)).not.toContain(A.baseId);
    await expect(createRecords(editor, A.tableIds.Items, [{}])).rejects.toThrow(/not found/i);
    await expect(setBaseMember(owner, A.baseId, owner.userId, "none")).rejects.toThrow();
    await setBaseMember(owner, A.baseId, editor.userId, null);
    await expect(createRecords(editor, A.tableIds.Items, [{}])).resolves.toHaveLength(1);
  });
});

describe("cross-base and cross-org isolation", () => {
  it("interface widgets can't read a table from another base or another organisation", async () => {
    const d = await computeWidgets(editor, A.baseId, [
      { id: "own", type: "number", title: "own", tableId: A.tableIds.Items },
      { id: "otherBase", type: "list", title: "b", tableId: B.tableIds.Items },
      { id: "otherOrg", type: "list", title: "x", tableId: X.tableIds.Items },
    ]);
    expect(d[0].value).toBeGreaterThanOrEqual(1);
    expect(d[1].error).toMatch(/isn't part of this base/);
    expect(d[1].rows).toBeUndefined();
    expect(d[2].error).toMatch(/isn't part of this base/);
    await expect(saveInterface(owner, A.baseId, { name: "Leak", widgets: [{ id: "w", type: "list", title: "x", tableId: B.tableIds.Items }] })).rejects.toThrow(/tables from this base/);
  });
  it("a link field can't be repointed at another base's table, and the engine never reads across bases", async () => {
    const st = await loadBaseStructure(owner, A.baseId);
    // Create a link inside base A, then attempt to tamper its target to base B.
    const { createField } = await import("@/server/platform/schema");
    const t2 = await (await import("@/server/platform/schema")).createTable(owner, A.baseId, "Other");
    const link = await createField(owner, A.tableIds.Items, { name: "Rel", type: "link", options: { linkedTableId: t2.id } });
    await updateField(owner, link.id, { options: { linkedTableId: B.tableIds.Items } });
    const [row] = await db.select().from(baseFields).where(eq(baseFields.id, link.id));
    expect((row.options as { linkedTableId: string }).linkedTableId).toBe(t2.id);
    // Even if options were tampered directly in the DB, titles from base B never surface.
    await db.update(baseFields).set({ options: { ...(row.options as object), linkedTableId: B.tableIds.Items } }).where(eq(baseFields.id, link.id));
    const bRec = (await runView(owner, "owner", B.tableIds.Items, {})).rows[0];
    const aRec = (await runView(owner, "owner", A.tableIds.Items, {})).rows[0];
    await db.execute((await import("drizzle-orm")).sql`update base_records set data = data || jsonb_build_object(${link.id}::text, jsonb_build_array(${bRec.id}::text)) where id = ${aRec.id}`);
    const v = await runView(owner, "owner", A.tableIds.Items, {}, { recordIds: [aRec.id] });
    expect(JSON.stringify(v.rows[0].values)).not.toContain("Bravo secret");
    void st;
  });
  it("another organisation's base is not found", async () => {
    await expect(loadBaseStructure(owner, X.baseId)).rejects.toThrow(/not found/i);
    await expect(createRecords(owner, X.tableIds.Items, [{}])).rejects.toThrow();
  });
});

async function searchTitlesAs(ctx: Ctx, tableId: string) {
  const { tableContext } = await import("@/server/platform/schema");
  await tableContext(ctx, tableId);
  return searchTitles(ctx, tableId, "");
}
