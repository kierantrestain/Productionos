/**
 * Apps: create, autosave drafts (optimistic revision check), publish immutable versions, roll back,
 * and resolve what a viewer may see at runtime (role, page/component visibility, portal scope).
 */
import { and, desc, eq, isNull, max } from "drizzle-orm";
import { db } from "@/db";
import { apps, appVersions, baseFields, baseTables } from "@/db/schema";
import { slugify, validateAppConfig, type AppConfig, type Component, type Page, type Role } from "@/lib/apps/types";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { atLeast, baseAccess, requireRole } from "../platform/access";
import { runView } from "../platform/query";

export type AppRow = typeof apps.$inferSelect;

export async function listApps(ctx: Ctx) {
  const rows = await db.select().from(apps).where(and(eq(apps.orgId, ctx.orgId), isNull(apps.archivedAt))).orderBy(apps.createdAt);
  const out: (AppRow & { role: string })[] = [];
  for (const a of rows) {
    if (ctx.platformRole === "portal") { if (a.audience === "portal" && a.publishedVersionId) out.push({ ...a, role: "portal" }); continue; }
    try { const { role } = await baseAccess(ctx, a.baseId); if (a.publishedVersionId || atLeast(role, "creator")) out.push({ ...a, role }); } catch { /* no access to the base */ }
  }
  return out;
}

async function appForEdit(ctx: Ctx, appId: string) {
  const [a] = await db.select().from(apps).where(and(eq(apps.id, appId), eq(apps.orgId, ctx.orgId), isNull(apps.archivedAt))).limit(1);
  if (!a) throw notFound("App not found.");
  const access = await baseAccess(ctx, a.baseId);
  requireRole(access, "creator", "edit apps");
  return { app: a, role: access.role };
}
export const getAppForBuilder = appForEdit;

async function uniqueSlug(orgId: string, base: string) {
  let s = slugify(base); let n = 1;
  while ((await db.select({ id: apps.id }).from(apps).where(and(eq(apps.orgId, orgId), eq(apps.slug, s))).limit(1)).length) s = `${slugify(base)}-${++n}`;
  return s;
}

/** Tables/fields referenced by the config must belong to the app's base (no cross-base binding). */
async function assertBindings(baseId: string, c: AppConfig) {
  const tables = new Set((await db.select({ id: baseTables.id }).from(baseTables).where(and(eq(baseTables.baseId, baseId), isNull(baseTables.archivedAt)))).map((t) => t.id));
  const check = (id?: string) => { if (id && !tables.has(id)) throw invalid("A component is bound to a table outside this app's base."); };
  for (const p of c.pages) {
    check(p.tableId);
    for (const comp of p.components) { check(comp.props.data?.tableId); check(comp.props.action?.tableId); }
  }
  if (c.portal) {
    check(c.portal.tableId);
    const [f] = await db.select().from(baseFields).where(and(eq(baseFields.id, c.portal.emailFieldId), eq(baseFields.tableId, c.portal.tableId))).limit(1);
    if (!f || f.type !== "email") throw invalid("Portal scope needs an email field on the portal table.");
  }
}

export async function createApp(ctx: Ctx, input: { baseId: string; name: string; audience?: "workspace" | "portal"; config?: AppConfig; icon?: string; color?: string; description?: string; templateKey?: string }) {
  const access = await baseAccess(ctx, input.baseId); requireRole(access, "creator", "create apps");
  if (!input.name?.trim()) throw invalid("Name the app.");
  const config = validateAppConfig(input.config ?? { pages: [{ id: "p_home", title: "Home", slug: "home", kind: "dashboard", components: [{ id: "c_title", type: "heading", w: 12, props: { title: input.name.trim(), subtitle: "" } }] }], homePageId: "p_home" });
  await assertBindings(input.baseId, config);
  if (input.audience === "portal" && !config.portal) throw invalid("Portal apps need a portal scope (table + email field).");
  const [row] = await db.insert(apps).values({ orgId: ctx.orgId, baseId: input.baseId, name: input.name.trim().slice(0, 80), slug: await uniqueSlug(ctx.orgId, input.name), audience: input.audience ?? "workspace", draft: config as unknown as Record<string, unknown>, icon: input.icon ?? "grid", color: input.color ?? "blue", description: input.description ?? null, templateKey: input.templateKey ?? null, createdBy: ctx.userId }).returning();
  await audit(db, ctx, "create_app", "apps", row.id, { meta: { name: row.name, baseId: row.baseId } });
  return row;
}

export async function updateAppMeta(ctx: Ctx, appId: string, patch: { name?: string; description?: string | null; icon?: string; color?: string }) {
  const { app } = await appForEdit(ctx, appId);
  const set: Partial<AppRow> = { updatedAt: new Date() };
  if (patch.name !== undefined) { if (!patch.name.trim()) throw invalid("Name the app."); set.name = patch.name.trim().slice(0, 80); }
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.icon) set.icon = patch.icon; if (patch.color) set.color = patch.color;
  await db.update(apps).set(set).where(eq(apps.id, app.id));
}

/** Autosave. `expectedRevision` guards against two editors overwriting each other. */
export async function saveDraft(ctx: Ctx, appId: string, config: AppConfig, expectedRevision: number) {
  const { app } = await appForEdit(ctx, appId);
  const c = validateAppConfig(structuredClone(config));
  await assertBindings(app.baseId, c);
  const [row] = await db.update(apps).set({ draft: c as unknown as Record<string, unknown>, draftRevision: app.draftRevision + 1, updatedAt: new Date() })
    .where(and(eq(apps.id, app.id), eq(apps.draftRevision, expectedRevision))).returning({ rev: apps.draftRevision });
  if (!row) throw conflict("Someone else changed this app's draft. Reload to get their changes before saving.");
  return { revision: row.rev };
}

export async function publishApp(ctx: Ctx, appId: string, note?: string) {
  const { app } = await appForEdit(ctx, appId);
  const c = validateAppConfig(structuredClone(app.draft as unknown as AppConfig));
  await assertBindings(app.baseId, c);
  if (!c.pages.some((p) => p.kind !== "detail")) throw invalid("Add at least one page before publishing.");
  return db.transaction(async (tx) => {
    const [{ v }] = await tx.select({ v: max(appVersions.version) }).from(appVersions).where(eq(appVersions.appId, app.id));
    const [ver] = await tx.insert(appVersions).values({ orgId: ctx.orgId, appId: app.id, version: (v ?? 0) + 1, config: c as unknown as Record<string, unknown>, note: note?.slice(0, 200) ?? null, publishedBy: ctx.userId }).returning();
    await tx.update(apps).set({ publishedVersionId: ver.id, updatedAt: new Date() }).where(eq(apps.id, app.id));
    await audit(tx, ctx, "publish_app", "apps", app.id, { meta: { version: ver.version, note } });
    return ver;
  });
}

export async function listVersions(ctx: Ctx, appId: string) {
  await appForEdit(ctx, appId);
  return db.select({ id: appVersions.id, version: appVersions.version, note: appVersions.note, publishedAt: appVersions.publishedAt }).from(appVersions).where(eq(appVersions.appId, appId)).orderBy(desc(appVersions.version));
}

/** Roll back = republish an earlier version as a new version, and reset the draft to it. History is never rewritten. */
export async function rollbackApp(ctx: Ctx, appId: string, versionId: string) {
  const { app } = await appForEdit(ctx, appId);
  const [old] = await db.select().from(appVersions).where(and(eq(appVersions.id, versionId), eq(appVersions.appId, app.id))).limit(1);
  if (!old) throw notFound("Version not found.");
  await db.update(apps).set({ draft: old.config, draftRevision: app.draftRevision + 1 }).where(eq(apps.id, app.id));
  return publishApp(ctx, app.id, `Rollback to v${old.version}`);
}

export async function archiveApp(ctx: Ctx, appId: string) {
  const { app } = await appForEdit(ctx, appId);
  await db.update(apps).set({ archivedAt: new Date() }).where(eq(apps.id, app.id));
  await audit(db, ctx, "archive_app", "apps", app.id, { meta: { name: app.name } });
}

// ───────── Runtime resolution ─────────
export interface Runtime { app: AppRow; config: AppConfig; role: Role; mode: "published" | "preview"; versionLabel: string; scopeIds: string[] | null; canBuild: boolean }

export async function resolveRuntime(ctx: Ctx, slug: string, preview = false): Promise<Runtime> {
  const [app] = await db.select().from(apps).where(and(eq(apps.orgId, ctx.orgId), eq(apps.slug, slug), isNull(apps.archivedAt))).limit(1);
  if (!app) throw notFound("App not found.");
  let role: Role; let canBuild = false;
  if (ctx.platformRole === "portal") {
    if (app.audience !== "portal") throw notFound("App not found.");
    role = "portal";
  } else {
    const access = await baseAccess(ctx, app.baseId).catch(() => null);
    if (!access) throw notFound("App not found.");
    role = access.role as Role; canBuild = atLeast(role, "creator");
  }
  let config: AppConfig; let versionLabel: string; let mode: Runtime["mode"] = "published";
  if (preview) {
    if (!canBuild) throw forbidden("Only creators can preview drafts.");
    config = app.draft as unknown as AppConfig; versionLabel = "Draft preview"; mode = "preview";
  } else {
    if (!app.publishedVersionId) { if (canBuild) throw notFound("This app hasn't been published yet — open it in the builder."); throw notFound("App not found."); }
    const [v] = await db.select().from(appVersions).where(eq(appVersions.id, app.publishedVersionId)).limit(1);
    config = v.config as unknown as AppConfig; versionLabel = `v${v.version}`;
  }
  let scopeIds: string[] | null = null;
  if (app.audience === "portal" && role === "portal") {
    if (!config.portal) throw notFound("App not found.");
    const v = await runView(ctx, "owner", config.portal.tableId, { filters: { conjunction: "and", conditions: [{ fieldId: config.portal.emailFieldId, op: "is", value: ctx.email }] } }, {});
    scopeIds = v.rows.map((r) => r.id);
  }
  return { app, config, role, mode, versionLabel, scopeIds, canBuild };
}

export const canSee = (role: Role, visibleTo?: Role[]) => !visibleTo?.length || visibleTo.includes(role) || (role !== "portal" && visibleTo.some((r) => r !== "portal" && atLeast(role, r)));
export function visiblePages(rt: Pick<Runtime, "config" | "role">) { return rt.config.pages.filter((p) => canSee(rt.role, p.visibleTo)); }
export function findPage(rt: Pick<Runtime, "config" | "role">, slug?: string): Page | undefined {
  const pages = visiblePages(rt);
  return slug ? pages.find((p) => p.slug === slug) : pages.find((p) => p.id === rt.config.homePageId && p.kind !== "detail") ?? pages.find((p) => p.kind !== "detail");
}
export function findComponent(page: Page, id: string): Component | undefined { return page.components.find((c) => c.id === id); }
