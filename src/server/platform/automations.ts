/**
 * Base automations — step-based flows (trigger → steps, with if/else branches).
 * Triggers: record created / updated / matches conditions, schedule (hourly/daily/weekly over matching
 * records), inbound webhook (creates a record, then runs the steps).
 * Steps: update record, update linked records, create (linked) record, add comment, AI-generate a field,
 * branch, and outbound webhook — which is never sent directly: it files an approval for a creator.
 * Guarantees: idempotent per automation+event, run log in workflow_runs, chain depth ≤ 3, imports/syncs
 * never trigger, runs act as the automation owner with server-side permission checks.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { baseAutomations, baseFields, baseTables, workflowRuns, type ViewConfig } from "@/db/schema";
import { cellText } from "@/lib/platform/cell-text";
import type { Ctx } from "../auth/context";
import { contextForUser } from "../auth/sessions";
import { audit } from "../audit";
import { invalid, notFound } from "../errors";
import { baseAccess, requireRole } from "./access";
import { fileApproval } from "./approvals";
import { runView } from "./query";
import { addComment, createRecords, updateRecord } from "./records";

export type Schedule = { every: "hour" | "day" | "week"; hour?: number; weekday?: number };
export type Trigger = {
  type: "record_created" | "record_updated" | "record_matches" | "schedule" | "webhook";
  tableId: string; watchFieldIds?: string[]; conditions?: ViewConfig["filters"]; schedule?: Schedule;
};
export type Action =
  | { type: "update_record"; values: Record<string, unknown> }
  | { type: "update_linked"; linkFieldId: string; values: Record<string, unknown> }
  | { type: "create_record"; tableId: string; values: Record<string, unknown>; linkFieldId?: string }
  | { type: "add_comment"; body: string }
  | { type: "ai_generate"; fieldId: string; prompt: string }
  | { type: "webhook"; url: string }
  | { type: "branch"; conditions: NonNullable<ViewConfig["filters"]>; then: Action[]; else: Action[] };
const MAX_DEPTH = 3;
const ACTION_TYPES = ["update_record", "update_linked", "create_record", "add_comment", "ai_generate", "webhook", "branch"];
const TRIGGER_TYPES = ["record_created", "record_updated", "record_matches", "schedule", "webhook"];

export async function listAutomations(ctx: Ctx, baseId: string) {
  const { role } = await baseAccess(ctx, baseId);
  const rows = await db.select().from(baseAutomations).where(and(eq(baseAutomations.baseId, baseId), eq(baseAutomations.orgId, ctx.orgId), isNull(baseAutomations.archivedAt))).orderBy(baseAutomations.createdAt);
  // The webhook secret is only shown to people who can manage automations.
  return rows.map((r) => ({ ...r, webhookToken: role === "owner" || role === "creator" ? r.webhookToken : null }));
}

async function validate(baseId: string, trigger: Trigger, actions: Action[]) {
  const tables = await db.select({ id: baseTables.id }).from(baseTables).where(and(eq(baseTables.baseId, baseId), isNull(baseTables.archivedAt)));
  const ids = new Set(tables.map((t) => t.id));
  if (!TRIGGER_TYPES.includes(trigger?.type)) throw invalid("Choose a trigger.");
  if (!ids.has(trigger.tableId)) throw invalid("The trigger table must be in this base.");
  if (trigger.type === "schedule" && !["hour", "day", "week"].includes(trigger.schedule?.every ?? "")) throw invalid("Choose how often the schedule runs.");
  let count = 0;
  const walk = (list: Action[], depth: number) => {
    if (!Array.isArray(list)) throw invalid("Steps are malformed.");
    if (depth > 3) throw invalid("Branches can be nested at most 3 deep.");
    for (const a of list) {
      if (++count > 25) throw invalid("Automations hold up to 25 steps.");
      if (!ACTION_TYPES.includes(a.type)) throw invalid("Unknown step.");
      if (a.type === "create_record" && !ids.has(a.tableId)) throw invalid("Records can only be created in tables of this base.");
      if (a.type === "add_comment" && !a.body?.trim()) throw invalid("Comment steps need text.");
      if (a.type === "ai_generate" && (!a.fieldId || !a.prompt?.trim())) throw invalid("AI steps need a field and a prompt.");
      if (a.type === "webhook" && !/^https:\/\//.test(a.url ?? "")) throw invalid("Webhook URLs must start with https://");
      if (a.type === "branch") { walk(a.then, depth + 1); walk(a.else, depth + 1); }
    }
  };
  walk(actions, 0);
  if (!count) throw invalid("Add at least one step.");
}

export async function saveAutomation(ctx: Ctx, baseId: string, input: { id?: string; name: string; trigger: Trigger; actions: Action[]; isEnabled?: boolean }) {
  const a = await baseAccess(ctx, baseId); requireRole(a, "creator", "manage automations");
  if (!input.name?.trim()) throw invalid("Name the automation.");
  await validate(baseId, input.trigger, input.actions);
  const needsToken = input.trigger.type === "webhook";
  const values = { name: input.name.trim().slice(0, 120), trigger: input.trigger as unknown as Record<string, unknown>, actions: input.actions as unknown as Record<string, unknown>[], isEnabled: !!input.isEnabled, updatedAt: new Date() };
  if (input.id) {
    const [cur] = await db.select().from(baseAutomations).where(and(eq(baseAutomations.id, input.id), eq(baseAutomations.baseId, baseId), eq(baseAutomations.orgId, ctx.orgId))).limit(1);
    if (!cur) throw notFound();
    const [row] = await db.update(baseAutomations).set({ ...values, webhookToken: needsToken ? cur.webhookToken ?? randomBytes(24).toString("base64url") : null }).where(eq(baseAutomations.id, cur.id)).returning();
    await audit(db, ctx, "update_automation", "base_automations", row.id, { meta: { name: row.name, enabled: row.isEnabled } });
    return row;
  }
  const [row] = await db.insert(baseAutomations).values({ ...values, orgId: ctx.orgId, baseId, createdBy: ctx.userId, webhookToken: needsToken ? randomBytes(24).toString("base64url") : null }).returning();
  await audit(db, ctx, "create_automation", "base_automations", row.id, { meta: { name: row.name } });
  return row;
}

export async function deleteAutomation(ctx: Ctx, id: string) {
  const [row] = await db.select().from(baseAutomations).where(and(eq(baseAutomations.id, id), eq(baseAutomations.orgId, ctx.orgId))).limit(1);
  if (!row) throw notFound();
  requireRole(await baseAccess(ctx, row.baseId), "creator", "manage automations");
  await db.update(baseAutomations).set({ archivedAt: new Date(), webhookToken: null }).where(eq(baseAutomations.id, id));
  await audit(db, ctx, "delete_automation", "base_automations", id, { meta: { name: row.name } });
}

export async function automationRuns(ctx: Ctx, id: string) {
  const [row] = await db.select().from(baseAutomations).where(and(eq(baseAutomations.id, id), eq(baseAutomations.orgId, ctx.orgId))).limit(1);
  if (!row) throw notFound();
  await baseAccess(ctx, row.baseId);
  return db.select().from(workflowRuns).where(and(eq(workflowRuns.orgId, ctx.orgId), like(workflowRuns.idempotencyKey, `auto:${id}:%`))).orderBy(desc(workflowRuns.startedAt)).limit(50);
}

// ───────── Execution ─────────
/** Replace {Field name} tokens with the trigger record's plain-text values. */
function fill(v: unknown, text: Record<string, string>): unknown {
  return typeof v === "string" ? v.replace(/\{([^{}]+)\}/g, (m, n: string) => text[n.trim().toLowerCase()] ?? m) : v;
}
type Auto = typeof baseAutomations.$inferSelect;
type Snapshot = { values: Record<string, unknown>; text: Record<string, string>; fields: Awaited<ReturnType<typeof runView>>["fields"] };

async function snapshot(ctx: Ctx, tableId: string, recordId: string, conditions?: ViewConfig["filters"]): Promise<Snapshot | null> {
  const v = await runView(ctx, "owner", tableId, conditions?.conditions?.length ? { filters: conditions } : {}, { recordIds: [recordId] });
  if (!v.rows.length) return null;
  const text: Record<string, string> = {};
  for (const f of v.fields) text[f.name.toLowerCase()] = cellText(f, v.rows[0].values[f.id]);
  return { values: v.rows[0].values, text, fields: v.fields };
}

/** Run (or, with dryRun, describe) the steps for one record. Returns a human-readable step log. */
async function executeSteps(ctx: Ctx, a: Auto, tableId: string, recordId: string, steps: Action[], depth: number, dryRun: boolean, log: string[]) {
  const snap = await snapshot(ctx, tableId, recordId);
  if (!snap) { log.push("record no longer exists — stopped"); return; }
  const fieldName = (id: string) => snap.fields.find((f) => f.id === id)?.name ?? id;
  const resolved = (vals: Record<string, unknown>) => Object.fromEntries(Object.entries(vals).map(([k, x]) => [k, fill(x, snap.text)]));
  const describe = (vals: Record<string, unknown>, tid = tableId) => Object.entries(vals).map(([k, v]) => `${tid === tableId ? fieldName(k) : k} = ${JSON.stringify(v)}`).join(", ");
  for (const act of steps) {
    if (act.type === "branch") {
      const match = !!(await snapshot(ctx, tableId, recordId, act.conditions));
      log.push(`if conditions → ${match ? "then" : "else"}`);
      await executeSteps(ctx, a, tableId, recordId, match ? act.then : act.else, depth, dryRun, log);
      continue;
    }
    if (act.type === "update_record") {
      const vals = resolved(act.values);
      log.push(`update this record: ${describe(vals)}`);
      if (!dryRun) await updateRecord(ctx, recordId, vals, { automationDepth: depth + 1 });
    } else if (act.type === "update_linked") {
      const linked = ((snap.values[act.linkFieldId] as { id: string }[] | null) ?? []).map((x) => x.id).slice(0, 200);
      const vals = resolved(act.values);
      log.push(`update ${linked.length} linked record(s) via ${fieldName(act.linkFieldId)}: ${Object.keys(vals).length} field(s)`);
      if (!dryRun) for (const id of linked) await updateRecord(ctx, id, vals, { automationDepth: depth + 1 });
    } else if (act.type === "create_record") {
      const vals: Record<string, unknown> = resolved(act.values);
      if (act.linkFieldId) {
        const [lf] = await db.select().from(baseFields).where(eq(baseFields.id, act.linkFieldId)).limit(1);
        if (lf?.tableId === act.tableId && lf.type === "link" && lf.options?.linkedTableId === tableId) vals[act.linkFieldId] = [recordId];
      }
      log.push(`create a record${act.linkFieldId ? " linked to this one" : ""} with ${Object.keys(vals).length} value(s)`);
      if (!dryRun) { const [id] = await createRecords(ctx, act.tableId, [vals], { origin: "system", skipPermission: true, automationDepth: depth + 1 }); log.push(`  → created ${id}`); }
    } else if (act.type === "add_comment") {
      const body = String(fill(act.body, snap.text));
      log.push(`comment: “${body.slice(0, 120)}”`);
      if (!dryRun) await addComment(ctx, recordId, body);
    } else if (act.type === "ai_generate") {
      const { aiConfigured, generateAiText } = await import("./ai");
      const prompt = String(fill(act.prompt, snap.text));
      log.push(`AI: fill ${fieldName(act.fieldId)} from “${prompt.slice(0, 80)}”`);
      if (!dryRun) {
        if (!aiConfigured()) throw new Error("AI isn't configured (ANTHROPIC_API_KEY).");
        await updateRecord(ctx, recordId, { [act.fieldId]: await generateAiText(prompt) }, { automationDepth: depth + 1 });
      }
    } else if (act.type === "webhook") {
      const body = { automation: a.name, recordId, fields: snap.text };
      log.push(`outbound POST to ${act.url} — queued for a creator's approval`);
      if (!dryRun) await fileApproval({ orgId: a.orgId, baseId: a.baseId, source: "automation", sourceId: a.id, requestedBy: a.createdBy, kind: "webhook", payload: { url: act.url, body }, summary: `${a.name}: POST record “${Object.values(snap.text)[0] ?? recordId}” to ${new URL(act.url).host}` });
    }
  }
}

async function runOne(a: Auto, key: string, tableId: string, recordId: string, depth: number) {
  const [prev] = await db.select().from(workflowRuns).where(eq(workflowRuns.idempotencyKey, key)).limit(1);
  if (prev && prev.status !== "failed") return { id: a.id, status: "duplicate" };
  const record = async (status: string, result: Record<string, unknown> | null, err?: string) => {
    await db.insert(workflowRuns).values({ orgId: a.orgId, workflowKey: `auto:${a.id}`, ruleVersion: 1, eventId: null, idempotencyKey: key, status, attempts: 1, result, lastError: err ?? null, finishedAt: new Date() })
      .onConflictDoUpdate({ target: workflowRuns.idempotencyKey, set: { status, result, lastError: err ?? null, finishedAt: new Date() } });
    await db.update(baseAutomations).set({ lastRunAt: new Date(), runCount: sql`${baseAutomations.runCount} + ${status === "succeeded" ? 1 : 0}`, failCount: sql`${baseAutomations.failCount} + ${status === "failed" ? 1 : 0}` }).where(eq(baseAutomations.id, a.id));
    return { id: a.id, status, detail: err };
  };
  if (depth >= MAX_DEPTH) return record("skipped", { reason: "chain depth limit" });
  const owner = a.createdBy ? await contextForUser(a.createdBy, a.orgId) : null;
  if (!owner) return record("blocked", { reason: "automation owner no longer has access" });
  const ctx: Ctx = { ...owner, name: `Automation: ${a.name}` };
  const t = a.trigger as unknown as Trigger;
  try {
    if (!(await snapshot(ctx, tableId, recordId, t.conditions))) return record("skipped", { reason: "conditions not met" });
    const log: string[] = [];
    await executeSteps(ctx, a, tableId, recordId, a.actions as unknown as Action[], depth, false, log);
    return record("succeeded", { recordId, steps: log });
  } catch (err) {
    return record("failed", { recordId }, String((err as Error)?.message ?? err).slice(0, 500));
  }
}

type Ev = { id: string; orgId: string; type: string; entityId: string | null; payload: unknown; origin: string };
/** Called by the outbox worker for record events. */
export async function runAutomationsForEvent(e: Ev) {
  if (e.type !== "record.created" && e.type !== "record.updated") return [];
  const p = (e.payload ?? {}) as { tableId?: string; baseId?: string; changed?: string[]; depth?: number; viaAutomation?: string };
  if (!p.baseId || !p.tableId || !e.entityId) return [];
  const autos = await db.select().from(baseAutomations).where(and(eq(baseAutomations.baseId, p.baseId), eq(baseAutomations.orgId, e.orgId), eq(baseAutomations.isEnabled, true), isNull(baseAutomations.archivedAt)));
  const out = [];
  for (const a of autos) {
    const t = a.trigger as unknown as Trigger;
    if (t.tableId !== p.tableId || t.type === "schedule" || t.type === "webhook") continue;
    if (t.type === "record_created" && e.type !== "record.created") continue;
    if (t.type === "record_updated" && (e.type !== "record.updated" || (t.watchFieldIds?.length && !t.watchFieldIds.some((f) => p.changed?.includes(f))))) continue;
    out.push(await runOne(a, `auto:${a.id}:${e.id}`, p.tableId, e.entityId, p.depth ?? 0));
  }
  return out;
}

/** Cron: run due scheduled automations over their matching records (≤ 200 per run). */
export async function runScheduledAutomations(now = new Date()) {
  const autos = await db.select().from(baseAutomations).where(and(eq(baseAutomations.isEnabled, true), isNull(baseAutomations.archivedAt), sql`${baseAutomations.trigger} ->> 'type' = 'schedule'`));
  const results: { id: string; records: number }[] = [];
  for (const a of autos) {
    const s = (a.trigger as unknown as Trigger).schedule!;
    const period = s.every === "hour" ? now.toISOString().slice(0, 13) : s.every === "day" ? now.toISOString().slice(0, 10) : `${now.getUTCFullYear()}-w${Math.floor((now.getTime() / 864e5 + 3) / 7)}`;
    if (s.every !== "hour" && (s.hour ?? 6) > now.getUTCHours()) continue;
    if (s.every === "week" && (s.weekday ?? 1) !== now.getUTCDay()) continue;
    const owner = a.createdBy ? await contextForUser(a.createdBy, a.orgId) : null;
    if (!owner) continue;
    const t = a.trigger as unknown as Trigger;
    const v = await runView(owner, "owner", t.tableId, t.conditions?.conditions?.length ? { filters: t.conditions } : {}, {});
    let n = 0;
    for (const r of v.rows.slice(0, 200)) { const res = await runOne(a, `auto:${a.id}:sched:${period}:${r.id}`, t.tableId, r.id, 0); if (res.status !== "duplicate") n++; }
    await db.update(baseAutomations).set({ lastScheduledAt: now }).where(eq(baseAutomations.id, a.id));
    results.push({ id: a.id, records: n });
  }
  return results;
}

/** Inbound webhook: create a record from a JSON object (keys = field names), then run the steps on it. */
export async function receiveWebhook(token: string, body: unknown) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound();
  const [a] = await db.select().from(baseAutomations).where(and(eq(baseAutomations.webhookToken, token), isNull(baseAutomations.archivedAt))).limit(1);
  if (!a || !a.isEnabled) throw notFound("No active automation for this URL.");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("Send a JSON object whose keys are field names.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(workflowRuns).where(and(eq(workflowRuns.workflowKey, `auto:${a.id}`), gt(workflowRuns.startedAt, new Date(Date.now() - 60_000))));
  if (n >= 60) throw invalid("Rate limit: at most 60 webhook calls per minute.");
  const owner = a.createdBy ? await contextForUser(a.createdBy, a.orgId) : null;
  if (!owner) throw notFound();
  const t = a.trigger as unknown as Trigger;
  const fields = await db.select().from(baseFields).where(and(eq(baseFields.tableId, t.tableId), isNull(baseFields.archivedAt)));
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const f = fields.find((x) => x.name.toLowerCase() === k.toLowerCase());
    if (f && !["link", "user", "attachment", "lookup", "rollup", "count", "formula", "autonumber", "button"].includes(f.type)) values[f.id] = v;
  }
  const ctx: Ctx = { ...owner, name: `Webhook: ${a.name}` };
  const [recordId] = await createRecords(ctx, t.tableId, [values], { origin: "system", skipPermission: true, automationDepth: 1 });
  const res = await runOne(a, `auto:${a.id}:hook:${recordId}`, t.tableId, recordId, 0);
  return { recordId, status: res.status };
}

/** Dry run: what the steps would do for a record — nothing is written, nothing is sent. */
export async function previewAutomation(ctx: Ctx, baseId: string, input: { trigger: Trigger; actions: Action[]; name?: string }, recordId: string) {
  requireRole(await baseAccess(ctx, baseId), "creator", "test automations");
  await validate(baseId, input.trigger, input.actions);
  const fake = { id: "preview", orgId: ctx.orgId, baseId, name: input.name ?? "Preview", createdBy: ctx.userId, trigger: input.trigger, actions: input.actions } as unknown as Auto;
  const log: string[] = [];
  const matches = !!(await snapshot(ctx, input.trigger.tableId, recordId, input.trigger.conditions));
  if (!matches) return { matches, steps: ["this record doesn't meet the trigger conditions — nothing would run"] };
  await executeSteps(ctx, fake, input.trigger.tableId, recordId, input.actions, 0, true, log);
  return { matches, steps: log };
}

/** Run one enabled automation's steps on a record now (button actions). Same base + editor access required. */
export async function runAutomationForRecord(ctx: Ctx, automationId: string, recordId: string) {
  const [a] = await db.select().from(baseAutomations).where(and(eq(baseAutomations.id, automationId), eq(baseAutomations.orgId, ctx.orgId), isNull(baseAutomations.archivedAt))).limit(1);
  if (!a) throw notFound("Automation not found.");
  requireRole(await baseAccess(ctx, a.baseId), "editor", "run automations");
  if (!a.isEnabled) throw invalid("This automation is turned off.");
  const t = a.trigger as unknown as Trigger;
  const v = await runView(ctx, "owner", t.tableId, {}, { recordIds: [recordId] });
  if (!v.rows.length) throw invalid("That record isn't in this automation's table.");
  await audit(db, ctx, "run_automation_manual", "base_automations", a.id, { meta: { recordId } });
  return runOne(a, `auto:${a.id}:manual:${recordId}:${Date.now()}`, t.tableId, recordId, 0);
}
