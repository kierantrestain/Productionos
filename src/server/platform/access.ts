/**
 * Platform access control. Effective role on a base = explicit base membership, else workspace role.
 * Ranks: owner 5 > creator 4 > editor 3 > commenter 2 > reader 1. Commenter and reader are free seats.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { baseMembers, bases } from "@/db/schema";
import type { Ctx } from "../auth/context";
import { forbidden, notFound } from "../errors";

export const RANK: Record<string, number> = { owner: 5, creator: 4, editor: 3, commenter: 2, reader: 1 };
export const rank = (r?: string | null) => (r ? RANK[r] ?? 0 : 0);
export const atLeast = (role: string, min?: string | null) => !min || rank(role) >= rank(min);
export const FREE_ROLES = new Set(["commenter", "reader"]);

export interface BaseAccess { base: typeof bases.$inferSelect; role: string }

export async function baseAccess(ctx: Ctx, baseId: string, tx: DbOrTx = db): Promise<BaseAccess> {
  if (!/^[0-9a-f-]{36}$/i.test(baseId)) throw notFound("Base not found.");
  const [b] = await tx.select().from(bases).where(and(eq(bases.id, baseId), eq(bases.orgId, ctx.orgId), isNull(bases.archivedAt))).limit(1);
  if (!b) throw notFound("Base not found.");
  const [m] = await tx.select().from(baseMembers).where(and(eq(baseMembers.baseId, baseId), eq(baseMembers.userId, ctx.userId))).limit(1);
  const role = m?.role ?? ctx.platformRole ?? "reader";
  if (rank(role) < 1) throw notFound("Base not found.");
  return { base: b, role };
}

export function requireRole(access: { role: string }, min: string, what = "do that") {
  if (!atLeast(access.role, min)) throw forbidden(`You need ${min} access to ${what}.`);
}

/** Field visible to this role? (fields can be hidden from roles below a threshold) */
export const fieldVisible = (role: string, f: { permissions?: { hiddenBelow?: string } | null }) => atLeast(role, f.permissions?.hiddenBelow);
/** Field editable by this role? Editors+ by default, raised per field. */
export const fieldEditable = (role: string, f: { permissions?: { edit?: string } | null }) => atLeast(role, f.permissions?.edit ?? "editor");
