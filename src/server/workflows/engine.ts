/**
 * Workflow engine: drains the transactional outbox with row leases (FOR UPDATE SKIP LOCKED),
 * runs registered handlers idempotently (unique run key per workflow+event), retries transient
 * failures with exponential backoff and dead-letters after max attempts.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contracts, engagements, outboundMessages, outboxEvents, workflowDefinitions, workflowRuns } from "@/db/schema";
import { ProviderError, requestSignature, sendMail } from "../integrations/providers";
import { generateInitialShot } from "../services/production-ops";
import { BUILTIN_WORKFLOWS } from "./registry";
import { executeRule, rulesFor } from "./rules";

type Event = typeof outboxEvents.$inferSelect;
type HandlerResult = { status: "succeeded" | "skipped" | "blocked"; result?: Record<string, unknown> };
type Handler = { workflowKey: string; run: (e: Event) => Promise<HandlerResult> };

export class RetryableError extends Error {}

const HANDLERS: Record<string, Handler> = {
  "scene.ready_for_shots": {
    workflowKey: "SAP-SHOT-INIT",
    run: async (e) => db.transaction(async (tx) => {
      const r = await generateInitialShot(tx, e.orgId, e.entityId!);
      return { status: r.created ? "succeeded" : "skipped", result: { reason: r.reason, shotId: r.created?.id ?? null } };
    }),
  },
  "outbound_message.confirmed": {
    workflowKey: "SYS-MESSAGE-DISPATCH",
    run: async (e) => {
      const [m] = await db.select().from(outboundMessages).where(and(eq(outboundMessages.id, e.entityId!), eq(outboundMessages.orgId, e.orgId))).limit(1);
      if (!m) return { status: "skipped", result: { reason: "message_missing" } };
      if (m.status === "sent") return { status: "skipped", result: { reason: "already_sent" } };
      if (m.status !== "queued") return { status: "skipped", result: { reason: `status_${m.status}` } };
      try {
        const r = await sendMail({ to: m.toAddress!, subject: m.subject, body: m.body, idempotencyKey: m.idempotencyKey });
        await db.transaction(async (tx) => {
          await tx.update(outboundMessages).set({ status: "sent", sentAt: new Date(), providerMessageId: r.providerMessageId, attempts: sql`${outboundMessages.attempts} + 1`, lastError: null, updatedAt: new Date() }).where(eq(outboundMessages.id, m.id));
          if (m.template === "cast_details" && m.subjectId) await tx.update(engagements).set({ detailsEmailSentAt: new Date() }).where(eq(engagements.id, m.subjectId));
        });
        return { status: "succeeded", result: { providerMessageId: r.providerMessageId } };
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError(String((err as Error)?.message ?? err), true);
        await db.update(outboundMessages).set({ status: pe.retryable ? "queued" : "blocked_no_provider", attempts: sql`${outboundMessages.attempts} + 1`, lastError: pe.message, updatedAt: new Date() }).where(eq(outboundMessages.id, m.id));
        if (pe.retryable) throw new RetryableError(pe.message);
        return { status: "blocked", result: { reason: pe.message } };
      }
    },
  },
  "contract.send_requested": {
    workflowKey: "SYS-CONTRACT-SEND",
    run: async (e) => {
      const [c] = await db.select().from(contracts).where(and(eq(contracts.id, e.entityId!), eq(contracts.orgId, e.orgId))).limit(1);
      if (!c) return { status: "skipped", result: { reason: "contract_missing" } };
      if (c.status !== "approved") return { status: "skipped", result: { reason: `status_${c.status}` } };
      try {
        const r = await requestSignature({ contractId: c.id, title: c.title, signerEmail: "", idempotencyKey: e.idempotencyKey });
        await db.update(contracts).set({ status: "sent", providerRef: r.providerRef, updatedAt: new Date() }).where(eq(contracts.id, c.id));
        if (c.engagementId) await db.update(engagements).set({ contractStatus: "sent" }).where(eq(engagements.id, c.engagementId));
        return { status: "succeeded", result: { providerRef: r.providerRef } };
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError(String(err), true);
        if (pe.retryable) throw new RetryableError(pe.message);
        await db.update(contracts).set({ status: "blocked", updatedAt: new Date() }).where(eq(contracts.id, c.id));
        return { status: "blocked", result: { reason: pe.message } };
      }
    },
  },
};

export const handledEventTypes = Object.keys(HANDLERS);
const backoffMs = (attempt: number) => Math.min(30_000 * 2 ** (attempt - 1), 60 * 60 * 1000);

async function definitionFor(orgId: string, key: string) {
  const [d] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.orgId, orgId), eq(workflowDefinitions.key, key))).limit(1);
  return d;
}

/** Claim and process due outbox events. Safe to run concurrently from several workers. */
export async function processOutbox(opts: { limit?: number; orgId?: string } = {}) {
  const limit = opts.limit ?? 50;
  const claimed = (await db.execute(sql`
    update outbox_events set status = 'processing', locked_until = now() + interval '2 minutes', attempts = attempts + 1
    where id in (
      select id from outbox_events
      where status in ('pending', 'failed') and next_attempt_at <= now()
        and (locked_until is null or locked_until < now())
        ${opts.orgId ? sql`and org_id = ${opts.orgId}` : sql``}
      order by occurred_at limit ${limit} for update skip locked)
    returning id`)) as unknown as { id: string }[];
  const stats = { claimed: claimed.length, done: 0, retried: 0, dead: 0, skipped: 0 };
  for (const { id } of claimed) {
    const [e] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
    // Custom rules first (each idempotent per rule+event); failures are recorded but don't block built-in handlers.
    for (const rule of await rulesFor(e)) {
      const key = `${rule.key}:${e.id}`;
      const [prev] = await db.select().from(workflowRuns).where(eq(workflowRuns.idempotencyKey, key)).limit(1);
      if (prev && prev.status !== "failed") continue;
      try {
        const r = await executeRule(rule, e);
        await recordRun(e, rule.key, rule.ruleVersion, r.status, r.result);
      } catch (err) {
        await recordRun(e, rule.key, rule.ruleVersion, "failed", null, String((err as Error)?.message ?? err).slice(0, 500));
      }
    }
    const handler = HANDLERS[e.type];
    if (!handler) {
      await db.update(outboxEvents).set({ status: "done", processedAt: new Date(), lockedUntil: null }).where(eq(outboxEvents.id, e.id));
      stats.skipped++;
      continue;
    }
    const def = await definitionFor(e.orgId, handler.workflowKey);
    const builtin = BUILTIN_WORKFLOWS.find((w) => w.key === handler.workflowKey);
    const maxAttempts = def?.maxAttempts ?? builtin?.maxAttempts ?? 5;
    const runKey = `${handler.workflowKey}:${e.id}`;
    const [existingRun] = await db.select().from(workflowRuns).where(eq(workflowRuns.idempotencyKey, runKey)).limit(1);
    if (existingRun && ["succeeded", "skipped", "blocked"].includes(existingRun.status)) {
      await db.update(outboxEvents).set({ status: "done", processedAt: new Date(), lockedUntil: null }).where(eq(outboxEvents.id, e.id));
      stats.skipped++;
      continue;
    }
    if (!def || def.status !== "active") {
      await recordRun(e, handler.workflowKey, def?.ruleVersion ?? 0, "skipped", { reason: def ? `workflow ${def.status}` : "workflow not registered" });
      await db.update(outboxEvents).set({ status: "done", processedAt: new Date(), lockedUntil: null }).where(eq(outboxEvents.id, e.id));
      stats.skipped++;
      continue;
    }
    try {
      const r = await handler.run(e);
      await recordRun(e, handler.workflowKey, def.ruleVersion, r.status, r.result);
      await db.update(outboxEvents).set({ status: "done", processedAt: new Date(), lockedUntil: null, lastError: null }).where(eq(outboxEvents.id, e.id));
      stats.done++;
    } catch (err) {
      const msg = String((err as Error)?.message ?? err).slice(0, 1000);
      const dead = e.attempts >= maxAttempts;
      await recordRun(e, handler.workflowKey, def.ruleVersion, "failed", null, msg);
      await db.update(outboxEvents).set({ status: dead ? "dead" : "failed", lastError: msg, lockedUntil: null, nextAttemptAt: new Date(Date.now() + backoffMs(e.attempts)) }).where(eq(outboxEvents.id, e.id));
      if (dead) stats.dead++; else stats.retried++;
    }
  }
  return stats;
}

async function recordRun(e: Event, workflowKey: string, ruleVersion: number, status: string, result?: Record<string, unknown> | null, error?: string) {
  const key = `${workflowKey}:${e.id}`;
  await db.insert(workflowRuns).values({ orgId: e.orgId, workflowKey, ruleVersion, eventId: e.id, idempotencyKey: key, status, attempts: e.attempts, result: result ?? null, lastError: error ?? null, finishedAt: new Date() })
    .onConflictDoUpdate({ target: workflowRuns.idempotencyKey, set: { status, attempts: e.attempts, result: result ?? null, lastError: error ?? null, finishedAt: new Date() } });
}

/** Operator retry for failed/dead events (Automation Health screen). */
export async function retryEvent(orgId: string, eventId: string) {
  const [e] = await db.update(outboxEvents).set({ status: "pending", nextAttemptAt: new Date(), lockedUntil: null, attempts: 0 })
    .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.orgId, orgId), sql`${outboxEvents.status} in ('failed','dead')`)).returning();
  return !!e;
}

/**
 * Drain due events in batches until the queue is empty or the time budget is spent.
 * A single-batch drain lets bulk operations (e.g. building a production from a template)
 * starve newer events, so we keep going while batches come back full.
 */
export async function drainOutbox(opts: { orgId?: string; budgetMs?: number; batch?: number } = {}) {
  const started = Date.now(), batch = opts.batch ?? 100;
  const total = { claimed: 0, done: 0, retried: 0, dead: 0, skipped: 0, batches: 0 };
  while (Date.now() - started < (opts.budgetMs ?? 4000)) {
    const s = await processOutbox({ limit: batch, orgId: opts.orgId });
    total.batches++;
    for (const k of ["claimed", "done", "retried", "dead", "skipped"] as const) total[k] += s[k];
    if (s.claimed < batch) break;
  }
  return total;
}

/** Best-effort inline drain so users see automation results immediately; durable either way (cron drains the rest). */
export async function kickOutbox(orgId: string) {
  try { await drainOutbox({ orgId, budgetMs: 4000 }); } catch (e) { console.error("outbox kick failed", e); }
}
