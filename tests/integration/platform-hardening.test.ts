/** Concurrency, type-change preview, attachments, button actions and the v2 REST API. */
process.env.STORAGE_PROVIDER = "db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { baseRecords, memberships } from "@/db/schema";
import { createBaseFromSpec } from "@/server/platform/spec";
import { createField, previewFieldChange, updateField } from "@/server/platform/schema";
import { runView } from "@/server/platform/query";
import { updateCells, updateRecord } from "@/server/platform/records";
import { readRecordAttachment, removeRecordAttachment, uploadRecordAttachment } from "@/server/platform/attachments";
import { clickButton } from "@/server/platform/buttons";
import { saveAutomation } from "@/server/platform/automations";
import { createPlatformToken, revokePlatformToken } from "@/server/platform/api-v2";
import { setBaseMember } from "@/server/platform/members";
import { contextForUser } from "@/server/auth/sessions";
import * as Bases from "@/app/api/v2/bases/route";
import * as Tables from "@/app/api/v2/bases/[baseId]/tables/route";
import * as Records from "@/app/api/v2/tables/[tableId]/records/route";
import * as RecordOne from "@/app/api/v2/tables/[tableId]/records/[recordId]/route";
import * as OpenApi from "@/app/api/v2/openapi.json/route";
import { makeOrg, makeUser } from "../support/factory";
import type { Ctx } from "@/server/auth/context";

let owner: Ctx, editor: Ctx, reader: Ctx; let B: { baseId: string; tableIds: Record<string, string> };
const asRole = async (ctx: Ctx, role: string) => { await db.update(memberships).set({ platformRole: role }).where(and(eq(memberships.userId, ctx.userId), eq(memberships.orgId, ctx.orgId))); return (await contextForUser(ctx.userId, ctx.orgId))!; };
const fid = async (name: string) => (await runView(owner, "owner", B.tableIds.Deals, {})).fields.find((f) => f.name === name)!.id;
const rows = async () => (await runView(owner, "owner", B.tableIds.Deals, {})).rows;

beforeAll(async () => {
  const org = await makeOrg("Hardening");
  owner = await asRole(await makeUser(org.id, "org_admin"), "owner");
  editor = await asRole(await makeUser(org.id, "production_manager"), "editor");
  reader = await asRole(await makeUser(org.id, "crew"), "reader");
  B = await createBaseFromSpec(owner, { name: "Sales", tables: [{ name: "Deals", fields: [
    { name: "Deal", type: "singleLineText" }, { name: "Amount", type: "singleLineText" }, { name: "Stage", type: "singleSelect", choices: ["Open", "Won"] },
    { name: "Files", type: "attachment" }, { name: "Secret", type: "singleLineText" },
  ], records: [{ Deal: "A", Amount: "100", Stage: "Open" }, { Deal: "B", Amount: "n/a", Stage: "Open" }, { Deal: "C", Amount: "250.5" }] }] });
});
afterAll(async () => { await closeDb(); });

describe("concurrent edits", () => {
  it("two people editing the same cell from the same starting value: one wins, the other gets a conflict", async () => {
    const deal = await fid("Deal"); const a = (await rows()).find((r) => r.values[deal] === "A")!;
    const results = await Promise.allSettled([
      updateCells(owner, [{ recordId: a.id, fieldId: deal, value: "A-owner", expected: "A" }]),
      updateCells(editor, [{ recordId: a.id, fieldId: deal, value: "A-editor", expected: "A" }]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason?.message)).toMatch(/Someone else just changed this cell/);
    expect((await rows()).find((r) => r.id === a.id)!.values[deal]).toMatch(/^A-(owner|editor)$/);
  });
  it("edits to different cells of the same record both apply", async () => {
    const deal = await fid("Deal"), amount = await fid("Amount"); const b = (await rows()).find((r) => r.values[deal] === "B")!;
    await Promise.all([
      updateCells(owner, [{ recordId: b.id, fieldId: deal, value: "B2", expected: "B" }]),
      updateCells(editor, [{ recordId: b.id, fieldId: amount, value: "999", expected: "n/a" }]),
    ]);
    const after = (await rows()).find((r) => r.id === b.id)!;
    expect(after.values[deal]).toBe("B2"); expect(after.values[amount]).toBe("999");
  });
  it("record-level version check rejects a stale save", async () => {
    const [r] = await db.select().from(baseRecords).where(eq(baseRecords.tableId, B.tableIds.Deals)).limit(1);
    await updateRecord(owner, r.id, { [await fid("Secret")]: "v1" });
    await expect(updateRecord(editor, r.id, { [await fid("Secret")]: "v2" }, { expectedVersion: r.version })).rejects.toThrow(/changed while you were editing/);
  });
});

describe("safe field type changes", () => {
  it("previews conversions and clears before changing anything", async () => {
    const amount = await fid("Amount");
    const p = await previewFieldChange(owner, amount, { type: "number" });
    expect(p.converted + p.cleared).toBeGreaterThanOrEqual(2);
    expect(p.examples.length).toBeGreaterThan(0);
    expect((await rows()).some((r) => typeof r.values[amount] === "string")).toBe(true); // nothing written yet
    await expect(previewFieldChange(editor, amount, { type: "number" })).rejects.toThrow(/creator access/);
    const sel = await previewFieldChange(owner, amount, { type: "singleSelect" });
    expect(sel.addedChoices.length).toBeGreaterThan(0);
  });
});

describe("attachments", () => {
  it("upload, read with integrity, deny hidden/removed, remove", async () => {
    const files = await fid("Files"); const r0 = (await rows())[0];
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const a = await uploadRecordAttachment(editor, { recordId: r0.id, fieldId: files, name: "photo.png", type: "image/png", bytes: png });
    expect(a).toMatchObject({ filename: "photo.png", type: "image/png", size: png.length });
    expect(((await rows()).find((r) => r.id === r0.id)!.values[files] as { id: string }[]).map((x) => x.id)).toContain(a.id);
    const got = await readRecordAttachment(reader, a.id);
    expect(Buffer.compare(got.bytes, png)).toBe(0);
    await expect(uploadRecordAttachment(reader, { recordId: r0.id, fieldId: files, name: "x.png", type: "image/png", bytes: png })).rejects.toThrow(/editor access/);
    await expect(uploadRecordAttachment(editor, { recordId: r0.id, fieldId: files, name: "evil.exe", type: "application/octet-stream", bytes: png })).rejects.toThrow(/isn't allowed/);
    await updateField(owner, files, { permissions: { hiddenBelow: "editor" } });
    await expect(readRecordAttachment(reader, a.id)).rejects.toThrow(/not found/i);
    await updateField(owner, files, { permissions: {} });
    await removeRecordAttachment(editor, a.id);
    await expect(readRecordAttachment(owner, a.id)).rejects.toThrow(/not found/i);
  });
});

describe("button fields", () => {
  it("open URL fills tokens; update_record respects permissions; run_automation runs the chosen automation", async () => {
    const stage = await fid("Stage"), deal = await fid("Deal");
    const open = await createField(owner, B.tableIds.Deals, { name: "Open", type: "button", options: { action: "open_url", url: "https://example.com/deal/{RECORD_ID}?n={Deal}" } });
    const won = await createField(owner, B.tableIds.Deals, { name: "Mark won", type: "button", options: { action: "update_record", label: "Mark won", values: { [stage]: "Won" } } });
    const c = (await rows()).find((r) => r.values[deal] === "C")!;
    const o = await clickButton(reader, open.id, c.id);
    expect(o.url).toBe(`https://example.com/deal/${c.id}?n=C`);
    await expect(clickButton(reader, won.id, c.id)).rejects.toThrow(/editor access/);
    await clickButton(editor, won.id, c.id);
    const wonChoice = (await runView(owner, "owner", B.tableIds.Deals, {})).fields.find((f) => f.id === stage)!.options.choices!.find((x) => x.name === "Won")!.id;
    expect((await rows()).find((r) => r.id === c.id)!.values[stage]).toBe(wonChoice);
    const auto = await saveAutomation(owner, B.baseId, { name: "Stamp", isEnabled: true, trigger: { type: "record_created", tableId: B.tableIds.Deals }, actions: [{ type: "update_record", values: { [await fid("Secret")]: "stamped {Deal}" } }] });
    const run = await createField(owner, B.tableIds.Deals, { name: "Run", type: "button", options: { action: "run_automation", automationId: auto.id } });
    const res = await clickButton(editor, run.id, c.id);
    expect(res.status).toBe("succeeded");
    expect((await rows()).find((r) => r.id === c.id)!.values[await fid("Secret")]).toBe("stamped C");
    await expect(createField(owner, B.tableIds.Deals, { name: "Bad", type: "button", options: { action: "open_url", url: "javascript:alert(1)" } })).rejects.toThrow(/http/);
  });
});

describe("REST API v2", () => {
  const call = (h: (req: Request, ctx: never) => Promise<Response>, url: string, token: string | null, init: RequestInit = {}, params: Record<string, string> = {}) =>
    h(new Request(`http://test.local${url}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" } }), { params: Promise.resolve(params) } as never);
  it("auth, scopes, schema, pagination, CRUD, permissions follow the token's owner", async () => {
    expect((await call(Bases.GET, "/api/v2/bases", null)).status).toBe(401);
    expect((await call(Bases.GET, "/api/v2/bases", "pat_nope")).status).toBe(401);
    await expect(createPlatformToken(editor, "x", ["records:read"])).rejects.toThrow(/owners and creators/);
    const ro = await createPlatformToken(owner, "Read only", ["bases:read", "schema:read", "records:read"]);
    const rw = await createPlatformToken(owner, "Writer", ["records:read", "records:write"]);
    const bases = await (await call(Bases.GET, "/api/v2/bases", ro.token)).json();
    expect(bases.bases.map((b: { id: string }) => b.id)).toContain(B.baseId);
    const schema = await (await call(Tables.GET, "", ro.token, {}, { baseId: B.baseId })).json();
    expect(schema.tables[0].fields.map((f: { name: string }) => f.name)).toContain("Stage");
    const p1 = await (await call(Records.GET, `/api/v2/tables/${B.tableIds.Deals}/records?pageSize=2`, ro.token, {}, { tableId: B.tableIds.Deals })).json();
    expect(p1.records).toHaveLength(2); expect(p1.offset).toBe("2");
    const p2 = await (await call(Records.GET, `/api/v2/tables/${B.tableIds.Deals}/records?pageSize=2&offset=2`, ro.token, {}, { tableId: B.tableIds.Deals })).json();
    expect(p2.records.length).toBeGreaterThanOrEqual(1); expect(p2.offset).toBeUndefined();
    expect((await call(Records.POST, "", ro.token, { method: "POST", body: JSON.stringify({ records: [{ fields: { Deal: "X" } }] }) }, { tableId: B.tableIds.Deals })).status).toBe(403);
    const created = await call(Records.POST, "", rw.token, { method: "POST", body: JSON.stringify({ records: [{ fields: { Deal: "API deal", Stage: "Won" } }] }) }, { tableId: B.tableIds.Deals });
    expect(created.status).toBe(201);
    const rec = (await created.json()).records[0];
    expect(rec.fields).toMatchObject({ Deal: "API deal", Stage: "Won" });
    const patched = await (await call(RecordOne.PATCH, "", rw.token, { method: "PATCH", body: JSON.stringify({ fields: { Stage: "Open" } }) }, { tableId: B.tableIds.Deals, recordId: rec.id })).json();
    expect(patched.fields.Stage).toBe("Open");
    expect((await call(RecordOne.PATCH, "", rw.token, { method: "PATCH", body: JSON.stringify({ fields: { Stage: "Nope" } }) }, { tableId: B.tableIds.Deals, recordId: rec.id })).status).toBe(422);
    expect((await call(RecordOne.DELETE, "", rw.token, { method: "DELETE" }, { tableId: B.tableIds.Deals, recordId: rec.id })).status).toBe(200);
    expect((await call(RecordOne.GET, "", ro.token, {}, { tableId: B.tableIds.Deals, recordId: rec.id })).status).toBe(404);
    // The token follows its owner's access: deny the owner? (owners can't be denied) — so test with a creator's token.
    const creator = await asRole(await makeUser(owner.orgId, "producer"), "creator");
    const ct = await createPlatformToken(creator, "Creator", ["records:read"]);
    expect((await call(Records.GET, "", ct.token, {}, { tableId: B.tableIds.Deals })).status).toBe(200);
    await setBaseMember(owner, B.baseId, creator.userId, "none");
    expect((await call(Records.GET, "", ct.token, {}, { tableId: B.tableIds.Deals })).status).toBe(404);
    await revokePlatformToken(owner, ro.id);
    expect((await call(Bases.GET, "/api/v2/bases", ro.token)).status).toBe(401);
    const spec = await (await OpenApi.GET(new Request("http://test.local/api/v2/openapi.json"))).json();
    expect(spec.openapi).toBe("3.1.0"); expect(Object.keys(spec.paths)).toContain("/tables/{tableId}/records");
  });
});
