/**
 * Platform access control. Effective role on a base = explicit base membership, else workspace role.
 * Ranks: owner 5 > creator 4 > editor 3 > commenter 2 > reader 1. Commenter and reader are free seats.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { baseMembers, bases } from "@/db/schema";
import type { Ctx } from "../auth/context";
import { forbidden, notFound } from "../errors";

export const RANK: Record<string, number> = { owner: 5, creator: 4, editor: 3, commenter: 2, reader: 1, none: 0 };
export const rank = (r?: string | null) => (r ? RANK[r] ?? 0 : 0);
export const atLeast = (role: string, min?: string | null) => !min || rank(role) >= rank(min);
export const FREE_ROLES = new Set(["commenter", "reader"]);

export interface BaseAccess { base: typeof bases.$inferSelect; role: string }

/**
 * Effective base role:
 *  - an explicit base membership wins ("none" = explicit deny);
 *  - workspace-visible bases otherwise fall back to the workspace role;
 *  - private bases otherwise admit only workspace owners (who administer everything).
 * Inaccessible bases are reported as not found, so their existence isn't leaked.
 */
export function effectiveRole(visibility: string, workspaceRole: string | undefined, memberRole: string | undefined): string | null {
  if (memberRole === "none") return workspaceRole === "owner" ? "owner" : null;
  if (memberRole) return memberRole;
  if (visibility === "private") return workspaceRole === "owner" ? "owner" : null;
  return workspaceRole ?? "reader";
}

export async function baseAccess(ctx: Ctx, baseId: string, tx: DbOrTx = db): Promise<BaseAccess> {
  if (!/^[0-9a-f-]{36}$/i.test(baseId)) throw notFound("Base not found.");
  const [b] = await tx.select().from(bases).where(and(eq(bases.id, baseId), eq(bases.orgId, ctx.orgId), isNull(bases.archivedAt))).limit(1);
  if (!b) throw notFound("Base not found.");
  const [m] = await tx.select().from(baseMembers).where(and(eq(baseMembers.baseId, baseId), eq(baseMembers.userId, ctx.userId))).limit(1);
  const role = effectiveRole(b.visibility, ctx.platformRole, m?.role);
  if (!role || rank(role) < 1) throw notFound("Base not found.");
  return { base: b, role };
}

/** Effective roles for many bases at once (base listing, cross-base checks). Missing = no access. */
export async function baseRoles(ctx: Ctx, baseIds: string[], tx: DbOrTx = db): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!baseIds.length) return out;
  const rows = await tx.select({ id: bases.id, visibility: bases.visibility }).from(bases).where(and(inArray(bases.id, baseIds), eq(bases.orgId, ctx.orgId), isNull(bases.archivedAt)));
  const members = await tx.select().from(baseMembers).where(and(inArray(baseMembers.baseId, baseIds), eq(baseMembers.userId, ctx.userId)));
  for (const b of rows) {
    const r = effectiveRole(b.visibility, ctx.platformRole, members.find((m) => m.baseId === b.id)?.role);
    if (r && rank(r) >= 1) out.set(b.id, r);
  }
  return out;
}

export function requireRole(access: { role: string }, min: string, what = "do that") {
  if (!atLeast(access.role, min)) throw forbidden(`You need ${min} access to ${what}.`);
}

/** Field visible to this role? (fields can be hidden from roles below a threshold) */
export const fieldVisible = (role: string, f: { permissions?: { hiddenBelow?: string } | null }) => atLeast(role, f.permissions?.hiddenBelow);
/** Field editable by this role? Editors+ by default, raised per field. */
export const fieldEditable = (role: string, f: { permissions?: { edit?: string } | null }) => atLeast(role, f.permissions?.edit ?? "editor");
