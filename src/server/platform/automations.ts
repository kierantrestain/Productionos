/**
 * Base automations: when a record is created / updated / starts matching conditions in a table, run
 * internal actions (update the record, create a linked record, add a comment). No external sends:
 * automations never email, charge or call third parties. Runs are idempotent per automation+event,
 * recorded in workflow_runs, and chains are capped at depth 3.
 */
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { db } from "@/db";
import { baseAutomations, baseFields, baseTables, workflowRuns, type ViewConfig } from "@/db/schema";
import type { Ctx } from "../auth/context";
import { contextForUser } from "../auth/sessions";
import { audit } from "../audit";
import { invalid, notFound } from "../errors";
import { baseAccess, requireRole } from "./access";
import { runView } from "./query";
import { addComment, createRecords, updateRecord } from "./records";

export type Trigger = { type: "record_created" | "record_updated" | "record_matches"; tableId: string; watchFieldIds?: string[]; conditions?: ViewConfig["filters"] };
export type Action =
  | { type: "update_record"; values: Record<string, unknown> }
  | { type: "create_record"; tableId: string; values: Record<string, unknown>; linkFieldId?: string }
  | { type: "add_comment"; body: string };
const MAX_DEPTH = 3;

export async function listAutomations(ctx: Ctx, baseId: string) {
  await baseAccess(ctx, baseId);
  return db.select().from(baseAutomations).where(and(eq(baseAutomations.baseId, baseId), eq(baseAutomations.orgId, ctx.orgId), isNull(baseAutomations.archivedAt))).orderBy(baseAutomations.createdAt);
}

async function validate(ctx: Ctx, baseId: string, trigger: Trigger, actions: Action[]) {
  const tables = await db.select({ id: baseTables.id }).from(baseTables).where(and(eq(baseTables.baseId, baseId), isNull(baseTables.archivedAt)));
  const ids = new Set(tables.map((t) => t.id));
  if (!["record_created", "record_updated", "record_matches"].includes(trigger?.type)) throw invalid("Choose a trigger.");
  if (!ids.has(trigger.tableId)) throw invalid("The trigger table must be in this base.");
  if (!Array.isArray(actions) || !actions.length || actions.length > 10) throw invalid("Add 1–10 actions.");
  for (const a of actions) {
    if (a.type === "create_record" && !ids.has(a.tableId)) throw invalid("Records can only be created in tables of this base.");
    if (a.type === "add_comment" && !a.body?.trim()) throw invalid("Comment actions need text.");
    if (!["update_record", "create_record", "add_comment"].includes(a.type)) throw invalid("Unknown action.");
  }
  void ctx;
}

export async function saveAutomation(ctx: Ctx, baseId: string, input: { id?: string; name: string; trigger: Trigger; actions: Action[]; isEnabled?: boolean }) {
  const a = await baseAccess(ctx, baseId); requireRole(a, "creator", "manage automations");
  if (!input.name?.trim()) throw invalid("Name the automation.");
  await validate(ctx, baseId, input.trigger, input.actions);
  const values = { name: input.name.trim().slice(0, 120), trigger: input.trigger as unknown as Record<string, unknown>, actions: input.actions as unknown as Record<string, unknown>[], isEnabled: !!input.isEnabled, updatedAt: new Date() };
  if (input.id) {
    const [row] = await db.update(baseAutomations).set(values).where(and(eq(baseAutomations.id, input.id), eq(baseAutomations.baseId, baseId), eq(baseAutomations.orgId, ctx.orgId))).returning();
    if (!row) throw notFound();
    await audit(db, ctx, "update_automation", "base_automations", row.id, { meta: { name: row.name, enabled: row.isEnabled } });
    return row;
  }
  const [row] = await db.insert(baseAutomations).values({ ...values, orgId: ctx.orgId, baseId, createdBy: ctx.userId }).returning();
  await audit(db, ctx, "create_automation", "base_automations", row.id, { meta: { name: row.name } });
  return row;
}

export async function deleteAutomation(ctx: Ctx, id: string) {
  const [row] = await db.select().from(baseAutomations).where(and(eq(baseAutomations.id, id), eq(baseAutomations.orgId, ctx.orgId))).limit(1);
  if (!row) throw notFound();
  requireRole(await baseAccess(ctx, row.baseId), "creator", "manage automations");
  await db.update(baseAutomations).set({ archivedAt: new Date() }).where(eq(baseAutomations.id, id));
  await audit(db, ctx, "delete_automation", "base_automations", id, { meta: { name: row.name } });
}

export async function automationRuns(ctx: Ctx, id: string) {
  const [row] = await db.select().from(baseAutomations).where(and(eq(baseAutomations.id, id), eq(baseAutomations.orgId, ctx.orgId))).limit(1);
  if (!row) throw notFound();
  await baseAccess(ctx, row.baseId);
  return db.select().from(workflowRuns).where(and(eq(workflowRuns.orgId, ctx.orgId), like(workflowRuns.idempotencyKey, `auto:${id}:%`))).orderBy(desc(workflowRuns.startedAt)).limit(50);
}

/** Replace {Field name} tokens with the trigger record's plain-text values. */
function fill(v: unknown, text: Record<string, string>): unknown {
  return typeof v === "string" ? v.replace(/\{([^{}]+)\}/g, (m, n: string) => text[n.trim().toLowerCase()] ?? m) : v;
}

type Ev = { id: string; orgId: string; type: string; entityId: string | null; payload: unknown; origin: string };
/** Called by the outbox worker for record events. Returns per-automation outcomes. */
export async function runAutomationsForEvent(e: Ev) {
  if (e.type !== "record.created" && e.type !== "record.updated") return [];
  const p = (e.payload ?? {}) as { tableId?: string; baseId?: string; changed?: string[]; depth?: number };
  if (!p.baseId || !p.tableId || !e.entityId) return [];
  const autos = await db.select().from(baseAutomations).where(and(eq(baseAutomations.baseId, p.baseId), eq(baseAutomations.orgId, e.orgId), eq(baseAutomations.isEnabled, true), isNull(baseAutomations.archivedAt)));
  const out: { id: string; status: string; detail?: string }[] = [];
  for (const a of autos) {
    const t = a.trigger as unknown as Trigger;
    if (t.tableId !== p.tableId) continue;
    if (t.type === "record_created" && e.type !== "record.created") continue;
    if (t.type === "record_updated" && (e.type !== "record.updated" || (t.watchFieldIds?.length && !t.watchFieldIds.some((f) => p.changed?.includes(f))))) continue;
    const key = `auto:${a.id}:${e.id}`;
    const [prev] = await db.select().from(workflowRuns).where(eq(workflowRuns.idempotencyKey, key)).limit(1);
    if (prev && prev.status !== "failed") continue;
    const record = async (status: string, result: Record<string, unknown> | null, err?: string) => {
      await db.insert(workflowRuns).values({ orgId: e.orgId, workflowKey: `auto:${a.id}`, ruleVersion: 1, eventId: e.id, idempotencyKey: key, status, attempts: 1, result, lastError: err ?? null, finishedAt: new Date() })
        .onConflictDoUpdate({ target: workflowRuns.idempotencyKey, set: { status, result, lastError: err ?? null, finishedAt: new Date() } });
      await db.update(baseAutomations).set({ lastRunAt: new Date(), runCount: a.runCount + (status === "succeeded" ? 1 : 0), failCount: a.failCount + (status === "failed" ? 1 : 0) }).where(eq(baseAutomations.id, a.id));
      out.push({ id: a.id, status, detail: err });
    };
    if ((p.depth ?? 0) >= MAX_DEPTH) { await record("skipped", { reason: "chain depth limit" }); continue; }
    const owner = a.createdBy ? await contextForUser(a.createdBy, e.orgId) : null;
    if (!owner) { await record("blocked", { reason: "automation owner no longer has access" }); continue; }
    const ctx: Ctx = { ...owner, name: `Automation: ${a.name}` };
    try {
      const v = await runView(ctx, "owner", p.tableId, t.conditions?.conditions?.length ? { filters: t.conditions } : {}, { recordIds: [e.entityId] });
      if (!v.rows.length) { await record("skipped", { reason: "conditions not met" }); continue; }
      const text: Record<string, string> = {};
      const { cellText } = await import("@/lib/platform/cell-text");
      for (const f of v.fields) text[f.name.toLowerCase()] = cellText(f, v.rows[0].values[f.id]);
      const done: string[] = [];
      for (const act of a.actions as unknown as Action[]) {
        if (act.type === "update_record") {
          await updateRecord(ctx, e.entityId, Object.fromEntries(Object.entries(act.values).map(([k, x]) => [k, fill(x, text)])), { automationDepth: (p.depth ?? 0) + 1 });
          done.push("updated record");
        } else if (act.type === "create_record") {
          const vals: Record<string, unknown> = Object.fromEntries(Object.entries(act.values).map(([k, x]) => [k, fill(x, text)]));
          if (act.linkFieldId) {
            const [lf] = await db.select().from(baseFields).where(eq(baseFields.id, act.linkFieldId)).limit(1);
            if (lf?.tableId === act.tableId && lf.type === "link" && lf.options?.linkedTableId === p.tableId) vals[act.linkFieldId] = [e.entityId];
          }
          const [id] = await createRecords(ctx, act.tableId, [vals], { origin: "system", skipPermission: true, automationDepth: (p.depth ?? 0) + 1 });
          done.push(`created ${id}`);
        } else if (act.type === "add_comment") {
          await addComment(ctx, e.entityId, String(fill(act.body, text)));
          done.push("commented");
        }
      }
      await record("succeeded", { actions: done });
    } catch (err) {
      await record("failed", null, String((err as Error)?.message ?? err).slice(0, 500));
    }
  }
  return out;
}
