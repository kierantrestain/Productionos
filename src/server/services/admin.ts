import { and, asc, eq, isNull, sql } from "drizzle-orm";
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

// ───────────── First-run setup ─────────────

/**
 * Setup is needed when nobody exists yet, or when a previous first-run attempt never completed
 * (no organisation marked setupComplete) AND nobody has ever signed in. The second case recovers
 * from a setup request that was interrupted after creating the account.
 */
export async function needsSetup(tx: DbOrTx = db) {
  const [anyUser] = await tx.select({ id: users.id }).from(users).limit(1);
  if (!anyUser) return true;
  const [done] = await tx.select({ id: organisations.id }).from(organisations).where(sql`(${organisations.settings} ->> 'setupComplete') = 'true'`).limit(1);
  if (done) return false;
  const [signedIn] = await tx.select({ id: users.id }).from(users).where(sql`${users.lastLoginAt} is not null`).limit(1);
  return !signedIn;
}

/** Creates the first organisation and its admin. Refuses once any user exists (race-safe via advisory lock). */
export async function firstRunSetup(input: { orgName: string; name: string; email: string; password: string }) {
  if (input.password.length < 10) throw invalid("Use a password of at least 10 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw invalid("Enter a valid email.");
  const orgName = input.orgName.trim() || "My Production Company";
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('first-run-setup'))`);
    if (!(await needsSetup(tx))) throw forbidden("Setup has already been completed. Sign in instead.");
    // Recover from an interrupted first run: remove the never-used partial install, then start clean.
    const [stale] = await tx.select({ id: users.id }).from(users).limit(1);
    if (stale) {
      await tx.execute(sql`set local app.allow_history_purge = 'on'`);
      await tx.delete(organisations);
      await tx.delete(users);
    }
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";
    const org = await createOrganisation({ name: orgName, slug: `${slug}-${newToken().slice(0, 6).toLowerCase()}` }, tx);
    const u = await createUserWithMembership({ orgId: org.id, email: input.email, name: input.name.trim() || "Admin", password: input.password, role: "org_admin" }, tx);
    await tx.update(organisations).set({ settings: { setupComplete: true } as never }).where(eq(organisations.id, org.id));
    return { orgId: org.id, userId: u.id };
  });
}

export async function myOrganisations(userId: string) {
  return db.select({ id: organisations.id, name: organisations.name, isDemo: organisations.isDemo, role: memberships.role })
    .from(memberships).innerJoin(organisations, eq(organisations.id, memberships.orgId)).where(eq(memberships.userId, userId)).orderBy(asc(organisations.name));
}

// ───────────── Demo role logins (developer testing) ─────────────

/**
 * Generate a fresh shared password for the demo workspace's role accounts and return it once.
 * Only allowed in an is_demo organisation, and only for accounts whose memberships are ALL in
 * demo organisations — real users can never be reset through this path.
 */
export async function resetDemoRoleLogins(ctx: Ctx) {
  requireAdmin(ctx);
  const [org] = await db.select().from(organisations).where(eq(organisations.id, ctx.orgId)).limit(1);
  if (!org?.isDemo) throw forbidden("Role test logins are only available in the demo workspace.");
  const members = await db.select({ userId: users.id, email: users.email, name: users.name, role: memberships.role }).from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, ctx.orgId)).orderBy(asc(memberships.role));
  const candidates = members.filter((m) => m.userId !== ctx.userId && m.email.endsWith("@demo.productionos.test"));
  const safe: typeof candidates = [];
  for (const m of candidates) {
    const all = await db.select({ isDemo: organisations.isDemo }).from(memberships).innerJoin(organisations, eq(organisations.id, memberships.orgId)).where(eq(memberships.userId, m.userId));
    if (all.every((o) => o.isDemo)) safe.push(m);
  }
  const password = `demo-${newToken().slice(0, 14)}`;
  const hash = await hashPassword(password);
  for (const m of safe) await db.update(users).set({ passwordHash: hash, disabledAt: null }).where(eq(users.id, m.userId));
  await revokeUserSessions(safe.map((m) => m.userId));
  await audit(db, ctx, "reset_demo_role_logins", "organisations", ctx.orgId, { meta: { accounts: safe.length } });
  return { password, accounts: safe.map((m) => ({ email: m.email, name: m.name, role: m.role })) };
}
