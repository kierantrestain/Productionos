import { and, asc, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { apiTokens, invites, memberships, organisations, productionMembers, productions, users } from "@/db/schema";
import { ROLES, type Role } from "@/lib/permissions";
import type { Ctx } from "../auth/context";
import { hashPassword, newToken, sha256 } from "../auth/password";
import { revokeUserSessions } from "../auth/sessions";
import { audit } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { ensureWorkflowDefinitions } from "../workflows/registry";

const requireAdmin = (ctx: Ctx) => { if (ctx.role !== "org_admin") throw forbidden("Organisation admin only."); };

export async function createOrganisation(input: { name: string; slug: string; isDemo?: boolean }, tx: DbOrTx = db) {
  const [org] = await tx.insert(organisations).values({ name: input.name, slug: input.slug, isDemo: !!input.isDemo }).returning();
  await ensureWorkflowDefinitions(org.id, tx);
  return org;
}

export async function createUserWithMembership(input: { orgId: string; email: string; name: string; password?: string | null; role: Role; personId?: string | null; productionIds?: string[] }, tx: DbOrTx = db) {
  if (!ROLES.includes(input.role)) throw invalid("Unknown role");
  const email = input.email.trim().toLowerCase();
  let [u] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u) [u] = await tx.insert(users).values({ email, name: input.name, passwordHash: input.password ? await hashPassword(input.password) : null }).returning();
  await tx.insert(memberships).values({ orgId: input.orgId, userId: u.id, role: input.role, personId: input.personId ?? null })
    .onConflictDoUpdate({ target: [memberships.orgId, memberships.userId], set: { role: input.role, personId: input.personId ?? null } });
  for (const pid of input.productionIds ?? []) await tx.insert(productionMembers).values({ orgId: input.orgId, productionId: pid, userId: u.id }).onConflictDoNothing();
  return u;
}

export async function listMembers(ctx: Ctx) {
  requireAdmin(ctx);
  const rows = await db.select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, personId: memberships.personId, disabledAt: users.disabledAt, lastLoginAt: users.lastLoginAt })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, ctx.orgId)).orderBy(asc(users.name));
  const pm = await db.select().from(productionMembers).where(eq(productionMembers.orgId, ctx.orgId));
  return rows.map((r) => ({ ...r, productionIds: pm.filter((p) => p.userId === r.userId).map((p) => p.productionId) }));
}

export async function setMemberRole(ctx: Ctx, userId: string, role: Role) {
  requireAdmin(ctx);
  if (!ROLES.includes(role)) throw invalid("Unknown role");
  if (userId === ctx.userId && role !== "org_admin") throw invalid("You cannot remove your own admin role.");
  await db.transaction(async (tx) => {
    const [m] = await tx.update(memberships).set({ role }).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId))).returning();
    if (!m) throw notFound();
    await audit(tx, ctx, "set_role", "memberships", m.id, { after: { userId, role } });
  });
  await revokeUserSessions([userId]);
}

export async function setMemberProductions(ctx: Ctx, userId: string, productionIds: string[]) {
  requireAdmin(ctx);
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId))).limit(1);
    if (!m) throw notFound();
    const valid = await tx.select({ id: productions.id }).from(productions).where(eq(productions.orgId, ctx.orgId));
    const ok = new Set(valid.map((v) => v.id));
    await tx.delete(productionMembers).where(and(eq(productionMembers.orgId, ctx.orgId), eq(productionMembers.userId, userId)));
    for (const pid of productionIds.filter((p) => ok.has(p))) await tx.insert(productionMembers).values({ orgId: ctx.orgId, productionId: pid, userId });
    await audit(tx, ctx, "set_productions", "memberships", m.id, { after: { userId, productionIds } });
  });
}

export async function setMemberDisabled(ctx: Ctx, userId: string, disabled: boolean) {
  requireAdmin(ctx);
  if (userId === ctx.userId) throw invalid("You cannot disable yourself.");
  const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId))).limit(1);
  if (!m) throw notFound();
  await db.update(users).set({ disabledAt: disabled ? new Date() : null }).where(eq(users.id, userId));
  if (disabled) await revokeUserSessions([userId]);
  await audit(db, ctx, disabled ? "disable_user" : "enable_user", "memberships", m.id, { after: { userId } });
}

/** Invite: returns a one-time token (shown once to the admin; only its hash is stored). */
export async function createInvite(ctx: Ctx, email: string, role: Role, productionIds: string[] = []) {
  requireAdmin(ctx);
  if (!ROLES.includes(role)) throw invalid("Unknown role");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid("Invalid email");
  const token = newToken();
  const [inv] = await db.insert(invites).values({ orgId: ctx.orgId, email: email.trim().toLowerCase(), role, tokenHash: sha256(token), productionIds, invitedBy: ctx.userId, expiresAt: new Date(Date.now() + 7 * 864e5) }).returning();
  await audit(db, ctx, "invite", "invites", inv.id, { after: { email: inv.email, role } });
  return { invite: inv, token };
}

export async function acceptInvite(token: string, name: string, password: string) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invites).where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.acceptedAt))).limit(1);
    if (!inv || inv.expiresAt < new Date()) throw invalid("This invitation is invalid or has expired.");
    const u = await createUserWithMembership({ orgId: inv.orgId, email: inv.email, name, password, role: inv.role as Role, productionIds: inv.productionIds }, tx);
    await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, inv.id));
    return { userId: u.id, orgId: inv.orgId };
  });
}

export async function listInvites(ctx: Ctx) {
  requireAdmin(ctx);
  return db.select({ id: invites.id, email: invites.email, role: invites.role, acceptedAt: invites.acceptedAt, expiresAt: invites.expiresAt, createdAt: invites.createdAt }).from(invites).where(eq(invites.orgId, ctx.orgId)).orderBy(asc(invites.createdAt));
}

/** Integration API tokens (SWDR / Mimic OS). Returns plaintext once. */
export async function createApiToken(ctx: Ctx, name: string, scopes: string[]) {
  requireAdmin(ctx);
  const allowed = ["productions:read", "schedule:read", "status:read", "scripts:write"];
  const bad = scopes.filter((s) => !allowed.includes(s));
  if (bad.length || !scopes.length) throw invalid(`Scopes must be from: ${allowed.join(", ")}`);
  const token = `pos_${newToken()}`;
  const [t] = await db.insert(apiTokens).values({ orgId: ctx.orgId, name, tokenHash: sha256(token), scopes, createdBy: ctx.userId }).returning();
  await audit(db, ctx, "create_api_token", "api_tokens", t.id, { after: { name, scopes } });
  return { token, id: t.id };
}

export async function listApiTokens(ctx: Ctx) {
  requireAdmin(ctx);
  return db.select({ id: apiTokens.id, name: apiTokens.name, scopes: apiTokens.scopes, lastUsedAt: apiTokens.lastUsedAt, revokedAt: apiTokens.revokedAt, createdAt: apiTokens.createdAt }).from(apiTokens).where(eq(apiTokens.orgId, ctx.orgId));
}

export async function revokeApiToken(ctx: Ctx, id: string) {
  requireAdmin(ctx);
  await db.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.id, id), eq(apiTokens.orgId, ctx.orgId)));
  await audit(db, ctx, "revoke_api_token", "api_tokens", id);
}
