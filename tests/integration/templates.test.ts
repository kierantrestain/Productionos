/** Production templates: every built-in builds cleanly; counts, dates and terminology; save-as-template round trip. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { budgetLines, deliverables, episodes, postTasks, productions, scenes, tasks } from "@/db/schema";
import { BLUEPRINTS } from "@/lib/templates";
import { createFromTemplate, listTemplates, saveAsTemplate } from "@/server/services/templates";
import { makeOrg, makeUser, refresh } from "../support/factory";
import type { Ctx } from "@/server/auth/context";

let producer: Ctx, crew: Ctx;
const count = async (t: typeof scenes | typeof episodes | typeof deliverables | typeof postTasks | typeof tasks, pid: string) =>
  (await db.select({ id: t.id }).from(t).where(and(eq(t.productionId, pid), isNull(t.archivedAt)))).length;

beforeAll(async () => {
  const org = await makeOrg("Templates");
  producer = await makeUser(org.id, "producer");
  crew = await makeUser(org.id, "crew");
});
afterAll(async () => { await closeDb(); });

describe("production templates", () => {
  it("builds every built-in production type without errors", async () => {
    for (const b of BLUEPRINTS) {
      const r = await createFromTemplate(producer, { template: b.key, title: `T ${b.key}`, units: b.usesEpisodes ? 2 : 0, startDate: "2028-03-01", endDate: "2028-06-01" });
      producer = await refresh(producer);
      expect(r.counts.units).toBe(b.usesEpisodes ? 2 : 0);
      expect(await count(scenes, r.productionId)).toBe(b.runningOrder.length * (b.usesEpisodes ? 2 : 1));
    }
  });

  it("creates the right structure, dates and terminology for a gameshow series", async () => {
    const r = await createFromTemplate(producer, { template: "gameshow", title: "Quiz S2", units: 10, seasonNumber: 2, startDate: "2028-03-01", endDate: "2028-05-30", terms: { item: "Game", items: "Games" } });
    producer = await refresh(producer);
    const pid = r.productionId;
    expect(await count(episodes, pid)).toBe(10);
    expect(await count(scenes, pid)).toBe(60);
    expect(await count(deliverables, pid)).toBe(30); // 3 per-episode deliverables × 10
    expect(await count(postTasks, pid)).toBe(40);
    const [p] = await db.select().from(productions).where(eq(productions.id, pid));
    expect(p.settings.terms?.item).toBe("Game");
    expect(p.settings.terms?.units).toBe("Episodes");
    const vetting = (await db.select().from(tasks).where(eq(tasks.productionId, pid))).find((t) => t.title.startsWith("Contestant casting"));
    expect(vetting?.dueDate).toBe("2028-02-02"); // 28 days before start
    const lines = await db.select().from(budgetLines).where(eq(budgetLines.productionId, pid));
    expect(lines.every((l) => l.estimateMinor === 0)).toBe(true); // structure only, no invented figures
  });

  it("standalone productions attach items directly, and options can be switched off", async () => {
    const r = await createFromTemplate(producer, { template: "commercial", title: "Spot", include: { budget: false, tasks: false } });
    producer = await refresh(producer);
    const items = await db.select().from(scenes).where(eq(scenes.productionId, r.productionId));
    expect(items.length).toBe(3);
    expect(items.every((s) => s.episodeId === null)).toBe(true);
    expect(r.counts.budgetLines).toBe(0);
    expect(r.counts.tasks).toBe(0);
  });

  it("rejects bad input and unauthorised roles", async () => {
    await expect(createFromTemplate(crew, { template: "gameshow", title: "X" })).rejects.toThrow(/permission/);
    await expect(createFromTemplate(producer, { template: "nope", title: "X" })).rejects.toThrow(/not found/i);
    await expect(createFromTemplate(producer, { template: "feature_film", title: "X", startDate: "2028-05-01", endDate: "2028-01-01" })).rejects.toThrow(/End date/);
  });

  it("saves a production as an organisation template and rebuilds the same structure", async () => {
    const src = await createFromTemplate(producer, { template: "panel_show", title: "Panel S1", units: 3, terms: { item: "Bit", items: "Bits" } });
    producer = await refresh(producer);
    const t = await saveAsTemplate(producer, src.productionId, "Our panel format");
    expect((await listTemplates(producer)).some((x) => x.id === `org:${t.id}` && x.source === "organisation")).toBe(true);
    const copy = await createFromTemplate(producer, { template: `org:${t.id}`, title: "Panel S2" });
    producer = await refresh(producer);
    expect(await count(episodes, copy.productionId)).toBe(3);
    expect(await count(scenes, copy.productionId)).toBe(await count(scenes, src.productionId));
    const [p] = await db.select().from(productions).where(eq(productions.id, copy.productionId));
    expect(p.settings.terms?.item).toBe("Bit");
  });
});
