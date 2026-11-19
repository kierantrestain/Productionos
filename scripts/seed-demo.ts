/**
 * DEMO SEED CLI — creates the clearly flagged demo organisation (see src/server/services/demo.ts).
 *   DEMO_PASSWORD=... pnpm db:seed:demo [--reset]
 */
import "dotenv/config";
import { closeDb } from "../src/db";
import { DEMO_DOMAIN, seedDemo } from "../src/server/services/demo";

async function main() {
  const r = await seedDemo({ password: process.env.DEMO_PASSWORD, reset: process.argv.includes("--reset") });
  if (!r.created) { console.log("Demo organisation already exists. Use --reset to recreate."); return; }
  console.log(`Demo organisation created (is_demo = true). Accounts: <role>@${DEMO_DOMAIN}`);
  console.log(process.env.DEMO_PASSWORD ? "Password: value of DEMO_PASSWORD" : `Generated password (shown once): ${r.password}`);
}
main().then(closeDb).catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
