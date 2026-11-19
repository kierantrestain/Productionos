import "dotenv/config";
import { closeDb } from "../src/db";
import { processOutbox } from "../src/server/workflows/engine";
/** Local/cron worker: drain the outbox once (or loop with --watch). */
async function main() {
  do {
    const s = await processOutbox({ limit: 200 });
    console.log(new Date().toISOString(), s);
    if (process.argv.includes("--watch")) await new Promise((r) => setTimeout(r, 10_000));
  } while (process.argv.includes("--watch"));
}
main().then(closeDb).catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
