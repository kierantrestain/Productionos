/** First-run setup guard, demo workspace ownership, and the PostgreSQL storage driver. */
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db";
import { firstRunSetup, myOrganisations, needsSetup } from "@/server/services/admin";
import { seedDemo } from "@/server/services/demo";
import { contextForUser } from "@/server/auth/sessions";
import { listEntity } from "@/server/entities/crud";
import { DbStorage } from "@/server/storage";
import { makeOrg, makeUser } from "../support/factory";

afterAll(async () => { await closeDb(); });

describe("first-run setup", () => {
  it("treats a never-used install as unfinished, and locks once anyone signs in", async () => {
    const { createSession } = await import("@/server/auth/sessions");
    const org = await makeOrg("Setup");
    const u = await makeUser(org.id, "org_admin");
    // Users exist but nobody has signed in and no org completed setup → recoverable first run.
    expect(await needsSetup()).toBe(true);
    await createSession(u.userId, org.id); // first real sign-in
    expect(await needsSetup()).toBe(false);
    await expect(firstRunSetup({ orgName: "Second", name: "X", email: "x@example.test", password: "long-enough-pass" })).rejects.toThrow(/already been completed/);
  });

  it("can attach an existing owner as admin of the flagged demo workspace", async () => {
    const org = await makeOrg("Owner org");
    const owner = await makeUser(org.id, "org_admin");
    const r = await seedDemo({ ownerUserId: owner.userId, reset: true });
    expect(r.created).toBe(true);
    const orgs = await myOrganisations(owner.userId);
    const demo = orgs.find((o) => o.isDemo)!;
    expect(demo).toBeTruthy();
    const ctx = (await contextForUser(owner.userId, demo.id))!;
    expect(ctx.role).toBe("org_admin");
    expect((await listEntity(ctx, "productions")).total).toBe(4);
    expect((await listEntity(ctx, "scenes", { pageSize: 1 })).total).toBe(112);
  });
});

describe("db storage driver", () => {
  it("round-trips bytes through PostgreSQL", async () => {
    const s = new DbStorage();
    await s.put("t/db-driver-test", Buffer.from("hello production"), "text/plain");
    expect((await s.get("t/db-driver-test")).toString()).toBe("hello production");
    await expect(s.get("t/missing")).rejects.toThrow(/not found/);
  });
});

describe("demo role logins", () => {
  it("only resets fictional demo-only accounts, and those logins then work", async () => {
    const { resetDemoRoleLogins } = await import("@/server/services/admin");
    const { authenticate } = await import("@/server/auth/sessions");
    const { DEMO_SLUG } = await import("@/server/services/demo");
    const { db } = await import("@/db");
    const { organisations } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { createOrganisation } = await import("@/server/services/admin");
    const realOrg = await createOrganisation({ name: "Real org", slug: `real-${Date.now()}`, isDemo: false });
    const owner = await makeUser(realOrg.id, "org_admin");
    await expect(resetDemoRoleLogins(owner)).rejects.toThrow(/only available in the demo/);
    await seedDemo({ ownerUserId: owner.userId, reset: true });
    const [demo] = await db.select().from(organisations).where(eq(organisations.slug, DEMO_SLUG));
    const ctx = (await contextForUser(owner.userId, demo.id))!;
    const r = await resetDemoRoleLogins(ctx);
    expect(r.accounts.map((a) => a.role)).toEqual(expect.arrayContaining(["producer", "crew", "cast", "external_reviewer"]));
    expect(r.accounts.some((a) => a.email === owner.email)).toBe(false);
    expect(await authenticate("producer@demo.productionos.test", r.password)).toBeTruthy();
    expect(await authenticate(owner.email, r.password)).toBeNull();
  });

  it("rebuilds an interrupted (incomplete) demo instead of leaving it half-made", async () => {
    const { DEMO_SLUG } = await import("@/server/services/demo");
    const { db } = await import("@/db");
    const { organisations } = await import("@/db/schema");
    const { eq, sql } = await import("drizzle-orm");
    const org = await makeOrg("Owner2");
    const owner = await makeUser(org.id, "org_admin");
    await seedDemo({ ownerUserId: owner.userId, reset: true });
    await db.update(organisations).set({ settings: sql`${organisations.settings} - 'seedComplete'` }).where(eq(organisations.slug, DEMO_SLUG));
    const again = await seedDemo({ ownerUserId: owner.userId });
    expect(again.created).toBe(true);
    const [demo] = await db.select().from(organisations).where(eq(organisations.slug, DEMO_SLUG));
    expect((demo.settings as { seedComplete?: boolean }).seedComplete).toBe(true);
  });
});
