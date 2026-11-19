/**
 * Custom automation rules — "when <record> <field> becomes <value>, then <action>".
 * Rules run through the outbox engine with the permissions of the person who created them
 * (so a rule can never do more than its owner could), idempotently per event, with a depth
 * guard against rule-to-rule loops.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { outboxEvents, workflowDefinitions } from "@/db/schema";
import { getEntity, isEntityKey } from "@/lib/entities";
import { mergedOptions } from "@/lib/customise";
import { canSee } from "@/lib/permissions";
import type { Ctx } from "../auth/context";
import { contextForUser } from "../auth/sessions";
import { audit } from "../audit";
import { createEntity, getEntityRow, refLabel, updateEntity, validatePatch } from "../entities/crud";
import { forbidden, invalid, notFound } from "../errors";

export const MAX_RULE_DEPTH = 3;

const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_task"), title: z.string().trim().min(1).max(200), priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"), dueInDays: z.number().int().min(0).max(365).nullable().optional(), assigneeUserId: z.string().uuid().nullable().optional() }),
  z.object({ type: z.literal("set_field"), field: z.string(), value: z.union([z.string(), z.boolean(), z.number(), z.null()]) }),
]);
const RuleInput = z.object({
  name: z.string().trim().min(1).max(120),
  entity: z.string(),
  event: z.enum(["created", "updated"]),
  field: z.string(),
  value: z.string().max(200),
  action: Action,
});
export type RuleInput = z.infer<typeof RuleInput>;
type Conditions = Omit<RuleInput, "name">;

const requireAdmin = (ctx: Ctx) => { if (ctx.role !== "org_admin") throw forbidden("Only organisation admins can manage automation rules."); };

/** Fields usable as conditions: non-sensitive select, bool and short text fields. */
export function conditionFields(entity: string) {
  return (getEntity(entity)?.fields ?? []).filter((f) => !f.sensitive && ["select", "bool", "text"].includes(f.type));
}

function validateRule(ctx: Ctx, r: RuleInput) {
  if (!isEntityKey(r.entity)) throw invalid("Unknown record type");
  const d = getEntity(r.entity)!;
  const f = conditionFields(r.entity).find((x) => x.key === r.field);
  if (!f) throw invalid("That field can't be used as a trigger");
  if (f.type === "select" && !mergedOptions(ctx.settings, r.entity, f).includes(r.value)) throw invalid(`“${r.value}” is not a valid ${f.label}`);
  if (f.type === "bool" && !["true", "false"].includes(r.value)) throw invalid("Use true or false");
  const a = r.action;
  if (a.type === "set_field") {
    if (a.field === r.field) throw invalid("A rule can't change the field that triggers it");
    const target = d.fields.find((x) => x.key === a.field);
    if (!target || target.readOnly || target.system || target.type === "ref" || (target.sensitive && !canSee(ctx.role, target.sensitive))) throw invalid("That field can't be set by a rule");
    validatePatch(ctx, d, { [a.field]: a.value }, "update");
  }
}

export async function listRules(ctx: Ctx) {
  const rows = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.orgId, ctx.orgId), eq(workflowDefinitions.source, "custom"), isNull(workflowDefinitions.archivedAt)));
  return rows.map((r) => ({ id: r.id, key: r.key, name: r.name, status: r.status, conditions: r.conditions as unknown as Conditions, createdAt: r.createdAt.toISOString() }));
}

export async function createRule(ctx: Ctx, raw: unknown) {
  requireAdmin(ctx);
  const p = RuleInput.safeParse(raw);
  if (!p.success) throw invalid(p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  validateRule(ctx, p.data);
  const { name, ...conditions } = p.data;
  const n = (await listRules(ctx)).length + 1;
  const [row] = await db.insert(workflowDefinitions).values({
    orgId: ctx.orgId, createdBy: ctx.userId, ownerUserId: ctx.userId, key: `RULE-${String(n).padStart(3, "0")}-${Date.now().toString(36)}`, name, source: "custom",
    triggerEvent: `${conditions.entity}.${conditions.event}`, conditions: conditions as never, action: conditions.action.type, requiresApproval: false,
    status: "active", disposition: "implemented", dispositionEvidence: "User-defined rule; runs with its owner's permissions.", maxAttempts: 3,
  }).returning();
  await audit(db, ctx, "create_rule", "workflow_definitions", row.id, { after: { name, ...conditions } as never });
  return row;
}

export async function setRuleStatus(ctx: Ctx, id: string, status: "active" | "paused" | "archived") {
  requireAdmin(ctx);
  const [row] = await db.update(workflowDefinitions).set(status === "archived" ? { archivedAt: new Date(), status: "retired" } : { status, updatedAt: new Date() })
    .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.orgId, ctx.orgId), eq(workflowDefinitions.source, "custom"))).returning();
  if (!row) throw notFound();
  await audit(db, ctx, `rule_${status}`, "workflow_definitions", id);
}

type Event = typeof outboxEvents.$inferSelect;

/** Active custom rules whose trigger matches this event. */
export async function rulesFor(e: Event) {
  const m = /^([a-z_]+)\.(created|updated)$/.exec(e.type);
  if (!m || !e.entityId) return [];
  return db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.orgId, e.orgId), eq(workflowDefinitions.source, "custom"), eq(workflowDefinitions.status, "active"), eq(workflowDefinitions.triggerEvent, e.type), isNull(workflowDefinitions.archivedAt)));
}

/** Execute one rule for one event. Returns a run status + result for the run log. */
export async function executeRule(rule: typeof workflowDefinitions.$inferSelect, e: Event): Promise<{ status: "succeeded" | "skipped" | "blocked"; result: Record<string, unknown> }> {
  const c = rule.conditions as unknown as Conditions;
  const payload = (e.payload ?? {}) as { changed?: string[]; depth?: number; values?: Record<string, unknown> };
  const depth = payload.depth ?? 0;
  if (depth >= MAX_RULE_DEPTH) return { status: "skipped", result: { reason: "loop_guard", depth } };
  if (c.event === "updated" && !payload.changed?.includes(c.field)) return { status: "skipped", result: { reason: "field_not_changed" } };
  const ctx = rule.createdBy ? await contextForUser(rule.createdBy, e.orgId) : null;
  if (!ctx) return { status: "blocked", result: { reason: "Rule owner no longer has access to this organisation" } };
  let row;
  try { row = await getEntityRow(ctx, c.entity, e.entityId!); } catch { return { status: "blocked", result: { reason: "Rule owner cannot access this record" } }; }
  // Evaluate the value at the time of the event, not the record's latest state.
  const current = payload.values && c.field in payload.values ? payload.values[c.field] : row[c.field];
  const matches = c.field && (typeof current === "boolean" ? String(current) === c.value : current != null && String(current) === c.value);
  if (!matches) return { status: "skipped", result: { reason: "condition_false", value: current ?? null } };
  const d = getEntity(c.entity)!;
  if (c.action.type === "create_task") {
    const title = c.action.title.replace(/\{\{\s*title\s*\}\}/g, refLabel(d, row)).slice(0, 200);
    const due = c.action.dueInDays != null ? new Date(Date.now() + c.action.dueInDays * 864e5).toISOString().slice(0, 10) : null;
    const t = await createEntity(ctx, "tasks", { title, priority: c.action.priority, status: "todo", dueDate: due, assigneeUserId: c.action.assigneeUserId ?? null, productionId: (row.productionId as string) ?? (c.entity === "productions" ? row.id : null) }, { automationDepth: depth + 1 });
    return { status: "succeeded", result: { taskId: t.id, title } };
  }
  const u = await updateEntity(ctx, c.entity, row.id, { [c.action.field]: c.action.value }, undefined, { automationDepth: depth + 1 });
  return { status: "succeeded", result: { set: c.action.field, value: c.action.value, version: u.version } };
}
