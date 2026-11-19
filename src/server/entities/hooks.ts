import type { DbOrTx } from "@/db";
import { productionMembers } from "@/db/schema";
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

export const HOOKS: Record<string, Hook> = {
  productions: {
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
