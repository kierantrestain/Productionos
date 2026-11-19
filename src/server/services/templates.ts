/**
 * Template engine: build a complete production skeleton from a blueprint in one transaction,
 * or capture an existing production's structure as a reusable organisation template.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgetLines, budgets, deliverables, episodes, postTasks, productions, productionTemplates, scenes, tasks } from "@/db/schema";
import { BLUEPRINTS, blueprint, type Blueprint } from "@/lib/templates";
import { canWrite } from "@/lib/permissions";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { createEntity } from "../entities/crud";
import { forbidden, invalid, notFound } from "../errors";
import { loadProduction } from "./guards";

const Input = z.object({
  template: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  code: z.string().trim().max(30).optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  units: z.number().int().min(0).max(200).optional(),
  seasonNumber: z.number().int().min(1).max(99).optional().nullable(),
  ipProjectId: z.string().uuid().optional().nullable(),
  usesEpisodes: z.boolean().optional(),
  include: z.object({ runningOrder: z.boolean(), budget: z.boolean(), deliverables: z.boolean(), post: z.boolean(), tasks: z.boolean() }).partial().optional(),
  terms: z.object({ unit: z.string().max(40), units: z.string().max(40), item: z.string().max(40), items: z.string().max(40) }).partial().optional(),
});
export type TemplateInput = z.infer<typeof Input>;

export async function listTemplates(ctx: Ctx) {
  const saved = await db.select().from(productionTemplates).where(and(eq(productionTemplates.orgId, ctx.orgId), isNull(productionTemplates.archivedAt))).orderBy(asc(productionTemplates.name));
  return [
    ...BLUEPRINTS.map((b) => ({ id: b.key, source: "built-in" as const, blueprint: b })),
    ...saved.map((s) => ({ id: `org:${s.id}`, source: "organisation" as const, blueprint: { ...(s.blueprint as Blueprint), key: `org:${s.id}`, name: s.name, description: s.description ?? (s.blueprint as Blueprint).description } })),
  ];
}

async function resolve(ctx: Ctx, key: string): Promise<Blueprint> {
  if (key.startsWith("org:")) {
    const [t] = await db.select().from(productionTemplates).where(and(eq(productionTemplates.id, key.slice(4)), eq(productionTemplates.orgId, ctx.orgId), isNull(productionTemplates.archivedAt))).limit(1);
    if (!t) throw notFound("Template not found");
    return { ...(t.blueprint as Blueprint), key, name: t.name };
  }
  const b = blueprint(key);
  if (!b) throw notFound("Template not found");
  return b;
}

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** Create a production and its whole structure. Everything goes through validated, audited createEntity. */
export async function createFromTemplate(ctx: Ctx, raw: unknown) {
  if (!canWrite(ctx.role, "production")) throw forbidden();
  const p = Input.safeParse(raw);
  if (!p.success) throw invalid(p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const input = p.data;
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw invalid("End date must be after the start date.");
  const bp = await resolve(ctx, input.template);
  const inc = { runningOrder: true, budget: true, deliverables: true, post: true, tasks: true, ...input.include };
  const usesEpisodes = input.usesEpisodes ?? bp.usesEpisodes;
  const units = usesEpisodes ? (input.units ?? bp.defaults.units) : 0;
  const terms = { ...bp.terms, ...Object.fromEntries(Object.entries(input.terms ?? {}).filter(([, v]) => v && v.trim())) };
  const counts = { units: 0, items: 0, budgetLines: 0, deliverables: 0, postTasks: 0, tasks: 0 };

  return db.transaction(async (tx) => {
    const prod = await createEntity(ctx, "productions", { title: input.title, code: input.code || null, kind: bp.kind, status: "development", usesEpisodes, startDate: input.startDate ?? null, endDate: input.endDate ?? null, ipProjectId: input.ipProjectId ?? null }, { tx });
    await tx.update(productions).set({ settings: { terms, template: bp.key } }).where(eq(productions.id, prod.id));
    const pid = prod.id;
    let seasonId: string | null = null;
    if (usesEpisodes && input.seasonNumber) seasonId = (await createEntity(ctx, "seasons", { productionId: pid, number: input.seasonNumber, title: `Series ${input.seasonNumber}` }, { tx })).id;

    const unitIds: (string | null)[] = [];
    for (let n = 1; n <= units; n++) {
      const ep = await createEntity(ctx, "episodes", { productionId: pid, seasonId, number: n, title: `${terms.unit} ${n}`, kind: "episode", status: "development", deliveryDate: input.endDate ?? null }, { tx });
      unitIds.push(ep.id); counts.units++;
    }
    const containers = usesEpisodes ? unitIds : [null];
    if (inc.runningOrder && bp.runningOrder.length) {
      for (const epId of containers) {
        for (const [i, item] of bp.runningOrder.entries()) {
          await createEntity(ctx, "scenes", { productionId: pid, episodeId: epId, number: String(i + 1), title: item.title, kind: item.kind, estDurationMins: item.mins, sortOrder: (i + 1) * 10, status: "draft" }, { tx });
          counts.items++;
        }
      }
    }
    if (inc.budget && bp.budget.length && canWrite(ctx.role, "finance")) {
      const b = await createEntity(ctx, "budgets", { productionId: pid, name: `${input.title} budget`, versionLabel: "v1" }, { tx });
      for (const [i, l] of bp.budget.entries()) { await createEntity(ctx, "budget_lines", { productionId: pid, budgetId: b.id, code: l.code, category: l.category, estimateMinor: 0, sortOrder: (i + 1) * 10 }, { tx }); counts.budgetLines++; }
    }
    if (inc.deliverables) for (const d of bp.deliverables) {
      for (const epId of d.perUnit && usesEpisodes ? unitIds : [null]) {
        await createEntity(ctx, "deliverables", { productionId: pid, episodeId: epId, title: d.title, spec: d.spec ?? null, dueDate: input.endDate ?? null }, { tx });
        counts.deliverables++;
      }
    }
    if (inc.post) for (const t of bp.post) {
      for (const epId of t.perUnit && usesEpisodes ? unitIds : [null]) {
        await createEntity(ctx, "post_tasks", { productionId: pid, episodeId: epId, kind: t.kind, title: t.title, status: "todo" }, { tx });
        counts.postTasks++;
      }
    }
    if (inc.tasks) for (const t of bp.tasks) {
      await createEntity(ctx, "tasks", { productionId: pid, title: t.title, priority: t.priority, status: "todo", dueDate: input.startDate && t.dueOffsetDays != null ? addDays(input.startDate, t.dueOffsetDays) : null }, { tx });
      counts.tasks++;
    }
    await audit(tx, ctx, "create_from_template", "productions", pid, { productionId: pid, meta: { template: bp.key, counts } });
    return { productionId: pid, counts };
  });
}

/** Capture an existing production's structure (never its people, money or content values). */
export async function saveAsTemplate(ctx: Ctx, productionId: string, name: string, description?: string) {
  if (!canWrite(ctx.role, "production") || ctx.role === "production_manager") throw forbidden("Producers and admins can save templates.");
  if (!name.trim()) throw invalid("Give the template a name.");
  const p = await loadProduction(ctx, productionId);
  const eps = await db.select().from(episodes).where(and(eq(episodes.productionId, p.id), isNull(episodes.archivedAt))).orderBy(asc(episodes.number));
  const firstEp = eps[0]?.id ?? null;
  const items = await db.select().from(scenes).where(and(eq(scenes.productionId, p.id), firstEp ? eq(scenes.episodeId, firstEp) : isNull(scenes.episodeId), isNull(scenes.archivedAt))).orderBy(asc(scenes.sortOrder), asc(scenes.number));
  const [b] = await db.select().from(budgets).where(and(eq(budgets.productionId, p.id), isNull(budgets.archivedAt))).orderBy(asc(budgets.createdAt)).limit(1);
  const lines = b ? await db.select().from(budgetLines).where(and(eq(budgetLines.budgetId, b.id), isNull(budgetLines.archivedAt))).orderBy(asc(budgetLines.sortOrder)) : [];
  const dels = await db.select().from(deliverables).where(and(eq(deliverables.productionId, p.id), isNull(deliverables.archivedAt)));
  const posts = await db.select().from(postTasks).where(and(eq(postTasks.productionId, p.id), isNull(postTasks.archivedAt)));
  const tks = await db.select().from(tasks).where(and(eq(tasks.productionId, p.id), isNull(tasks.archivedAt)));
  const uniq = <T,>(xs: T[], k: (x: T) => string) => [...new Map(xs.map((x) => [k(x), x])).values()];
  const base = blueprint(p.settings?.template ?? "") ?? blueprint("blank")!;
  const bp: Blueprint = {
    key: "custom", name: name.trim(), description: description?.trim() || `Saved from ${p.title}`, kind: p.kind, usesEpisodes: p.usesEpisodes,
    terms: { ...base.terms, ...(p.settings?.terms ?? {}) } as Blueprint["terms"],
    defaults: { units: eps.length, itemKind: items[0]?.kind ?? base.defaults.itemKind, generalCall: base.defaults.generalCall },
    runningOrder: items.map((s) => ({ title: s.title, kind: s.kind, mins: s.estDurationMins ?? 0 })),
    budget: lines.map((l) => ({ code: l.code ?? "", category: l.category })),
    deliverables: uniq(dels, (d) => d.title).map((d) => ({ title: d.title, spec: d.spec ?? undefined, perUnit: !!d.episodeId })),
    post: uniq(posts, (t) => `${t.kind}:${t.title}`).map((t) => ({ kind: t.kind, title: t.title, perUnit: !!t.episodeId })),
    tasks: uniq(tks, (t) => t.title).map((t) => ({ title: t.title, priority: t.priority as Blueprint["tasks"][number]["priority"], dueOffsetDays: p.startDate && t.dueDate ? Math.round((Date.parse(t.dueDate) - Date.parse(p.startDate)) / 864e5) : undefined })),
  };
  const [row] = await db.insert(productionTemplates).values({ orgId: ctx.orgId, createdBy: ctx.userId, name: bp.name, description: bp.description, baseKind: p.kind, blueprint: bp }).returning();
  await audit(db, ctx, "save_template", "productions", p.id, { productionId: p.id, meta: { templateId: row.id, items: bp.runningOrder.length } });
  return row;
}

export async function archiveTemplate(ctx: Ctx, id: string) {
  if (!["org_admin", "producer", "executive"].includes(ctx.role)) throw forbidden();
  const [row] = await db.update(productionTemplates).set({ archivedAt: new Date() }).where(and(eq(productionTemplates.id, id), eq(productionTemplates.orgId, ctx.orgId))).returning();
  if (!row) throw notFound();
}
