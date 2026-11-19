import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organisations, productionMembers, sessions, users } from "@/db/schema";
import { isGlobalProductionRole, type Role } from "@/lib/permissions";
import type { Ctx } from "./context";
import { DUMMY_HASH, newToken, sha256, verifyPassword } from "./password";

export const SESSION_COOKIE = "pos_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export async function authenticate(email: string, password: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  // Always run a hash comparison to reduce user-enumeration timing differences.
  const ok = await verifyPassword(password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok || u.disabledAt) return null;
  return u;
}

export async function createSession(userId: string, orgId?: string, userAgent?: string) {
  const [m] = await db.select().from(memberships)
    .where(orgId ? and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)) : eq(memberships.userId, userId)).limit(1);
  if (!m) throw new Error("User has no organisation membership");
  const token = newToken();
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, orgId: m.orgId, expiresAt: new Date(Date.now() + SESSION_TTL_MS), userAgent: userAgent?.slice(0, 300) });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  return token;
}

export async function destroySession(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function contextForUser(userId: string, orgId: string): Promise<Ctx | null> {
  const [row] = await db
    .select({ user: users, m: memberships, org: organisations })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(organisations, eq(organisations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId), isNull(users.disabledAt)))
    .limit(1);
  if (!row) return null;
  const role = row.m.role as Role;
  let productionIds: Ctx["productionIds"] = "all";
  if (!isGlobalProductionRole(role)) {
    const pm = await db.select({ id: productionMembers.productionId }).from(productionMembers)
      .where(and(eq(productionMembers.userId, userId), eq(productionMembers.orgId, orgId)));
    productionIds = pm.map((p) => p.id);
  }
  return { userId, orgId, role, name: row.user.name, email: row.user.email, personId: row.m.personId, productionIds, orgName: row.org.name, orgIsDemo: row.org.isDemo };
}

export async function contextFromToken(token: string | undefined | null): Promise<Ctx | null> {
  if (!token) return null;
  const [s] = await db.select().from(sessions).where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  if (!s) return null;
  return contextForUser(s.userId, s.orgId);
}

export async function revokeUserSessions(userIds: string[]) {
  if (userIds.length) await db.delete(sessions).where(inArray(sessions.userId, userIds));
}
