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
  it("refuses to run once any user exists", async () => {
    const org = await makeOrg("Setup");
    await makeUser(org.id, "org_admin");
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
