import { randomUUID } from "node:crypto";
import type { Role } from "@/lib/permissions";
import { contextForUser } from "@/server/auth/sessions";
import { createOrganisation, createUserWithMembership } from "@/server/services/admin";
import type { Ctx } from "@/server/auth/context";

/** TEST FIXTURES ONLY — synthetic data, never presented as imported source records. */
export async function makeOrg(label = "Test Org") {
  const org = await createOrganisation({ name: `${label} ${randomUUID().slice(0, 6)}`, slug: `t-${randomUUID()}`, isDemo: true });
  return org;
}

export async function makeUser(orgId: string, role: Role, opts: { productionIds?: string[]; personId?: string; password?: string } = {}): Promise<Ctx> {
  const u = await createUserWithMembership({ orgId, role, email: `${role}-${randomUUID()}@example.test`, name: `Test ${role}`, password: opts.password ?? null, productionIds: opts.productionIds, personId: opts.personId });
  const ctx = await contextForUser(u.id, orgId);
  if (!ctx) throw new Error("ctx");
  return ctx;
}

/** Refresh a context after membership changes (e.g. after creating a production). */
export async function refresh(ctx: Ctx) { return (await contextForUser(ctx.userId, ctx.orgId))!; }
