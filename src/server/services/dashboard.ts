/**
 * Executive Command metrics. Every number is a live database count with a drill-down link;
 * nothing is seeded, estimated or randomised.
 */
import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { contractObligations, deliverables, ipProjects, outboxEvents, productions, resourceCheckouts, resources, rightsEntries, risks, shootDays, tasks, workflowRuns } from "@/db/schema";
import { or } from "drizzle-orm";
import { canRead } from "@/lib/permissions";
import type { Ctx } from "../auth/context";
import { conflictSummary } from "./conflicts";
import { financeHealth } from "./finance";
import { listApprovals } from "./approvals";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface Metric { key: string; label: string; value: number | null; href: string; definition: string; tone?: "neutral" | "warn" | "bad" }

async function visibleProductionIds(ctx: Ctx) {
  const rows = await db.select({ id: productions.id }).from(productions).where(and(eq(productions.orgId, ctx.orgId), isNull(productions.archivedAt),
    ctx.productionIds === "all" ? undefined : inArray(productions.id, ctx.productionIds.length ? ctx.productionIds : ["00000000-0000-0000-0000-000000000000"])));
  return rows.map((r) => r.id);
}

export async function metricValue(ctx: Ctx, key: string, pids?: string[]): Promise<number | null> {
  const ids = pids ?? (await visibleProductionIds(ctx));
  const safe = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
  const today = new Date();
  const n = (r: { n: number }[]) => Number(r[0]?.n ?? 0);
  switch (key) {
    case "active_productions":
      return n(await db.select({ n: sql<number>`count(*)::int` }).from(productions).where(and(inArray(productions.id, safe), inArray(productions.status, ["pre_production", "production", "post_production"]))));
    case "scheduled_shoot_days_30d":
      return n(await db.select({ n: sql<number>`count(*)::int` }).from(shootDays).where(and(inArray(shootDays.productionId, safe), isNull(shootDays.archivedAt), ne(shootDays.status, "cancelled"), gte(shootDays.date, iso(today)), lte(shootDays.date, iso(new Date(Date.now() + 30 * 864e5))))));
    case "pending_approvals":
      return canRead(ctx.role, "approvals") ? (await listApprovals(ctx, "pending")).length : null;
    case "overdue_tasks":
      return n(await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(eq(tasks.orgId, ctx.orgId), isNull(tasks.archivedAt), ne(tasks.status, "done"), lt(tasks.dueDate, iso(today)),
        ctx.productionIds === "all" ? undefined : sql`(${tasks.productionId} is null or ${tasks.productionId} in ${safe})`)));
    case "deliverables_due_14d":
      return n(await db.select({ n: sql<number>`count(*)::int` }).from(deliverables).where(and(inArray(deliverables.productionId, safe), isNull(deliverables.archivedAt), notInArray(deliverables.status, ["delivered"]), lte(deliverables.dueDate, iso(new Date(Date.now() + 14 * 864e5))))));
    case "open_risks":
      if (!canRead(ctx.role, "org")) return null;
      return n(await db.select({ n: sql<number>`count(*)::int` }).from(risks).where(and(eq(risks.orgId, ctx.orgId), isNull(risks.archivedAt), inArray(risks.status, ["open", "mitigating"]))));
    case "failed_workflow_runs":
      if (!canRead(ctx.role, "automation")) return null;
      return n(await db.select({ n: sql<number>`count(*)::int` }).from(outboxEvents).where(and(eq(outboxEvents.orgId, ctx.orgId), inArray(outboxEvents.status, ["failed", "dead"])))) +
        n(await db.select({ n: sql<number>`count(*)::int` }).from(workflowRuns).where(and(eq(workflowRuns.orgId, ctx.orgId), eq(workflowRuns.status, "blocked"), gte(workflowRuns.startedAt, new Date(Date.now() - 7 * 864e5)))));
    case "slate_in_development":
      if (!canRead(ctx.role, "slate")) return null;
      return n(await db.select({ n: sql<number>`count(*)::int` }).from(ipProjects).where(and(eq(ipProjects.orgId, ctx.orgId), isNull(ipProjects.archivedAt), inArray(ipProjects.stage, ["idea", "development", "packaging", "greenlight_review"]))));
  }
  return null;
}

export const METRIC_DEFS: Omit<Metric, "value">[] = [
  { key: "active_productions", label: "Active productions", href: "/productions", definition: "Productions in pre-production, production or post." },
  { key: "scheduled_shoot_days_30d", label: "Shoot days · next 30 days", href: "/schedule", definition: "Non-cancelled shoot days dated today to +30 days." },
  { key: "pending_approvals", label: "Pending approvals", href: "/approvals", definition: "Approval requests awaiting a decision that you can see." },
  { key: "deliverables_due_14d", label: "Deliverables due · 14 days", href: "/post?tab=deliverables", definition: "Undelivered deliverables due within 14 days (including overdue)." },
  { key: "overdue_tasks", label: "Overdue tasks", href: "/operations?tab=tasks", definition: "Open tasks past their due date." },
  { key: "open_risks", label: "Open risks", href: "/executive?tab=risks", definition: "Risks with status open or mitigating." },
  { key: "slate_in_development", label: "Slate in development", href: "/slate", definition: "Shows/IP from idea through greenlight review." },
  { key: "failed_workflow_runs", label: "Automation failures", href: "/automations", definition: "Failed or dead-lettered events plus blocked runs in the last 7 days." },
];

export async function commandCentre(ctx: Ctx) {
  const pids = await visibleProductionIds(ctx);
  const metrics: Metric[] = [];
  for (const m of METRIC_DEFS) {
    const value = await metricValue(ctx, m.key, pids);
    if (value === null) continue;
    metrics.push({ ...m, value, tone: value > 0 && ["failed_workflow_runs", "overdue_tasks"].includes(m.key) ? "bad" : value > 0 && m.key === "pending_approvals" ? "warn" : "neutral" });
  }
  const upcoming = pids.length ? await db.select({ d: shootDays, title: productions.title }).from(shootDays).innerJoin(productions, eq(productions.id, shootDays.productionId))
    .where(and(inArray(shootDays.productionId, pids), isNull(shootDays.archivedAt), ne(shootDays.status, "cancelled"), gte(shootDays.date, iso(new Date()))))
    .orderBy(asc(shootDays.date)).limit(8) : [];
  const conflicts = await conflictSummary(ctx, upcoming.map((u) => u.d.id));
  const finance = canRead(ctx.role, "finance") ? await financeHealth(ctx, pids) : [];
  const prodRows = pids.length ? await db.select().from(productions).where(inArray(productions.id, pids)).orderBy(asc(productions.title)) : [];
  const dueDeliverables = pids.length ? await db.select({ d: deliverables, title: productions.title }).from(deliverables).innerJoin(productions, eq(productions.id, deliverables.productionId))
    .where(and(inArray(deliverables.productionId, pids), isNull(deliverables.archivedAt), ne(deliverables.status, "delivered"))).orderBy(asc(deliverables.dueDate)).limit(8) : [];
  // Attention list: things that will hurt if nobody acts.
  const today = iso(new Date()), in90 = iso(new Date(Date.now() + 90 * 864e5)), in14 = iso(new Date(Date.now() + 14 * 864e5));
  const attention: { kind: string; tone: "bad" | "warn"; text: string; href: string }[] = [];
  if (canRead(ctx.role, "legal")) {
    const rights = await db.select().from(rightsEntries).where(and(eq(rightsEntries.orgId, ctx.orgId), isNull(rightsEntries.archivedAt),
      or(inArray(rightsEntries.status, ["missing", "disputed", "expired"]), and(eq(rightsEntries.status, "cleared"), lte(rightsEntries.endDate, in90))))).limit(20);
    for (const r of rights) if (!r.productionId || pids.includes(r.productionId)) attention.push({ kind: "Rights", tone: r.status === "cleared" && r.endDate! >= today ? "warn" : "bad", text: r.status === "cleared" ? `${r.title} expires ${r.endDate}` : `${r.title} is ${r.status}`, href: `/data/rights_entries/${r.id}` });
    const obl = await db.select().from(contractObligations).where(and(eq(contractObligations.orgId, ctx.orgId), eq(contractObligations.status, "open"), lte(contractObligations.dueDate, in14), isNull(contractObligations.archivedAt))).limit(20);
    for (const o of obl) if (!o.productionId || pids.includes(o.productionId)) attention.push({ kind: "Obligation", tone: o.dueDate! < today ? "bad" : "warn", text: `${o.description} — due ${o.dueDate}`, href: `/data/contract_obligations/${o.id}` });
  }
  if (canRead(ctx.role, "resources")) {
    const late = await db.select({ c: resourceCheckouts, name: resources.name }).from(resourceCheckouts).innerJoin(resources, eq(resources.id, resourceCheckouts.resourceId))
      .where(and(eq(resourceCheckouts.orgId, ctx.orgId), isNull(resourceCheckouts.inAt), lt(resourceCheckouts.dueAt, new Date()), isNull(resourceCheckouts.archivedAt))).limit(20);
    for (const l of late) attention.push({ kind: "Kit", tone: "bad", text: `${l.name} overdue for return`, href: `/data/resource_checkouts/${l.c.id}` });
  }
  if (canRead(ctx.role, "approvals")) {
    const mine = (await listApprovals(ctx, "pending")).filter((a) => a.canDecide);
    if (mine.length) attention.push({ kind: "Approvals", tone: "warn", text: `${mine.length} approval${mine.length > 1 ? "s" : ""} waiting for your decision`, href: "/approvals" });
  }
  return {
    attention,
    metrics,
    upcoming: upcoming.map((u) => ({ id: u.d.id, date: u.d.date, unit: u.d.unit, dayNumber: u.d.dayNumber, status: u.d.status, productionId: u.d.productionId, production: u.title, conflicts: conflicts[u.d.id] ?? { errors: 0, warnings: 0 } })),
    finance: finance.map((f) => ({ ...f, production: prodRows.find((p) => p.id === f.productionId)?.title ?? "" })),
    productions: prodRows.map((p) => ({ id: p.id, title: p.title, kind: p.kind, status: p.status, startDate: p.startDate, endDate: p.endDate, isLegacyImport: p.isLegacyImport })),
    deliverables: dueDeliverables.map((x) => ({ id: x.d.id, title: x.d.title, dueDate: x.d.dueDate, status: x.d.status, production: x.title, productionId: x.d.productionId })),
  };
}
