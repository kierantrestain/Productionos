/**
 * One-way data sync into a table: a public CSV URL, or an Airtable table via a personal access token
 * (encrypted at rest; read-only GET requests only — the source is never modified). Records are upserted
 * by source key (base_records.source_ref). Synced writes are import-origin, so they never fire
 * automations or external actions. Missing source rows are reported, never deleted.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { baseFields, baseRecords, syncSources } from "@/db/schema";
import { COLORS, newChoiceId, coerceValue, isComputed, type FieldOptions } from "@/lib/platform/fields";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { decryptSecret, encryptSecret } from "../crypto";
import { invalid, notFound } from "../errors";
import { baseAccess, requireRole } from "./access";
import { parseCsv, inferTable } from "./importer";
import { createRecords, updateRecord } from "./records";
import { asLite } from "./schema";
import { createBaseFromSpec } from "./spec";

export type SyncKind = "csv_url" | "airtable";
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (u, i) => fetch(u, i);
/** Test seam: integration tests stub the network (clearly mock-only). */
export function __setSyncFetcher(f: Fetcher | null) { fetcher = f ?? ((u, i) => fetch(u, i)); }

function privateAddr(ip: string): boolean {
  if (isIP(ip) === 6) return ip === "::1" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || ip.startsWith("::ffff:") && privateAddr(ip.slice(7));
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
/** SSRF guard: https only, and the host must not resolve to a private or loopback address. */
async function assertPublicUrl(raw: string) {
  let u: URL; try { u = new URL(raw); } catch { throw invalid("Enter a valid URL."); }
  if (u.protocol !== "https:") throw invalid("Only https:// sources are allowed.");
  const addrs = await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => privateAddr(a.address))) throw invalid("That host can't be reached from here (private or unknown address).");
  return u;
}

export async function listSyncs(ctx: Ctx, baseId: string) {
  await baseAccess(ctx, baseId);
  const rows = await db.select().from(syncSources).where(and(eq(syncSources.baseId, baseId), eq(syncSources.orgId, ctx.orgId), isNull(syncSources.archivedAt)));
  return rows.map(({ secretCipher, ...r }) => ({ ...r, hasSecret: !!secretCipher }));
}

export async function createSync(ctx: Ctx, baseId: string, input: { kind: SyncKind; name: string; url?: string; airtableBaseId?: string; airtableTable?: string; token?: string; keyColumn?: string; intervalMinutes?: number | null }) {
  requireRole(await baseAccess(ctx, baseId), "creator", "set up syncs");
  const config: Record<string, unknown> = { name: input.name?.trim() || "Synced table" };
  let secretCipher: string | null = null;
  if (input.kind === "csv_url") { await assertPublicUrl(input.url ?? ""); config.url = input.url; config.keyColumn = input.keyColumn?.trim() || null; }
  else if (input.kind === "airtable") {
    if (!/^app[A-Za-z0-9]{14}$/.test(input.airtableBaseId ?? "")) throw invalid("Airtable base IDs look like appXXXXXXXXXXXXXX.");
    if (!input.airtableTable?.trim()) throw invalid("Enter the Airtable table name or ID.");
    if (!input.token?.trim()) throw invalid("A read-only Airtable personal access token is required.");
    config.airtableBaseId = input.airtableBaseId; config.airtableTable = input.airtableTable.trim();
    secretCipher = encryptSecret(input.token.trim());
  } else throw invalid("Unknown sync type.");
  const interval = input.intervalMinutes && input.intervalMinutes >= 60 ? Math.min(input.intervalMinutes, 10080) : null;
  const [row] = await db.insert(syncSources).values({ orgId: ctx.orgId, baseId, kind: input.kind, config, secretCipher, intervalMinutes: interval, createdBy: ctx.userId }).returning();
  await audit(db, ctx, "create_sync", "sync_sources", row.id, { meta: { kind: input.kind, name: config.name } });
  return row;
}

export async function deleteSync(ctx: Ctx, id: string) {
  const [s] = await db.select().from(syncSources).where(and(eq(syncSources.id, id), eq(syncSources.orgId, ctx.orgId))).limit(1);
  if (!s) throw notFound();
  requireRole(await baseAccess(ctx, s.baseId), "creator", "remove syncs");
  await db.update(syncSources).set({ archivedAt: new Date(), secretCipher: null }).where(eq(syncSources.id, id));
  await audit(db, ctx, "delete_sync", "sync_sources", id, {});
}

/** Fetch source rows as a header + string matrix plus a stable key per row. */
async function fetchSource(s: typeof syncSources.$inferSelect): Promise<{ header: string[]; rows: { key: string; cells: string[] }[] }> {
  const c = s.config as Record<string, string | null>;
  if (s.kind === "csv_url") {
    const u = await assertPublicUrl(c.url!);
    const r = await fetcher(u.toString(), { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw invalid(`The CSV URL returned HTTP ${r.status}.`);
    const text = await r.text(); if (text.length > 20 * 1024 * 1024) throw invalid("CSV sources are limited to 20 MB.");
    const m = parseCsv(text); const header = m[0] ?? [];
    const ki = c.keyColumn ? header.findIndex((h) => h.trim().toLowerCase() === c.keyColumn!.toLowerCase()) : 0;
    if (ki < 0) throw invalid(`Key column “${c.keyColumn}” isn't in the CSV.`);
    return { header, rows: m.slice(1).filter((r2) => r2.some((x) => x.trim())).map((cells) => ({ key: `csv:${cells[ki]}`, cells })) };
  }
  const token = decryptSecret(s.secretCipher ?? "");
  const out: { id: string; fields: Record<string, unknown> }[] = []; let offset: string | undefined;
  for (let page = 0; page < 200; page++) {
    const url = `https://api.airtable.com/v0/${c.airtableBaseId}/${encodeURIComponent(c.airtableTable!)}?pageSize=100${offset ? `&offset=${offset}` : ""}`;
    const r = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 401 || r.status === 403) throw invalid("Airtable rejected the token (check its scopes: data.records:read and base access).");
    if (r.status === 429) throw invalid("Airtable rate limit reached — the next run will continue.");
    if (!r.ok) throw invalid(`Airtable returned HTTP ${r.status}.`);
    const j = await r.json() as { records: { id: string; fields: Record<string, unknown> }[]; offset?: string };
    out.push(...j.records); offset = j.offset; if (!offset) break;
  }
  const header = [...new Set(out.flatMap((r) => Object.keys(r.fields)))];
  const str = (v: unknown): string => v === null || v === undefined ? "" : Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? String((x as { name?: string; filename?: string }).name ?? (x as { filename?: string }).filename ?? "") : String(x))).filter(Boolean).join(", ") : typeof v === "object" ? String((v as { name?: string }).name ?? JSON.stringify(v)) : String(v);
  return { header, rows: out.map((r) => ({ key: `at:${r.id}`, cells: header.map((h) => str(r.fields[h])) })) };
}

export async function runSync(ctx: Ctx, id: string) {
  const [s] = await db.select().from(syncSources).where(and(eq(syncSources.id, id), eq(syncSources.orgId, ctx.orgId), isNull(syncSources.archivedAt))).limit(1);
  if (!s) throw notFound();
  requireRole(await baseAccess(ctx, s.baseId), "creator", "run syncs");
  await db.update(syncSources).set({ status: "running" }).where(eq(syncSources.id, id));
  try {
    const src = await fetchSource(s);
    const stats = { fetched: src.rows.length, created: 0, updated: 0, unchanged: 0, skippedCells: 0, missingFromSource: 0, newFields: 0 };
    let tableId = s.tableId;
    if (!tableId) {
      const spec = inferTable(String((s.config as { name: string }).name), [src.header, ...src.rows.slice(0, 2000).map((r) => r.cells)]);
      spec.records = [];
      const r = await createBaseFromSpec(ctx, { name: "sync", tables: [spec] }, { intoBaseId: s.baseId });
      tableId = Object.values(r.tableIds)[0];
      await db.update(syncSources).set({ tableId }).where(eq(syncSources.id, id));
    }
    let fields = (await db.select().from(baseFields).where(and(eq(baseFields.tableId, tableId), isNull(baseFields.archivedAt)))).map(asLite);
    // New source columns become text fields.
    for (const h of src.header) if (h.trim() && !fields.some((f) => f.name.toLowerCase() === h.trim().toLowerCase())) {
      await db.insert(baseFields).values({ orgId: ctx.orgId, tableId, name: h.trim().slice(0, 120), type: "singleLineText", options: {}, sortOrder: 10_000 + stats.newFields, createdBy: ctx.userId }); stats.newFields++;
    }
    if (stats.newFields) fields = (await db.select().from(baseFields).where(and(eq(baseFields.tableId, tableId), isNull(baseFields.archivedAt)))).map(asLite);
    const col = src.header.map((h) => fields.find((f) => f.name.toLowerCase() === h.trim().toLowerCase() && !isComputed(f.type) && !["link", "user", "attachment", "button"].includes(f.type)));
    // Extend select options with values seen in the source.
    for (const f of fields.filter((x) => x.type === "singleSelect" || x.type === "multipleSelects")) {
      const i = col.indexOf(f); if (i < 0) continue;
      const seen = new Set(src.rows.flatMap((r) => (f.type === "multipleSelects" ? r.cells[i].split(",") : [r.cells[i]]).map((x) => x.trim()).filter(Boolean)));
      const have = new Set((f.options.choices ?? []).map((c) => c.name));
      const add = [...seen].filter((n) => !have.has(n)).slice(0, 500);
      if (add.length) {
        const choices = [...(f.options.choices ?? []), ...add.map((name, k) => ({ id: newChoiceId(), name, color: COLORS[((f.options.choices?.length ?? 0) + k) % COLORS.length] }))];
        const options: FieldOptions = { ...f.options, choices };
        await db.update(baseFields).set({ options }).where(eq(baseFields.id, f.id)); f.options = options;
      }
    }
    const existing = await db.select({ id: baseRecords.id, ref: baseRecords.sourceRef, data: baseRecords.data }).from(baseRecords).where(and(eq(baseRecords.tableId, tableId), isNull(baseRecords.deletedAt)));
    const byRef = new Map(existing.filter((e) => e.ref).map((e) => [e.ref!, e]));
    const seenRefs = new Set<string>();
    for (const row of src.rows) {
      if (!row.key || seenRefs.has(row.key)) continue; seenRefs.add(row.key);
      const vals: Record<string, unknown> = {};
      row.cells.forEach((cell, i) => {
        const f = col[i]; if (!f) return;
        try { vals[f.id] = coerceValue(f, f.type === "multipleSelects" ? cell.split(",").map((x) => x.trim()).filter(Boolean) : cell); } catch { stats.skippedCells++; }
      });
      const cur = byRef.get(row.key);
      if (!cur) {
        const [nid] = await createRecords(ctx, tableId, [vals], { origin: "import", skipPermission: true });
        await db.update(baseRecords).set({ sourceRef: row.key }).where(eq(baseRecords.id, nid)); stats.created++;
      } else {
        const diff = Object.fromEntries(Object.entries(vals).filter(([k, v]) => JSON.stringify(cur.data[k] ?? null) !== JSON.stringify(v ?? null)));
        if (Object.keys(diff).length) { await updateRecord(ctx, cur.id, diff, { origin: "import" }); stats.updated++; } else stats.unchanged++;
      }
    }
    stats.missingFromSource = [...byRef.keys()].filter((k) => !seenRefs.has(k)).length;
    await db.update(syncSources).set({ status: "ok", lastSyncedAt: new Date(), lastError: null, lastStats: stats }).where(eq(syncSources.id, id));
    await audit(db, ctx, "run_sync", "sync_sources", id, { meta: stats });
    return { tableId, stats };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 500);
    await db.update(syncSources).set({ status: "error", lastError: msg }).where(eq(syncSources.id, id));
    throw err;
  }
}

/** Scheduled runs (cron): every sync whose interval has elapsed, as its creator. */
export async function runDueSyncs() {
  const { contextForUser } = await import("../auth/sessions");
  const due = await db.select().from(syncSources).where(and(isNull(syncSources.archivedAt)));
  const results: { id: string; ok: boolean }[] = [];
  for (const s of due.filter((x) => x.intervalMinutes && (!x.lastSyncedAt || Date.now() - x.lastSyncedAt.getTime() >= x.intervalMinutes * 60_000))) {
    const ctx = s.createdBy ? await contextForUser(s.createdBy, s.orgId) : null;
    if (!ctx) continue;
    try { await runSync(ctx, s.id); results.push({ id: s.id, ok: true }); } catch { results.push({ id: s.id, ok: false }); }
  }
  return results;
}
