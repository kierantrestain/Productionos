import type { DbOrTx } from "@/db";
import { auditEvents, outboxEvents } from "@/db/schema";
import type { Ctx } from "./auth/context";

/** Fields never written to audit payloads. */
const NEVER_AUDIT = new Set(["passwordHash", "tokenHash", "raw"]);

function clean(obj: Record<string, unknown> | null | undefined) {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!NEVER_AUDIT.has(k)) out[k] = v;
  return out;
}

/** Only the changed keys, for compact, readable history. */
export function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before || !after) return { before: clean(before), after: clean(after) };
  const b: Record<string, unknown> = {}, a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (NEVER_AUDIT.has(k) || k === "updatedAt" || k === "version") continue;
    const bv = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const av = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) { b[k] = bv; a[k] = av; }
  }
  return { before: b, after: a };
}

export async function audit(tx: DbOrTx, ctx: Pick<Ctx, "orgId" | "userId" | "name">, action: string, entityType: string, entityId: string | null,
  opts: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; productionId?: string | null; meta?: Record<string, unknown> } = {}) {
  const d = diff(opts.before ?? null, opts.after ?? null);
  await tx.insert(auditEvents).values({
    orgId: ctx.orgId, actorUserId: ctx.userId, actorLabel: ctx.name, action, entityType, entityId,
    productionId: opts.productionId ?? null, before: d.before, after: d.after, meta: opts.meta ?? null,
  });
}

export interface EmitInput {
  orgId: string;
  type: string;
  entityType?: string;
  entityId?: string;
  productionId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  origin?: "user" | "import" | "system" | "api";
  actorUserId?: string | null;
}

/**
 * Transactional outbox: call inside the same transaction as the business write.
 * Duplicate idempotency keys are ignored, so retried requests never double-emit.
 * Import-origin events are stored as `suppressed` — imports never trigger side effects.
 */
export async function emit(tx: DbOrTx, e: EmitInput) {
  await tx.insert(outboxEvents).values({
    orgId: e.orgId, type: e.type, entityType: e.entityType, entityId: e.entityId, productionId: e.productionId ?? null,
    payload: e.payload ?? {}, idempotencyKey: e.idempotencyKey, origin: e.origin ?? "user", actorUserId: e.actorUserId ?? null,
    status: e.origin === "import" ? "suppressed" : "pending",
  }).onConflictDoNothing({ target: outboxEvents.idempotencyKey });
}

/** Standard change event for workflow-driven transitions, so custom rules can react to them. */
export async function emitChanged(tx: DbOrTx, ctx: Pick<Ctx, "orgId" | "userId">, entity: string, row: { id: string; version?: number; productionId?: string | null; [k: string]: unknown }, changed: string[], salt = "") {
  await emit(tx, {
    orgId: ctx.orgId, type: `${entity}.updated`, entityType: entity, entityId: row.id, productionId: row.productionId ?? null,
    idempotencyKey: `${entity}.updated:${row.id}:v${row.version ?? 0}${salt ? `:${salt}` : ""}`, actorUserId: ctx.userId, payload: { version: row.version ?? 0, changed, depth: 0, values: Object.fromEntries(changed.filter((k) => k in row).map((k) => [k, row[k]])) },
  });
}
