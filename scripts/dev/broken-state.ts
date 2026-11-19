// DEV ONLY — recreate the state left by an interrupted first-run setup: account + org exist, never signed in, no setupComplete flag.
import { closeDb } from "../../src/db";
import { createOrganisation, createUserWithMembership, needsSetup } from "../../src/server/services/admin";
(async () => {
  const org = await createOrganisation({ name: "Half-made Org", slug: "half-made" });
  await createUserWithMembership({ orgId: org.id, email: "owner@bangon.test", name: "Owner", password: "the-password-user-typed", role: "org_admin" });
  console.log("needsSetup after interrupted run:", await needsSetup());
  await closeDb();
})();
