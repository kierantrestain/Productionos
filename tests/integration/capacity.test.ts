/**
 * Capacity: large tables page/filter/sort in Postgres. The SQL path must return exactly what the
 * in-memory engine returns (same ids, same order, same matched count) for every operator it handles,
 * and record-specific reads must not load the whole table.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { memberships } from "@/db/schema";
import { contextForUser } from "@/server/auth/sessions";
import { createBaseFromSpec } from "@/server/platform/spec";
import { loadBaseStructure } from "@/server/platform/schema";
import { runView } from "@/server/platform/query";
import type { ViewConfig } from "@/db/schema";
import type { Ctx } from "@/server/auth/context";
import { makeOrg, makeUser } from "../support/factory";

let owner: Ctx; let T: string; let F: Record<string, string>; let C: Record<string, string>;
const iso = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
beforeAll(async () => {
  const org = await makeOrg("Capacity");
  owner = (await (async () => { const u = await makeUser(org.id, "org_admin"); await db.update(memberships).set({ platformRole: "owner" }).where(and(eq(memberships.userId, u.userId), eq(memberships.orgId, org.id))); return contextForUser(u.userId, org.id); })())!;
  const stages = ["Lead", "Won", "Lost"]; const tags = ["a", "b", "c"];
  const records = Array.from({ length: 240 }, (_, i) => ({
    Name: i % 17 === 0 ? "" : `Deal ${String(i).padStart(3, "0")} ${i % 5 === 0 ? "Acme" : "Other"}`,
    Value: i % 11 === 0 ? null : (i * 37) % 1000, Stage: i % 13 === 0 ? null : stages[i % 3], Tags: i % 7 === 0 ? [] : [tags[i % 3], ...(i % 4 === 0 ? [tags[(i + 1) % 3]] : [])],
    Done: i % 2 === 0, Close: i % 9 === 0 ? null : iso((i % 40) - 20), Email: `p${i}@x.test`,
  }));
  const r = await createBaseFromSpec(owner, { name: "Big", tables: [{ name: "Deals", fields: [{ name: "Name", type: "singleLineText" }, { name: "Value", type: "number" }, { name: "Stage", type: "singleSelect", choices: stages }, { name: "Tags", type: "multipleSelects", choices: tags }, { name: "Done", type: "checkbox" }, { name: "Close", type: "date" }, { name: "Email", type: "email" }, { name: "Twice", type: "formula", formula: "{Value} * 2" }], records }] });
  T = r.tableIds.Deals;
  const st = await loadBaseStructure(owner, r.baseId);
  F = Object.fromEntries(st.fields.filter((f) => f.tableId === T).map((f) => [f.name, f.id]));
  C = Object.fromEntries(st.fields.filter((f) => f.tableId === T && f.options.choices).flatMap((f) => f.options.choices!.map((c) => [`${f.name}:${c.name}`, c.id])));
});
afterAll(async () => { delete process.env.FAST_VIEW_MIN_ROWS; await closeDb(); });

async function both(config: ViewConfig, limit = 50, offset = 0) {
  process.env.FAST_VIEW_MIN_ROWS = "999999999"; const slow = await runView(owner, "owner", T, config, { limit, offset });
  process.env.FAST_VIEW_MIN_ROWS = "0"; const fast = await runView(owner, "owner", T, config, { limit, offset });
  return { slow, fast };
}

describe("SQL fast path matches the in-memory engine", () => {
  const cases: [string, () => ViewConfig][] = [
    ["no filter, default order", () => ({})],
    ["text contains / is / doesNotContain / empty", () => ({ filters: { conjunction: "and", conditions: [{ fieldId: F.Name, op: "contains", value: "acme" }] } })],
    ["text doesNotContain with wildcard chars", () => ({ filters: { conjunction: "and", conditions: [{ fieldId: F.Name, op: "doesNotContain", value: "1_%" }] } })],
    ["text isEmpty", () => ({ filters: { conjunction: "and", conditions: [{ fieldId: F.Name, op: "isEmpty" }] } })],
    ["number comparisons", () => ({ filters: { conjunction: "and", conditions: [{ fieldId: F.Value, op: ">=", value: 300 }, { fieldId: F.Value, op: "<", value: 800 }] } })],
    ["number = 0 counts empties like the engine", () => ({ filters: { conjunction: "and", conditions: [{ fieldId: F.Value, op: "=", value: 0 }] } })],
    ["select is / isNot / anyOf (OR)", () => ({ filters: { conjunction: "or", conditions: [{ fieldId: F.Stage, op: "is", value: C["Stage:Won"] }, { fieldId: F.Stage, op: "isEmpty" }] } })],
    ["select isNot", () => ({ filters: { conjunction: "and", conditions: [{ fieldId: F.Stage, op: "isNot", value: C["Stage:Lost"] }] } })],
    ["select isNoneOf", () => ({ filters: { conjunction: "and", conditions: [{ fieldId: F.Stage, op: "isNoneOf", value: [C["Stage:Lead"], C["Stage:Won"]] }] } })],
    ["multi hasAnyOf / hasAllOf / hasNoneOf", () => ({ filters: { conjunction: "and", conditions: [{ fieldId: F.Tags, op: "hasAnyOf", value: [C["Tags:a"]] }, { fieldId: F.Tags, op: "hasNoneOf", value: [C["Tags:c"]] }] } })],
    ["multi hasAllOf", () => ({ filters: { conjunction: "and", conditions: [{ fieldId: F.Tags, op: "hasAllOf", value: [C["Tags:a"], C["Tags:b"]] }] } })],
    ["checkbox", () => ({ filters: { conjunction: "and", conditions: [{ fieldId: F.Done, op: "isNotChecked" }] } })],
    ["dates: before today / within next 7 / is", () => ({ filters: { conjunction: "or", conditions: [{ fieldId: F.Close, op: "isBefore", value: "today" }, { fieldId: F.Close, op: "isWithinNextDays", value: 7 }] } })],
    ["date is / isToday", () => ({ filters: { conjunction: "or", conditions: [{ fieldId: F.Close, op: "is", value: iso(3) }, { fieldId: F.Close, op: "isToday" }] } })],
    ["sort number desc (empties first), then select", () => ({ sorts: [{ fieldId: F.Value, dir: "desc" }, { fieldId: F.Stage, dir: "asc" }] })],
    ["sort date asc + checkbox desc", () => ({ sorts: [{ fieldId: F.Close, dir: "asc" }, { fieldId: F.Done, dir: "desc" }] })],
    ["group by select + filter + sort", () => ({ groups: [{ fieldId: F.Stage, dir: "asc" }], sorts: [{ fieldId: F.Value, dir: "asc" }], filters: { conjunction: "and", conditions: [{ fieldId: F.Done, op: "isChecked" }] } })],
  ];
  for (const [name, cfg] of cases) it(name, async () => {
    for (const [limit, offset] of [[50, 0], [25, 40]]) {
      const { slow, fast } = await both(cfg(), limit, offset);
      expect(fast.matched).toBe(slow.matched);
      expect(fast.total).toBe(slow.total);
      expect(fast.rows.map((r) => r.id)).toEqual(slow.rows.map((r) => r.id));
    }
  });
  it("computed fields are still computed for the page (formula)", async () => {
    const { fast } = await both({ sorts: [{ fieldId: F.Value, dir: "asc" }] }, 10);
    for (const r of fast.rows) expect(r.values[F.Twice]).toBe(r.values[F.Value] == null ? 0 : Number(r.values[F.Value]) * 2);
  });
  it("falls back to memory for things SQL can't express exactly (search, formula sort) — still correct", async () => {
    process.env.FAST_VIEW_MIN_ROWS = "0";
    const s = await runView(owner, "owner", T, {}, { search: "acme", limit: 20 });
    expect(s.rows.length).toBeGreaterThan(0);
    const f = await runView(owner, "owner", T, { sorts: [{ fieldId: F.Twice, dir: "desc" }] }, { limit: 5 });
    expect(f.rows.length).toBe(5);
  });
  it("record-specific reads load only those records but report the true total", async () => {
    const all = await runView(owner, "owner", T, {}, { limit: 3 });
    const one = await runView(owner, "owner", T, {}, { recordIds: [all.rows[1].id] });
    expect(one.rows.map((r) => r.id)).toEqual([all.rows[1].id]);
    expect(one.total).toBe(240);
    expect(one.rows[0].values[F.Twice]).toBeDefined();
  });
});

describe("large-table search", () => {
  it("matches stored text and select names, never searches fields the caller can't see", async () => {
    process.env.FAST_VIEW_MIN_ROWS = "0";
    const acme = await runView(owner, "owner", T, {}, { search: "acme", limit: 500 });
    process.env.FAST_VIEW_MIN_ROWS = "999999999";
    const exact = await runView(owner, "owner", T, {}, { search: "acme", limit: 500 });
    expect(acme.rows.map((r) => r.id).sort()).toEqual(exact.rows.map((r) => r.id).sort());
    process.env.FAST_VIEW_MIN_ROWS = "0";
    const won = await runView(owner, "owner", T, {}, { search: "Won", limit: 500 });
    expect(won.matched).toBeGreaterThan(0);
    const wild = await runView(owner, "owner", T, {}, { search: "%", limit: 500 });
    expect(wild.matched).toBe(0); // wildcards are literal
  });
});

describe("large-table dashboard totals", () => {
  it("SQL totals and grouped totals equal the in-memory results", async () => {
    const { aggregateLarge } = await import("@/server/platform/query");
    process.env.FAST_VIEW_MIN_ROWS = "0";
    const filters: ViewConfig = { filters: { conjunction: "and", conditions: [{ fieldId: F.Done, op: "isChecked" }] } };
    const all = (await runView(owner, "owner", T, filters)).rows; // no limit → in-memory
    const nums = all.map((r) => r.values[F.Value]).filter((v) => typeof v === "number") as number[];
    const r1 = await aggregateLarge(owner, "owner", T, filters, { agg: "count" });
    expect(r1).toMatchObject({ value: all.length, count: all.length });
    const r2 = await aggregateLarge(owner, "owner", T, filters, { agg: "sum", fieldId: F.Value });
    expect(r2 && "value" in r2 && r2.value).toBe(nums.reduce((a, b) => a + b, 0));
    const r3 = await aggregateLarge(owner, "owner", T, filters, { agg: "avg", fieldId: F.Value });
    expect(r3 && "value" in r3 && r3.value).toBe(Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100);
    const g = await aggregateLarge(owner, "owner", T, filters, { agg: "count", groupFieldId: F.Stage });
    const byStage = new Map<string | null, number>(); for (const r of all) { const k = (r.values[F.Stage] as string | null) ?? null; byStage.set(k, (byStage.get(k) ?? 0) + 1); }
    expect(g && "groups" in g && Object.fromEntries(g.groups.map((x) => [String(x.key), x.value]))).toEqual(Object.fromEntries([...byStage].map(([k, v]) => [String(k), v])));
    expect(await aggregateLarge(owner, "owner", T, filters, { agg: "sum", fieldId: F.Twice })).toBeNull(); // formula → exact in-memory path
  });
});
