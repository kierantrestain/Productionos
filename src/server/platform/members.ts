/**
 * Platform membership: workspace roles (owner, creator, editor = paid seats; commenter, reader = free
 * seats) and per-base overrides. Only owners change workspace roles; base owners/creators manage base
 * access. Every change is audited and the last owner can't be removed.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { baseMembers, invites, memberships, users } from "@/db/schema";
import type { Ctx } from "../auth/context";
import { newToken, sha256 } from "../auth/password";
import { audit } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { baseAccess, FREE_ROLES, RANK, requireRole } from "./access";

export const PLATFORM_ROLE_LIST = ["owner", "creator", "editor", "commenter", "reader"] as const;
const PROD_ROLE_FOR: Record<string, string> = { owner: "org_admin", creator: "producer", editor: "production_manager", commenter: "external_reviewer", reader: "external_reviewer" };

export async function listPlatformMembers(ctx: Ctx) {
  if (RANK[ctx.platformRole] < RANK.creator) throw forbidden("Only owners and creators can see the member list.");
  const rows = await db.select({ userId: users.id, name: users.name, email: users.email, platformRole: memberships.platformRole, disabledAt: users.disabledAt, lastLoginAt: users.lastLoginAt })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, ctx.orgId)).orderBy(asc(users.name));
  return rows.map((r) => ({ ...r, seat: FREE_ROLES.has(r.platformRole) ? "free" : "paid", disabledAt: r.disabledAt?.toISOString() ?? null, lastLoginAt: r.lastLoginAt?.toISOString() ?? null }));
}

export async function setPlatformRole(ctx: Ctx, userId: string, role: string) {
  if (ctx.platformRole !== "owner") throw forbidden("Only owners can change workspace roles.");
  if (!PLATFORM_ROLE_LIST.includes(role as never)) throw invalid("Unknown role.");
  const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId))).limit(1);
  if (!m) throw notFound("Member not found.");
  if (m.platformRole === "owner" && role !== "owner") {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.platformRole, "owner")));
    if (n <= 1) throw invalid("A workspace needs at least one owner.");
  }
  await db.update(memberships).set({ platformRole: role }).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)));
  await audit(db, ctx, "set_platform_role", "memberships", userId, { before: { role: m.platformRole }, after: { role } });
}

export async function inviteMember(ctx: Ctx, email: string, role: string) {
  if (ctx.platformRole !== "owner") throw forbidden("Only owners can invite members.");
  if (!PLATFORM_ROLE_LIST.includes(role as never)) throw invalid("Unknown role.");
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw invalid("Enter a valid email address.");
  const token = newToken();
  const [inv] = await db.insert(invites).values({ orgId: ctx.orgId, email: e, role: PROD_ROLE_FOR[role], platformRole: role, tokenHash: sha256(token), invitedBy: ctx.userId, expiresAt: new Date(Date.now() + 7 * 864e5) }).returning();
  await audit(db, ctx, "invite", "invites", inv.id, { after: { email: e, platformRole: role } });
  return { link: `/invite/${token}`, expiresAt: inv.expiresAt.toISOString() };
}

export async function listBaseMembers(ctx: Ctx, baseId: string) {
  await baseAccess(ctx, baseId);
  return db.select({ userId: baseMembers.userId, role: baseMembers.role, name: users.name }).from(baseMembers).innerJoin(users, eq(users.id, baseMembers.userId)).where(eq(baseMembers.baseId, baseId));
}

export async function setBaseMember(ctx: Ctx, baseId: string, userId: string, role: string | null) {
  const a = await baseAccess(ctx, baseId); requireRole(a, "creator", "share this base");
  if (role && role !== "none" && !PLATFORM_ROLE_LIST.includes(role as never)) throw invalid("Unknown role.");
  if (role && RANK[role] > RANK[a.role]) throw forbidden("You can't grant more access than you have.");
  const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId))).limit(1);
  if (!m) throw notFound("That person isn't in this workspace.");
  if (userId === ctx.userId && (role === "none" || (role && RANK[role] < RANK.creator))) throw invalid("You can't remove your own management access to this base.");
  if (role === "none" && m.platformRole === "owner") throw invalid("Workspace owners can't be denied access — change their workspace role first.");
  if (role) await db.insert(baseMembers).values({ orgId: ctx.orgId, baseId, userId, role }).onConflictDoUpdate({ target: [baseMembers.baseId, baseMembers.userId], set: { role } });
  else await db.delete(baseMembers).where(and(eq(baseMembers.baseId, baseId), eq(baseMembers.userId, userId)));
  await audit(db, ctx, "set_base_member", "bases", baseId, { meta: { userId, role } });
}
