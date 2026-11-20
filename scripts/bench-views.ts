/**
 * View-engine benchmark. Creates a throwaway org with a Deals table of N rows (text, number, single
 * select, date, link → Clients, formula) and times the operations behind the grid.
 *   pnpm tsx scripts/bench-views.ts 10000 50000 100000
 * Uses DATABASE_URL (never run against production). Prints a markdown table; cleans up afterwards.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { eq, sql } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { baseRecords, memberships, organisations } from "@/db/schema";
import { createOrganisation, createUserWithMembership } from "@/server/services/admin";
import { contextForUser } from "@/server/auth/sessions";
import { createBaseFromSpec } from "@/server/platform/spec";
import { loadBaseStructure } from "@/server/platform/schema";
import { runView } from "@/server/platform/query";
import { commentCounts } from "@/server/platform/records";

const sizes = process.argv.slice(2).map(Number).filter(Boolean);
if (!sizes.length) sizes.push(10_000, 50_000, 100_000);
if (/neon|vercel|amazonaws/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to benchmark against a hosted database.");
const PAGE = Number(process.env.BENCH_PAGE ?? 500);

async function time<T>(fn: () => Promise<T>, runs = 3): Promise<{ ms: number | string; out: T }> {
  const t: number[] = []; let out!: T;
  try {
    for (let i = 0; i < runs; i++) { const s = performance.now(); out = await fn(); t.push(performance.now() - s); }
  } catch (e) {
    return { ms: `FAIL (${String((e as { code?: string }).code ?? (e as Error).message).slice(0, 40)})`, out: undefined as never };
  }
  t.sort((a, b) => a - b);
  return { ms: Math.round(t[Math.floor(t.length / 2)]), out };
}

async function main() {
  const results: string[] = [];
  for (const n of sizes) {
    const org = await createOrganisation({ name: `Bench ${n}`, slug: `bench-${randomUUID()}`, isDemo: true });
    const u = await createUserWithMembership({ orgId: org.id, email: `bench-${randomUUID()}@example.test`, name: "Bench", role: "org_admin" });
    await db.update(memberships).set({ platformRole: "owner" }).where(eq(memberships.userId, u.id));
    const ctx = (await contextForUser(u.id, org.id))!;
    const r = await createBaseFromSpec(ctx, { name: "Bench", tables: [
      { name: "Clients", fields: [{ name: "Client", type: "singleLineText" }], records: Array.from({ length: 200 }, (_, i) => ({ Client: `Client ${i}` })) },
      { name: "Deals", fields: [
        { name: "Deal", type: "singleLineText" }, { name: "Amount", type: "number" }, { name: "Stage", type: "singleSelect", choices: ["Lead", "Proposal", "Won", "Lost"] },
        { name: "Close", type: "date" }, { name: "Client", type: "link", linkTo: "Clients", singleRecord: true }, { name: "Weighted", type: "formula", formula: "IF({Stage} = \"Won\", {Amount}, {Amount} * 0.5)" },
      ] },
    ] });
    const st = await loadBaseStructure(ctx, r.baseId);
    const F = (t: string, n2: string) => st.fields.find((f) => f.tableId === r.tableIds[t] && f.name === n2)!;
    const stage = F("Deals", "Stage"); const choices = stage.options.choices!;
    const clients = await db.select({ id: baseRecords.id }).from(baseRecords).where(eq(baseRecords.tableId, r.tableIds.Clients));
    const seed = performance.now();
    for (let i = 0; i < n; i += 2000) {
      const batch = Array.from({ length: Math.min(2000, n - i) }, (_, k) => {
        const j = i + k;
        return { orgId: org.id, tableId: r.tableIds.Deals, autonumber: j + 1, sortOrder: j + 1, createdBy: u.id, updatedBy: u.id,
          data: { [F("Deals", "Deal").id]: `Deal ${j}`, [F("Deals", "Amount").id]: (j * 37) % 10000, [stage.id]: choices[j % 4].id, [F("Deals", "Close").id]: `2027-${String((j % 12) + 1).padStart(2, "0")}-${String((j % 28) + 1).padStart(2, "0")}`, [F("Deals", "Client").id]: [clients[j % clients.length].id] } };
      });
      await db.insert(baseRecords).values(batch);
    }
    await db.execute(sql`analyze base_records`);
    const seedMs = Math.round(performance.now() - seed);
    const tid = r.tableIds.Deals;
    const won = choices.find((c) => c.name === "Won")!.id;
    const full = await time(() => runView(ctx, "owner", tid, {}, {}), 1);
    const fullBytes = full.out ? JSON.stringify(full.out.rows).length : 0;
    const first = await time(() => runView(ctx, "owner", tid, {}, { limit: PAGE }));
    const filtered = await time(() => runView(ctx, "owner", tid, { filters: { conjunction: "and", conditions: [{ fieldId: stage.id, op: "is", value: won }, { fieldId: F("Deals", "Amount").id, op: ">", value: 5000 }] } }, { limit: PAGE }));
    const sorted = await time(() => runView(ctx, "owner", tid, { sorts: [{ fieldId: F("Deals", "Amount").id, dir: "desc" }] }, { limit: PAGE }));
    const sortedFormula = await time(() => runView(ctx, "owner", tid, { sorts: [{ fieldId: F("Deals", "Weighted").id, dir: "desc" }] }, { limit: PAGE }));
    const anyId = (await db.select({ id: baseRecords.id }).from(baseRecords).where(eq(baseRecords.tableId, tid)).limit(1))[0].id;
    const one = await time(() => runView(ctx, "owner", tid, {}, { recordIds: [anyId] }));
    const search = await time(() => runView(ctx, "owner", tid, {}, { search: "Deal 4242", limit: PAGE }));
    // Grid initial page load = view + comment counts + serialised payload.
    const grid = await time(async () => { const v = await runView(ctx, "owner", tid, {}, { limit: PAGE }); const c = await commentCounts(ctx, v.rows.map((x) => x.id)); return JSON.stringify({ rows: v.rows, c }).length; });
    results.push(`| ${n.toLocaleString("en-GB")} | one record ${one.ms} | ${seedMs} | ${full.ms} (${(fullBytes / 1048576).toFixed(1)} MB) | ${first.ms} | ${filtered.ms} (${filtered.out?.matched ?? "?"} match) | ${sorted.ms} | ${sortedFormula.ms} | ${search.ms} | ${grid.ms} | ${grid.out ? (grid.out / 1024).toFixed(0) : "?"} KB · ${first.out?.rows.length ?? "?"}/${first.out?.total ?? "?"} rows |`);
    await db.delete(organisations).where(eq(organisations.id, org.id));
  }
  console.log(`\nPage size ${PAGE}. Median of 3 runs, milliseconds.\n`);
  console.log("| Rows | Single record | Seed (insert) | Unpaged (before) | First page | Filtered (select + number) | Sorted (number) | Sorted (formula) | Search | Grid initial load | Payload |");
  console.log("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const l of results) console.log(l);
  await closeDb();
}
main().catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
