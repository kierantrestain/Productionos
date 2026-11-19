import type { DbOrTx } from "@/db";
import { productionMembers, resourceCheckouts, resources } from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { invalid } from "../errors";
import { isGlobalProductionRole } from "@/lib/permissions";
import type { Ctx } from "../auth/context";
import { emit } from "../audit";

type R = Record<string, unknown>;
export interface Hook {
  beforeCreate?: (tx: DbOrTx, ctx: Ctx, values: R) => Promise<void>;
  beforeUpdate?: (tx: DbOrTx, ctx: Ctx, existing: R, patch: R) => Promise<void>;
  afterWrite?: (tx: DbOrTx, ctx: Ctx, before: R | null, after: R) => Promise<void>;
}

const filled = (v: unknown) => typeof v === "string" ? v.trim().length > 0 : v != null;

const withCurrency: Hook = { async beforeCreate(_tx, ctx, v) { if (!v.currency && ctx.settings?.currency) v.currency = ctx.settings.currency; } };

export const HOOKS: Record<string, Hook> = {
  resource_checkouts: {
    /** You can't check out more units than exist. */
    async beforeCreate(tx, ctx, v) {
      if (v.inAt) return;
      const [r] = await tx.select().from(resources).where(and(eq(resources.id, v.resourceId as string), eq(resources.orgId, ctx.orgId))).limit(1);
      if (!r) return;
      if (["maintenance", "lost", "retired"].includes(r.status)) throw invalid(`${r.name} is ${r.status} and can't be checked out.`);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(resourceCheckouts).where(and(eq(resourceCheckouts.resourceId, r.id), isNull(resourceCheckouts.inAt), isNull(resourceCheckouts.archivedAt)));
      if (n >= r.quantity) throw invalid(`All ${r.quantity} of ${r.name} are already checked out.`);
    },
    /** Keep the resource's status in step with open checkouts. */
    async afterWrite(tx, ctx, before, after) {
      if (before && (before.inAt ?? null) === (after.inAt ?? null)) return;
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(resourceCheckouts).where(and(eq(resourceCheckouts.resourceId, after.resourceId as string), isNull(resourceCheckouts.inAt), isNull(resourceCheckouts.archivedAt)));
      await tx.update(resources).set({ status: n > 0 ? "checked_out" : "available", updatedAt: new Date() })
        .where(and(eq(resources.id, after.resourceId as string), eq(resources.orgId, ctx.orgId), inArray(resources.status, ["available", "booked", "checked_out"])));
    },
  },
  budgets: withCurrency,
  budget_lines: { async beforeCreate(_tx, ctx, v) { if (v.vatRateBp == null && ctx.settings?.defaultVatBp != null) v.vatRateBp = ctx.settings.defaultVatBp; } },
  productions: {
    async beforeCreate(_tx, ctx, v) {
      if (!v.currency && ctx.settings?.currency) v.currency = ctx.settings.currency;
      if (!v.timezone && ctx.settings?.timezone) v.timezone = ctx.settings.timezone;
    },
    async afterWrite(tx, ctx, before, after) {
      // Creators who are production-scoped become members so they can see what they created.
      if (!before && !isGlobalProductionRole(ctx.role)) {
        await tx.insert(productionMembers).values({ orgId: ctx.orgId, productionId: after.id as string, userId: ctx.userId }).onConflictDoNothing();
        if (Array.isArray(ctx.productionIds)) ctx.productionIds.push(after.id as string);
      }
    },
  },
  scenes: {
    /**
     * Port of S'appening "Update Shot List when Scene Name and Director are not empty".
     * Emits scene.ready_for_shots once per scene (idempotency key); the workflow engine then
     * creates at most one initial shot guarded by a unique generation key.
     */
    async afterWrite(tx, ctx, before, after) {
      const readyNow = filled(after.title) && filled(after.director);
      const readyBefore = before ? filled(before.title) && filled(before.director) : false;
      if (readyNow && !readyBefore) {
        await emit(tx, {
          orgId: ctx.orgId, type: "scene.ready_for_shots", entityType: "scenes", entityId: after.id as string,
          productionId: after.productionId as string, idempotencyKey: `scene.ready_for_shots:${after.id}`, actorUserId: ctx.userId,
          payload: { sceneId: after.id, number: after.number },
        });
      }
    },
  },
  release_forms: {
    async beforeUpdate(_tx, _ctx, existing, patch) {
      if (patch.status === "signed" && existing.status !== "signed" && !patch.signedAt) patch.signedAt = new Date();
    },
  },
  post_tasks: {
    async afterWrite(tx, ctx, before, after) {
      if (before && before.status !== "done" && after.status === "done") {
        await emit(tx, { orgId: ctx.orgId, type: "post_task.completed", entityType: "post_tasks", entityId: after.id as string, productionId: after.productionId as string, idempotencyKey: `post_task.completed:${after.id}:v${after.version}`, actorUserId: ctx.userId });
      }
    },
  },
};
