/**
 * Base platform services: automations (through the real outbox worker), interfaces, members & base
 * access, public forms, encrypted secrets, data sync and OIDC SSO.
 * NOTE: sync and SSO tests are MOCK-ONLY — the network is stubbed (no real Airtable, CSV host or identity
 * provider is contacted). They prove our request/verify/upsert logic, not a live integration.
 */
import { randomBytes } from "node:crypto";
process.env.SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import { closeDb, db } from "@/db";
import { baseViews, memberships, organisations, users } from "@/db/schema";
import { createBaseFromSpec } from "@/server/platform/spec";
import { createRecords, updateRecord, listComments } from "@/server/platform/records";
import { runView } from "@/server/platform/query";
import { saveAutomation } from "@/server/platform/automations";
import { computeWidgets } from "@/server/platform/interfaces";
import { inviteMember, setBaseMember, setPlatformRole } from "@/server/platform/members";
import { loadBaseStructure, updateView } from "@/server/platform/schema";
import { submitPublicForm, loadPublicForm } from "@/server/platform/public-form";
import { encryptSecret, decryptSecret } from "@/server/crypto";
import { __setSyncFetcher, createSync, runSync } from "@/server/platform/sync";
import { __setJwks, __setSsoFetcher, finishSso, passwordBlockedBySso, saveSso, startSso } from "@/server/auth/sso";
import { drainOutbox } from "@/server/workflows/engine";
import { contextForUser } from "@/server/auth/sessions";
import { makeOrg, makeUser } from "../support/factory";
import type { Ctx } from "@/server/auth/context";

let owner: Ctx; let editor: Ctx; let orgId: string; let orgSlug: string; let baseId: string; let T: Record<string, string>;
const fid = async (table: string, name: string) => (await runView(owner, "owner", T[table], {})).fields.find((f) => f.name === name)!.id;
const asRole = async (ctx: Ctx, role: string) => { await db.update(memberships).set({ platformRole: role }).where(and(eq(memberships.userId, ctx.userId), eq(memberships.orgId, ctx.orgId))); return (await contextForUser(ctx.userId, ctx.orgId))!; };

beforeAll(async () => {
  const org = await makeOrg("Services"); orgId = org.id; orgSlug = org.slug;
  owner = await asRole(await makeUser(org.id, "org_admin"), "owner");
  editor = await asRole(await makeUser(org.id, "production_manager"), "editor");
  const r = await createBaseFromSpec(owner, { name: "Sales", tables: [
    { name: "Deals", fields: [{ name: "Deal", type: "singleLineText" }, { name: "Stage", type: "singleSelect", choices: ["Open", "Won", "Lost"] }, { name: "Value", type: "currency" }, { name: "Close", type: "date" }, { name: "Kickoff", type: "link", linkTo: "Projects", inverseName: "Deal" }],
      records: [{ Deal: "A", Stage: "Open", Value: 100, Close: "2027-01-10" }, { Deal: "B", Stage: "Won", Value: 300, Close: "2027-02-10" }, { Deal: "C", Stage: "Won", Value: 50, Close: "2027-02-20" }] },
    { name: "Projects", fields: [{ name: "Project", type: "singleLineText" }, { name: "Status", type: "singleSelect", choices: ["New", "Active"] }] },
  ] });
  baseId = r.baseId; T = r.tableIds;
});
afterAll(async () => { __setSyncFetcher(null); __setSsoFetcher(null); __setJwks(null); await closeDb(); });

describe("automations", () => {
  it("won deal → linked project + comment, via the outbox worker; idempotent and depth-capped", async () => {
    const stage = await fid("Deals", "Stage"), kickoff = await fid("Deals", "Kickoff");
    const pDeal = await fid("Projects", "Deal"), pStatus = await fid("Projects", "Status"), pName = await fid("Projects", "Project");
    await saveAutomation(owner, baseId, { name: "Won → project", isEnabled: true,
      trigger: { type: "record_updated", tableId: T.Deals, watchFieldIds: [stage], conditions: { conjunction: "and", conditions: [{ fieldId: stage, op: "is", value: (await loadBaseStructure(owner, baseId)).fields.find((f) => f.id === stage)!.options.choices!.find((c) => c.name === "Won")!.id }] } },
      actions: [{ type: "create_record", tableId: T.Projects, linkFieldId: pDeal, values: { [pName]: "Kickoff: {Deal}", [pStatus]: "New" } }, { type: "add_comment", body: "Won — {Deal} handed to delivery." }] });
    const dealName = await fid("Deals", "Deal");
    const deal = (await runView(owner, "owner", T.Deals, {})).rows.find((x) => x.values[dealName] === "A")!;
    await updateRecord(editor, deal.id, { [stage]: "Won" });
    await drainOutbox({ orgId, budgetMs: 20_000 });
    await drainOutbox({ orgId, budgetMs: 20_000 });
    const after = (await runView(owner, "owner", T.Deals, {}, { recordIds: [deal.id] })).rows[0];
    const links = after.values[kickoff] as { title: string }[];
    expect(links).toHaveLength(1);
    expect(links[0].title).toBe("Kickoff: A");
    expect((await listComments(owner, deal.id)).map((c) => c.body)).toContain("Won — A handed to delivery.");
  });
  it("rejects actions targeting tables outside the base, and editors can't manage automations", async () => {
    await expect(saveAutomation(owner, baseId, { name: "x", trigger: { type: "record_created", tableId: T.Deals }, actions: [{ type: "create_record", tableId: "00000000-0000-0000-0000-000000000000", values: {} }] })).rejects.toThrow(/tables of this base/);
    await expect(saveAutomation(editor, baseId, { name: "x", trigger: { type: "record_created", tableId: T.Deals }, actions: [{ type: "add_comment", body: "hi" }] })).rejects.toThrow(/creator access/);
  });
});

describe("interfaces", () => {
  it("computes number, grouped bar and monthly line widgets from live records", async () => {
    const value = await fid("Deals", "Value"), stage = await fid("Deals", "Stage"), close = await fid("Deals", "Close");
    const d = await computeWidgets(owner, baseId, [
      { id: "n", type: "number", title: "Pipeline", tableId: T.Deals, agg: "sum", fieldId: value },
      { id: "b", type: "bar", title: "By stage", tableId: T.Deals, agg: "count", groupFieldId: stage },
      { id: "l", type: "line", title: "By month", tableId: T.Deals, agg: "sum", fieldId: value, groupFieldId: close, dateUnit: "month" },
    ]);
    expect(d[0].value).toBe(450);
    expect(d[1].series).toEqual([{ label: "Open", value: 0, color: expect.any(String) }, { label: "Won", value: 3, color: expect.any(String) }].filter((x) => x.value));
    expect(d[2].series).toEqual([{ label: "2027-01", value: 100, color: undefined }, { label: "2027-02", value: 350, color: undefined }]);
  });
});

describe("members, base access and free seats", () => {
  it("only owners change roles; last owner protected; base overrides can narrow access", async () => {
    await expect(setPlatformRole(editor, owner.userId, "reader")).rejects.toThrow(/Only owners/);
    await expect(setPlatformRole(owner, owner.userId, "editor")).rejects.toThrow(/at least one owner/);
    const inv = await inviteMember(owner, "new.person@example.test", "commenter");
    expect(inv.link).toMatch(/^\/invite\//);
    await setBaseMember(owner, baseId, editor.userId, "reader");
    await expect(createRecords(editor, T.Deals, [{}])).rejects.toThrow(/editor access/);
    await setBaseMember(owner, baseId, editor.userId, null);
    await expect(createRecords(editor, T.Deals, [{}])).resolves.toHaveLength(1);
  });
});

describe("public forms", () => {
  it("accepts only the form's fields and requires a share token", async () => {
    const [v] = await db.insert(baseViews).values({ orgId, tableId: T.Projects, name: "Request", type: "form", config: {}, createdBy: owner.userId }).returning();
    const shared = await updateView(owner, v.id, { share: true });
    const f = await loadPublicForm(shared.shareToken!);
    const nameId = f.form.fields.find((x) => x.f.name === "Project")!.fieldId;
    await expect(submitPublicForm(shared.shareToken!, { [nameId]: "From the public" })).resolves.toHaveProperty("id");
    const valueId = await fid("Deals", "Value");
    await expect(submitPublicForm(shared.shareToken!, { [valueId]: 1 })).rejects.toThrow(/unexpected field/);
    await updateView(owner, v.id, { share: false });
    await expect(loadPublicForm(shared.shareToken!)).rejects.toThrow();
  });
});

describe("secrets", () => {
  it("round-trips with AES-GCM and detects tampering", () => {
    const c = encryptSecret("pat-123");
    expect(c).not.toContain("pat-123");
    expect(decryptSecret(c)).toBe("pat-123");
    expect(() => decryptSecret(c.slice(0, -4) + "AAAA")).toThrow();
  });
});

describe("data sync (MOCK-ONLY network)", () => {
  it("Airtable: paginates, creates the table, upserts by record id, never writes back", async () => {
    const calls: { url: string; method: string }[] = [];
    let page2Name = "Gamma";
    __setSyncFetcher(async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET" });
      const u = new URL(url);
      const body = u.searchParams.get("offset")
        ? { records: [{ id: "rec3", fields: { Name: page2Name, Stage: "Done", Amount: 30 } }] }
        : { records: [{ id: "rec1", fields: { Name: "Alpha", Stage: "Todo", Amount: 10 } }, { id: "rec2", fields: { Name: "Beta", Stage: "Doing", Amount: 20 } }], offset: "p2" };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const s = await createSync(owner, baseId, { kind: "airtable", name: "Leads", airtableBaseId: "appABCDEFGHIJKLMN", airtableTable: "Leads", token: "patFAKE.fake" });
    const r1 = await runSync(owner, s.id);
    expect(r1.stats).toMatchObject({ fetched: 3, created: 3 });
    page2Name = "Gamma 2";
    const r2 = await runSync(owner, s.id);
    expect(r2.stats).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
    expect(calls.every((c) => c.method === "GET" && c.url.startsWith("https://api.airtable.com/v0/appABCDEFGHIJKLMN/"))).toBe(true);
    const v = await runView(owner, "owner", r1.tableId, {});
    expect(v.rows).toHaveLength(3);
  });
  it("CSV: refuses http and private hosts", async () => {
    await expect(createSync(owner, baseId, { kind: "csv_url", name: "x", url: "http://example.com/a.csv" })).rejects.toThrow(/https/);
    await expect(createSync(owner, baseId, { kind: "csv_url", name: "x", url: "https://localhost/a.csv" })).rejects.toThrow(/private or unknown/);
  });
});

describe("OIDC single sign-on (MOCK-ONLY identity provider)", () => {
  it("verifies the ID token, provisions a least-privilege member, and enforces SSO for passwords", async () => {
    const iss = "https://idp.example.test";
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
    __setJwks(() => createLocalJWKSet({ keys: [jwk] }) as never);
    let nonce = ""; let aud = "client-1";
    __setSsoFetcher(async (url, init) => {
      if (url.endsWith("/.well-known/openid-configuration")) return new Response(JSON.stringify({ issuer: iss, authorization_endpoint: `${iss}/auth`, token_endpoint: `${iss}/token`, jwks_uri: `${iss}/jwks` }));
      if (url === `${iss}/token`) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("code_verifier")).toBeTruthy();
        const id_token = await new SignJWT({ email: "sso.user@acme.test", email_verified: true, name: "SSO User", nonce }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(iss).setAudience(aud).setSubject("u-1").setIssuedAt().setExpirationTime("5m").sign(privateKey);
        return new Response(JSON.stringify({ id_token }));
      }
      return new Response("nope", { status: 404 });
    });
    await expect(saveSso(editor, { issuer: iss, clientId: "client-1", clientSecret: "s", allowedDomains: ["acme.test"], defaultRole: "reader", isEnabled: true, enforce: true })).rejects.toThrow(/owners/);
    await saveSso(owner, { issuer: iss, clientId: "client-1", clientSecret: "s3cret", allowedDomains: ["acme.test"], defaultRole: "commenter", isEnabled: true, enforce: true });
    const start = await startSso(orgSlug, "https://app.example.test/api/auth/sso/callback");
    const u = new URL(start.url);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    nonce = u.searchParams.get("nonce")!;
    await expect(finishSso({ code: "c", state: "wrong" }, start.cookie)).rejects.toThrow(/state/);
    const r = await finishSso({ code: "c", state: u.searchParams.get("state") }, start.cookie);
    expect(r.orgId).toBe(orgId);
    const [m] = await db.select().from(memberships).where(and(eq(memberships.userId, r.userId), eq(memberships.orgId, orgId)));
    expect(m.platformRole).toBe("commenter");
    expect(await passwordBlockedBySso(r.userId, "sso.user@acme.test")).toBe(true);
    // Wrong audience is rejected.
    aud = "someone-else";
    const s2 = await startSso(orgSlug, "https://app.example.test/api/auth/sso/callback");
    nonce = new URL(s2.url).searchParams.get("nonce")!;
    await expect(finishSso({ code: "c", state: new URL(s2.url).searchParams.get("state") }, s2.cookie)).rejects.toThrow();
    void users; void organisations;
  });
});
