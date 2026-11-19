import { and, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { productions } from "@/db/schema";
import { canRead, canWrite, type Domain } from "@/lib/permissions";
import type { Ctx } from "../auth/context";
import { forbidden, notFound } from "../errors";
import { productionAllowed } from "../entities/crud";

export function requireRead(ctx: Ctx, domain: Domain) { if (!canRead(ctx.role, domain)) throw forbidden(); }
export function requireWrite(ctx: Ctx, domain: Domain, entityKey?: string) { if (!canWrite(ctx.role, domain, entityKey)) throw forbidden(); }

/** Load a production the caller is allowed to access, or throw. */
export async function loadProduction(ctx: Ctx, productionId: string, tx: DbOrTx = db) {
  if (!/^[0-9a-f-]{36}$/i.test(productionId)) throw notFound("Production not found.");
  const [p] = await tx.select().from(productions).where(and(eq(productions.id, productionId), eq(productions.orgId, ctx.orgId), isNull(productions.archivedAt))).limit(1);
  if (!p || !productionAllowed(ctx, p.id)) throw notFound("Production not found.");
  return p;
}

export function assertProductionAccess(ctx: Ctx, productionId: string) {
  if (!productionAllowed(ctx, productionId)) throw notFound();
}
