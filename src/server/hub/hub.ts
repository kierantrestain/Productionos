/**
 * The workspace hub: the cross-base layer that makes the OS a daily habit.
 *  - myWork: everything that needs *this person* today, across every base they can open
 *    (assigned to them, overdue / due soon, approvals waiting on them).
 *  - searchEverything: one search box for bases, tables, apps and records.
 *  - systemStatus: honest, server-computed status of each integration (never claims "live" without config).
 * All reads go through the same permission layer as the bases themselves.
 */
import { and, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { baseApprovals, baseRecords, baseTables, recordComments, users } from "@/db/schema";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { invalid } from "../errors";
import { hashPassword, verifyPassword } from "../auth/password";
import { atLeast } from "../platform/access";
import { loadBaseStructure, listBases } from "../platform/schema";
import { runView } from "../platform/query";
import { createRecords } from "../platform/records";
import { cellText } from "@/lib/platform/cell-text";
import { listApps } from "../apps/apps";
import { aiConfigured } from "../platform/ai";
import { mailStatus } from "../integrations/providers";
import { storageStatus } from "../storage";

export type WorkItem = { baseId: string; baseName: string; color: string; tableId: string; tableName: string; recordId: string; title: string; due?: string; status?: string; statusColor?: string; reason: "assigned" | "overdue" | "today" | "soon" };
const DONE = /\b(done|complete|completed|won|lost|closed|delivered|paid|cancel+ed|archived|wrapped|approved|rejected|shipped)\b/i;
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function myWork(ctx: Ctx, opts: { maxTables?: number; mentionsSince?: Date } = {}) {
  const now = new Date(); const today = day(now); const week = day(new Date(now.getTime() + 7 * 864e5));
  const bases = (await listBases(ctx)).slice(0, 20);
  const items: WorkItem[] = []; let scanned = 0; const max = opts.maxTables ?? 40;
  for (const b of bases) {
    if (scanned >= max) break;
    const st = await loadBaseStructure(ctx, b.id);
    for (const t of st.tables) {
      if (scanned >= max) break;
      const fs = st.fields.filter((f) => f.tableId === t.id);
      const userFs = fs.filter((f) => f.type === "user");
      const dates = fs.filter((f) => f.type === "date" || f.type === "dateTime");
      const dueF = dates.find((f) => /\b(due|deadline|delivery|deliver by|end|ends|expir\w*|renew\w*|close date|target)\b/i.test(f.name));
      if (!userFs.length && !dueF) continue;
      scanned++;
      const statusF = fs.find((f) => f.type === "singleSelect" && /status|stage|state/i.test(f.name));
      const r = await runView(ctx, b.role === "portal" ? "reader" : b.role, t.id, {});
      const primary = r.fields.find((f) => f.id === t.primaryFieldId) ?? r.fields[0];
      for (const row of r.rows) {
        const sv = statusF ? row.values[statusF.id] : undefined;
        const choice = statusF ? ((statusF.options as { choices?: { id: string; name: string; color?: string }[] })?.choices ?? []).find((c) => c.id === sv) : undefined;
        if (choice && DONE.test(choice.name)) continue;
        const mine = userFs.some((f) => { const v = row.values[f.id]; return Array.isArray(v) && v.some((x) => (typeof x === "string" ? x : (x as { id?: string })?.id) === ctx.userId); });
        const dv = dueF ? row.values[dueF.id] : null; const d = dv ? String(dv).slice(0, 10) : undefined;
        const reason: WorkItem["reason"] | null = d && d < today ? "overdue" : d === today ? "today" : mine ? "assigned" : d && d <= week ? "soon" : null;
        // Due-date items only count as "mine" when the table has no assignee field or I'm the assignee.
        if (!reason || (!mine && userFs.length && reason !== "assigned")) continue;
        items.push({ baseId: b.id, baseName: b.name, color: b.color, tableId: t.id, tableName: t.name, recordId: row.id, title: (primary ? cellText(primary as never, row.values[primary.id]) : "") || "Unnamed", due: d, status: choice?.name, statusColor: choice?.color, reason });
      }
    }
  }
  const rank = { overdue: 0, today: 1, soon: 2, assigned: 3 };
  items.sort((a, b) => rank[a.reason] - rank[b.reason] || (a.due ?? "9").localeCompare(b.due ?? "9"));
  // Approvals waiting on me: pending items in bases where I can decide (creator and up).
  const deciders = bases.filter((b) => atLeast(b.role, "creator"));
  const approvals = deciders.length ? await db.select().from(baseApprovals).where(and(eq(baseApprovals.orgId, ctx.orgId), eq(baseApprovals.status, "pending"), inArray(baseApprovals.baseId, deciders.map((b) => b.id)))).limit(50) : [];
  const baseName = new Map(bases.map((b) => [b.id, b]));
  // Mentions: comments in the last 30 days that @mention me, on records in bases I can open.
  const ments = bases.length ? await db.select({ id: recordComments.id, body: recordComments.body, createdAt: recordComments.createdAt, recordId: recordComments.recordId, author: users.name, tableId: baseTables.id, tableName: baseTables.name, baseId: baseTables.baseId, primaryFieldId: baseTables.primaryFieldId, data: baseRecords.data })
    .from(recordComments).innerJoin(baseRecords, eq(baseRecords.id, recordComments.recordId)).innerJoin(baseTables, eq(baseTables.id, baseRecords.tableId)).leftJoin(users, eq(users.id, recordComments.createdBy))
    .where(and(eq(recordComments.orgId, ctx.orgId), isNull(recordComments.deletedAt), sql`${recordComments.mentions} @> ${JSON.stringify([ctx.userId])}::jsonb`, gte(recordComments.createdAt, new Date(now.getTime() - 30 * 864e5)), inArray(baseTables.baseId, bases.map((b) => b.id)), isNull(baseTables.archivedAt)))
    .orderBy(desc(recordComments.createdAt)).limit(50) : [];
  const mentions = ments.map((m) => ({ id: m.id, baseId: m.baseId, baseName: baseName.get(m.baseId)?.name ?? "", color: baseName.get(m.baseId)?.color ?? "blue", tableId: m.tableId, tableName: m.tableName, recordId: m.recordId,
    record: String((m.primaryFieldId && m.data[m.primaryFieldId]) ?? "Unnamed"), author: m.author ?? "Someone", body: m.body.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, "@$1").slice(0, 280), createdAt: m.createdAt.toISOString() }));
  const newMentions = opts.mentionsSince ? ments.filter((m) => m.createdAt > opts.mentionsSince!).length : 0;
  return {
    mentions,
    items: items.slice(0, 200),
    counts: { overdue: items.filter((i) => i.reason === "overdue").length, today: items.filter((i) => i.reason === "today").length, soon: items.filter((i) => i.reason === "soon").length, assigned: items.filter((i) => i.reason === "assigned").length, approvals: approvals.length, mentions: mentions.length, newMentions },
    approvals: approvals.map((a) => ({ id: a.id, baseId: a.baseId, baseName: baseName.get(a.baseId)?.name ?? "", summary: a.summary, kind: a.kind, source: a.source, createdAt: a.createdAt.toISOString() })),
    recentBases: [...bases].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 6).map((b) => ({ id: b.id, name: b.name, color: b.color, icon: b.icon })),
    scannedTables: scanned,
  };
}

export type SearchHit = { kind: "base" | "table" | "app" | "record" | "create"; id: string; title: string; subtitle: string; href: string; color?: string; text?: string };
export async function searchEverything(ctx: Ctx, q: string, currentBaseId?: string): Promise<SearchHit[]> {
  const term = q.trim(); if (term.length < 1) return [];
  const n = term.toLowerCase();
  const bases = await listBases(ctx);
  if (!bases.length) return [];
  const bmap = new Map(bases.map((b) => [b.id, b]));
  const tables = await db.select().from(baseTables).where(and(inArray(baseTables.baseId, bases.map((b) => b.id)), isNull(baseTables.archivedAt)));
  const out: SearchHit[] = [];
  for (const b of bases) if (b.name.toLowerCase().includes(n)) out.push({ kind: "base", id: b.id, title: b.name, subtitle: "Base", href: `/base/${b.id}`, color: b.color });
  for (const t of tables) if (t.name.toLowerCase().includes(n)) out.push({ kind: "table", id: t.id, title: t.name, subtitle: `Table in ${bmap.get(t.baseId)?.name}`, href: `/base/${t.baseId}/${t.id}`, color: bmap.get(t.baseId)?.color });
  if (ctx.platformRole !== "portal") for (const a of await listApps(ctx)) if (a.name.toLowerCase().includes(n) && (a.publishedVersionId || atLeast(a.role, "creator"))) out.push({ kind: "app", id: a.id, title: a.name, subtitle: a.publishedVersionId ? "App" : "App (draft)", href: a.publishedVersionId ? `/a/${a.slug}` : `/builder/${a.id}` });
  // Records: match the primary field text (fast path in SQL, permissions already scoped to visible bases).
  const searchable = tables.filter((t) => t.primaryFieldId);
  if (term.length >= 2 && searchable.length) {
    const like = `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const conds = searchable.map((t) => and(eq(baseRecords.tableId, t.id), ilike(sql`${baseRecords.data}->>${t.primaryFieldId}`, like)));
    const rows = await db.select({ id: baseRecords.id, tableId: baseRecords.tableId, data: baseRecords.data }).from(baseRecords).where(and(eq(baseRecords.orgId, ctx.orgId), or(...conds))).limit(25);
    const tmap = new Map(searchable.map((t) => [t.id, t]));
    for (const r of rows) { const t = tmap.get(r.tableId)!; out.push({ kind: "record", id: r.id, title: String(r.data[t.primaryFieldId!] ?? "Unnamed"), subtitle: `${t.name} · ${bmap.get(t.baseId)?.name}`, href: `/base/${t.baseId}/${t.id}?record=${r.id}`, color: bmap.get(t.baseId)?.color }); }
  }
  // Quick add: "Tasks: call Horizon Friday" → offer to create that record in matching tables I can edit.
  const qa = term.match(/^([^:]{2,60}):\s*(.{1,500})$/);
  if (qa) {
    const tn = qa[1].trim().toLowerCase();
    const cands = tables.filter((x) => x.primaryFieldId && atLeast(bmap.get(x.baseId)!.role, "editor") && x.name.toLowerCase().startsWith(tn))
      .sort((a, b) => Number(b.baseId === currentBaseId) - Number(a.baseId === currentBaseId)).slice(0, 4).reverse();
    for (const t of cands)
      out.unshift({ kind: "create", id: t.id, title: `Add “${qa[2].trim()}” to ${t.name}`, subtitle: `New record in ${bmap.get(t.baseId)?.name}`, href: `/base/${t.baseId}/${t.id}`, color: bmap.get(t.baseId)?.color, text: qa[2].trim() });
    if (out[0]?.kind === "create") return out.slice(0, 30);
  }
  const score = (h: SearchHit) => (h.title.toLowerCase() === n ? 0 : h.title.toLowerCase().startsWith(n) ? 1 : 2) + ({ base: 0, app: 0.1, table: 0.2, record: 0.3, create: -1 })[h.kind];
  return out.sort((a, b) => score(a) - score(b)).slice(0, 30);
}

export function systemStatus() {
  const mail = mailStatus();
  const enc = (() => { const k = process.env.SECRET_ENCRYPTION_KEY; try { return !!k && Buffer.from(k, "base64").length === 32; } catch { return false; } })();
  const st = storageStatus();
  return [
    { key: "ai", name: "AI (Claude)", ok: aiConfigured(), detail: aiConfigured() ? "Configured. AI fields, agents, planner and summaries are available." : "Not configured: an administrator must set ANTHROPIC_API_KEY. AI features are disabled until then." },
    { key: "secrets", name: "Secret encryption", ok: enc, detail: enc ? "Configured. Sync credentials and SSO secrets can be stored encrypted." : "Not configured: set SECRET_ENCRYPTION_KEY (32 random bytes, base64). Airtable sync and SSO secrets are refused until then." },
    { key: "mail", name: "Email delivery", ok: mail.enabled, detail: mail.enabled ? `Provider: ${mail.provider}.` : `Not sending: ${mail.reason}. Messages are drafted and blocked, never sent.` },
    { key: "storage", name: "File storage", ok: st.durable, detail: st.note },
    { key: "slack", name: "Slack notifications", ok: /^https:\/\/hooks\.slack\.com\//.test(process.env.SLACK_WEBHOOK_URL ?? ""), detail: /^https:\/\/hooks\.slack\.com\//.test(process.env.SLACK_WEBHOOK_URL ?? "") ? "Automations can post to your Slack channel." : "Not configured: set SLACK_WEBHOOK_URL (a Slack incoming-webhook URL). Slack steps are skipped and logged until then." },
    { key: "jobs", name: "Scheduled jobs", ok: !!process.env.CRON_SECRET, detail: process.env.CRON_SECRET ? "Job endpoint is protected; schedules run when the scheduler calls it." : "CRON_SECRET not set: scheduled automations only run when triggered manually." },
  ];
}

export async function updateProfile(ctx: Ctx, input: { name: string }) {
  const name = input.name?.trim(); if (!name) throw invalid("Enter your name.");
  await db.update(users).set({ name: name.slice(0, 120) }).where(eq(users.id, ctx.userId));
  await audit(db, ctx, "update_profile", "users", ctx.userId, { meta: { field: "name" } });
}
export async function changePassword(ctx: Ctx, current: string, next: string) {
  if (!next || next.length < 12) throw invalid("Use at least 12 characters for the new password.");
  const [u] = await db.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!u || !(await verifyPassword(current, u.passwordHash))) throw invalid("Your current password is incorrect.");
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, ctx.userId));
  await audit(db, ctx, "change_password", "users", ctx.userId, {});
}

/** Quick add from search: creates a record with the primary field set; normal permissions and automations apply. */
export async function quickAdd(ctx: Ctx, tableId: string, text: string) {
  const v = text.trim(); if (!v) throw invalid("Type what to add.");
  const [t] = await db.select().from(baseTables).where(and(eq(baseTables.id, tableId), eq(baseTables.orgId, ctx.orgId), isNull(baseTables.archivedAt))).limit(1);
  if (!t?.primaryFieldId) throw invalid("That table can't take quick adds.");
  const [id] = await createRecords(ctx, t.id, [{ [t.primaryFieldId]: v.slice(0, 500) }]);
  return { baseId: t.baseId, tableId: t.id, recordId: id };
}

/** AI morning briefing from the same facts My work shows. Refuses (never fakes) when AI isn't configured. */
export async function morningBriefing(ctx: Ctx) {
  if (!aiConfigured()) throw invalid("AI isn't configured yet: an administrator must set ANTHROPIC_API_KEY. Until then, My work shows everything the briefing would use.");
  const w = await myWork(ctx, { maxTables: 40 });
  const line = (i: WorkItem) => `- [${i.reason}] ${i.title} (${i.tableName}, ${i.baseName})${i.due ? ` due ${i.due}` : ""}${i.status ? ` status ${i.status}` : ""}`;
  const facts = [
    `Counts: ${w.counts.overdue} overdue, ${w.counts.today} due today, ${w.counts.soon} due this week, ${w.counts.assigned} assigned, ${w.counts.approvals} approvals waiting, ${w.counts.mentions} mentions (30 days).`,
    "Items:", ...w.items.slice(0, 40).map(line),
    "Approvals:", ...w.approvals.slice(0, 10).map((a) => `- ${a.summary} (${a.baseName})`),
    "Recent mentions:", ...w.mentions.slice(0, 8).map((m) => `- ${m.author} on ${m.record}: ${m.body.slice(0, 160)}`),
  ].join("\n");
  const { generateBriefing } = await import("../platform/ai");
  return { text: await generateBriefing(ctx.name.split(" ")[0], facts), at: new Date().toISOString() };
}
