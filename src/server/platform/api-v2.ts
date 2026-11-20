/**
 * Public REST API v2 for the base platform.
 * Auth: `Authorization: Bearer pat_…` personal access tokens. A token acts as its creator's CURRENT
 * workspace identity — base visibility, base/table/field permissions and role changes all apply, and a
 * disabled or removed user's tokens stop working. Scopes narrow what the token may do further.
 * Values use field NAMES as keys; selects are option names, links/users are id arrays.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiTokens, baseRecords, baseViews } from "@/db/schema";
import type { FieldDefLite } from "@/lib/platform/fields";
import type { Ctx } from "../auth/context";
import { newToken, sha256 } from "../auth/password";
import { contextForUser } from "../auth/sessions";
import { audit } from "../audit";
import { toResult, forbidden, invalid, notFound, type ActionResult } from "../errors";
import { atLeast } from "./access";
import { runView } from "./query";
import { createRecords, deleteRecords, updateRecord } from "./records";
import { listBases, loadBaseStructure, tableContext, asLite } from "./schema";

export const V2_SCOPES = ["bases:read", "schema:read", "records:read", "records:write"] as const;
export type V2Scope = (typeof V2_SCOPES)[number];
const PREFIX = "pat_";
const MAX_PAGE = 100;

// ───────── Tokens ─────────
export async function createPlatformToken(ctx: Ctx, name: string, scopes: string[]) {
  if (!atLeast(ctx.platformRole, "creator")) throw forbidden("Only owners and creators can create API tokens.");
  const n = name.trim(); if (!n || n.length > 80) throw invalid("Name the token (up to 80 characters).");
  const clean = [...new Set(scopes)];
  if (!clean.length || clean.some((s) => !V2_SCOPES.includes(s as V2Scope))) throw invalid(`Scopes must be from: ${V2_SCOPES.join(", ")}`);
  const token = `${PREFIX}${newToken()}`;
  const [t] = await db.insert(apiTokens).values({ orgId: ctx.orgId, name: n, tokenHash: sha256(token), scopes: clean, createdBy: ctx.userId }).returning();
  await audit(db, ctx, "create_api_token", "api_tokens", t.id, { after: { name: n, scopes: clean, version: 2 } });
  return { id: t.id, token };
}
export async function listPlatformTokens(ctx: Ctx) {
  const rows = await db.select().from(apiTokens).where(and(eq(apiTokens.orgId, ctx.orgId), isNull(apiTokens.revokedAt))).orderBy(desc(apiTokens.createdAt));
  return rows.filter((t) => t.scopes.some((s) => V2_SCOPES.includes(s as V2Scope)) && (t.createdBy === ctx.userId || ctx.platformRole === "owner"))
    .map((t) => ({ id: t.id, name: t.name, scopes: t.scopes, createdAt: t.createdAt.toISOString(), lastUsedAt: t.lastUsedAt?.toISOString() ?? null, mine: t.createdBy === ctx.userId }));
}
export async function revokePlatformToken(ctx: Ctx, id: string) {
  const [t] = await db.select().from(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.orgId, ctx.orgId))).limit(1);
  if (!t || (t.createdBy !== ctx.userId && ctx.platformRole !== "owner")) throw notFound();
  await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, id));
  await audit(db, ctx, "revoke_api_token", "api_tokens", id, { meta: { name: t.name } });
}

// ───────── Request plumbing ─────────
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const err = (status: number, type: string, message: string) => json({ error: { type, message } }, status);

export async function authV2(req: Request, scope: V2Scope): Promise<Ctx | NextResponse> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token.startsWith(PREFIX)) return err(401, "AUTHENTICATION_REQUIRED", "Send a personal access token as `Authorization: Bearer pat_…`.");
  const [t] = await db.select().from(apiTokens).where(and(eq(apiTokens.tokenHash, sha256(token)), isNull(apiTokens.revokedAt))).limit(1);
  if (!t || !t.createdBy) return err(401, "INVALID_TOKEN", "The token is invalid or has been revoked.");
  if (!t.scopes.includes(scope)) return err(403, "INSUFFICIENT_SCOPE", `This token lacks the ${scope} scope.`);
  const ctx = await contextForUser(t.createdBy, t.orgId);
  if (!ctx) return err(401, "INVALID_TOKEN", "The token's owner no longer has access to this workspace.");
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, t.id));
  return { ...ctx, name: `API: ${t.name}` };
}

/** Run a handler, mapping app errors to HTTP. */
export async function handle<T>(fn: () => Promise<T>, status = 200): Promise<NextResponse> {
  const r: ActionResult<T> = await toResult(fn);
  if (r.ok) return json(r.data, status);
  const code = r.code === "not_found" ? 404 : r.code === "forbidden" ? 403 : r.code === "unauthenticated" ? 401 : r.code === "conflict" ? 409 : r.code === "internal" ? 500 : 422;
  return err(code, String(r.code).toUpperCase(), r.error);
}

// ───────── Value mapping ─────────
function toApi(f: FieldDefLite, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (f.type === "singleSelect") return f.options.choices?.find((c) => c.id === v)?.name ?? null;
  if (f.type === "multipleSelects") return (v as string[]).map((id) => f.options.choices?.find((c) => c.id === id)?.name).filter(Boolean);
  if (f.type === "link" || f.type === "user") return (v as { id: string }[]).map((x) => x.id);
  if (f.type === "createdBy" || f.type === "lastModifiedBy") return (v as { id: string }).id;
  return v;
}
function serialise(fields: FieldDefLite[], row: { id: string; values: Record<string, unknown>; createdAt: string }, only?: Set<string>) {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (!only || only.has(f.name.toLowerCase()) || only.has(f.id)) { const v = toApi(f, row.values[f.id]); if (v !== null && !(Array.isArray(v) && !v.length)) out[f.name] = v; }
  return { id: row.id, createdTime: row.createdAt, fields: out };
}
function inputFields(body: unknown) {
  const f = (body as { fields?: unknown })?.fields;
  if (!f || typeof f !== "object" || Array.isArray(f)) throw invalid("Each record needs a `fields` object keyed by field name.");
  return f as Record<string, unknown>;
}

// ───────── Endpoints ─────────
export async function apiListBases(ctx: Ctx) {
  const bases = await listBases(ctx);
  return { bases: bases.map((b) => ({ id: b.id, name: b.name, permissionLevel: b.role })) };
}
export async function apiBaseSchema(ctx: Ctx, baseId: string) {
  const st = await loadBaseStructure(ctx, baseId);
  const { fieldVisible } = await import("./access");
  return {
    tables: st.tables.map((t) => ({
      id: t.id, name: t.name, description: t.description, primaryFieldId: t.primaryFieldId,
      fields: st.fields.filter((f) => f.tableId === t.id && fieldVisible(st.access.role, asLite(f))).map((f) => ({ id: f.id, name: f.name, type: f.type, description: f.description, options: f.type === "singleSelect" || f.type === "multipleSelects" ? { choices: (f.options as { choices?: { name: string; color: string }[] }).choices?.map((c) => ({ name: c.name, color: c.color })) } : f.type === "link" ? { linkedTableId: (f.options as { linkedTableId?: string }).linkedTableId } : undefined })),
      views: st.views.filter((v) => v.tableId === t.id).map((v) => ({ id: v.id, name: v.name, type: v.type })),
    })),
  };
}
export async function apiListRecords(ctx: Ctx, tableId: string, q: URLSearchParams) {
  const { access } = await tableContext(ctx, tableId);
  let config = {};
  const viewParam = q.get("view");
  if (viewParam) {
    const views = await db.select().from(baseViews).where(and(eq(baseViews.tableId, tableId), eq(baseViews.orgId, ctx.orgId), isNull(baseViews.archivedAt)));
    const v = views.find((x) => (x.id === viewParam || x.name === viewParam) && (!x.ownerUserId || x.ownerUserId === ctx.userId) && atLeast(access.role, x.visibleTo));
    if (!v) throw notFound("View not found.");
    config = v.config;
  }
  const limit = Math.min(Math.max(Number(q.get("pageSize") ?? 100) || 100, 1), MAX_PAGE);
  const offset = Math.max(Number(q.get("offset") ?? 0) || 0, 0);
  const r = await runView(ctx, access.role, tableId, config, {});
  const only = q.getAll("fields[]").concat(q.getAll("fields")).map((s) => s.toLowerCase());
  const page = r.rows.slice(offset, offset + limit);
  return { records: page.map((row) => serialise(r.fields, row, only.length ? new Set(only) : undefined)), offset: offset + limit < r.rows.length ? String(offset + limit) : undefined, total: r.rows.length };
}
export async function apiGetRecord(ctx: Ctx, tableId: string, recordId: string) {
  const { access } = await tableContext(ctx, tableId);
  const r = await runView(ctx, access.role, tableId, {}, { recordIds: [recordId] });
  if (!r.rows.length) throw notFound("Record not found.");
  return serialise(r.fields, r.rows[0]);
}
export async function apiCreateRecords(ctx: Ctx, tableId: string, body: unknown) {
  const list = (body as { records?: unknown[] })?.records ?? [body];
  if (!Array.isArray(list) || !list.length || list.length > 50) throw invalid("Send 1–50 records as `records: [{ fields: {...} }]`.");
  const ids = await createRecords(ctx, tableId, list.map(inputFields));
  const { access } = await tableContext(ctx, tableId);
  const r = await runView(ctx, access.role, tableId, {}, { recordIds: ids });
  return { records: ids.map((id) => r.rows.find((x) => x.id === id)).filter(Boolean).map((row) => serialise(r.fields, row!)) };
}
export async function apiUpdateRecord(ctx: Ctx, tableId: string, recordId: string, body: unknown) {
  const [rec] = await db.select({ tableId: baseRecords.tableId }).from(baseRecords).where(and(eq(baseRecords.id, recordId), eq(baseRecords.orgId, ctx.orgId), isNull(baseRecords.deletedAt))).limit(1);
  if (!rec || rec.tableId !== tableId) throw notFound("Record not found.");
  await updateRecord(ctx, recordId, inputFields(body));
  return apiGetRecord(ctx, tableId, recordId);
}
export async function apiDeleteRecord(ctx: Ctx, tableId: string, recordId: string) {
  const [rec] = await db.select({ tableId: baseRecords.tableId }).from(baseRecords).where(and(eq(baseRecords.id, recordId), eq(baseRecords.orgId, ctx.orgId), isNull(baseRecords.deletedAt))).limit(1);
  if (!rec || rec.tableId !== tableId) throw notFound("Record not found.");
  await deleteRecords(ctx, [recordId]);
  return { id: recordId, deleted: true };
}

export function openApiDocument(origin: string) {
  const rec = { type: "object", properties: { id: { type: "string", format: "uuid" }, createdTime: { type: "string", format: "date-time" }, fields: { type: "object", additionalProperties: true } } };
  const errResp = { description: "Error", content: { "application/json": { schema: { type: "object", properties: { error: { type: "object", properties: { type: { type: "string" }, message: { type: "string" } } } } } } } };
  const sec = (scope: string) => ({ security: [{ bearer: [scope] }], responses: { 401: errResp, 403: errResp, 404: errResp } });
  const p = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });
  return {
    openapi: "3.1.0",
    info: { title: "Bang On OS API", version: "2.0.0", description: "Records and schema of the bases a personal access token's owner can access. Tokens act as their creator, so all base, table and field permissions apply." },
    servers: [{ url: `${origin}/api/v2` }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Personal access token (pat_…). Scopes: " + V2_SCOPES.join(", ") } }, schemas: { Record: rec } },
    paths: {
      "/bases": { get: { summary: "List bases", ...sec("bases:read"), responses: { 200: { description: "Bases" } } } },
      "/bases/{baseId}/tables": { get: { summary: "Base schema: tables, fields, views", parameters: [p("baseId")], ...sec("schema:read"), responses: { 200: { description: "Schema" } } } },
      "/tables/{tableId}/records": {
        get: { summary: "List records", parameters: [p("tableId"), { name: "view", in: "query", schema: { type: "string" } }, { name: "fields[]", in: "query", schema: { type: "array", items: { type: "string" } } }, { name: "pageSize", in: "query", schema: { type: "integer", maximum: MAX_PAGE } }, { name: "offset", in: "query", schema: { type: "string" } }], ...sec("records:read"), responses: { 200: { description: "Page of records; `offset` present when more remain" } } },
        post: { summary: "Create up to 50 records", parameters: [p("tableId")], ...sec("records:write"), requestBody: { content: { "application/json": { schema: { type: "object", properties: { records: { type: "array", items: { type: "object", properties: { fields: { type: "object" } } } } } } } } }, responses: { 201: { description: "Created" } } },
      },
      "/tables/{tableId}/records/{recordId}": {
        get: { summary: "Get a record", parameters: [p("tableId"), p("recordId")], ...sec("records:read"), responses: { 200: { description: "Record" } } },
        patch: { summary: "Update fields of a record", parameters: [p("tableId"), p("recordId")], ...sec("records:write"), responses: { 200: { description: "Record" } } },
        delete: { summary: "Delete a record (restorable in the app)", parameters: [p("tableId"), p("recordId")], ...sec("records:write"), responses: { 200: { description: "Deleted" } } },
      },
    },
  };
}
