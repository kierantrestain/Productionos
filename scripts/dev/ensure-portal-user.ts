/** DEV/E2E ONLY: ensure the demo workspace has a portal client login (client-portal@demo.productionos.test). */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { memberships, organisations, users } from "@/db/schema";
import { createUserWithMembership } from "@/server/services/admin";
import { hashPassword } from "@/server/auth/password";

async function main() {
  if (/neon|vercel/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run against a hosted database.");
  const [org] = await db.select().from(organisations).where(eq(organisations.slug, "bang-on-demo"));
  if (!org) throw new Error("Demo workspace not found");
  const email = "client-portal@demo.productionos.test";
  const u = await createUserWithMembership({ orgId: org.id, email, name: "Demo Portal Client", role: "external_reviewer", platformRole: "portal" });
  await db.update(memberships).set({ platformRole: "portal" }).where(and(eq(memberships.userId, u.id), eq(memberships.orgId, org.id)));
  await db.update(users).set({ passwordHash: await hashPassword(process.env.DEMO_PASSWORD ?? "demo-password-local-only") }).where(eq(users.id, u.id));
  console.log("portal user ready");
  await closeDb();
}
main().catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
