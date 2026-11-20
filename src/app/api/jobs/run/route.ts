import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { drainOutbox } from "@/server/workflows/engine";

export const maxDuration = 60;

/** Background job runner (Vercel Cron / external scheduler). Requires Bearer JOB_SECRET or CRON_SECRET. */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET || process.env.JOB_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const stats = await drainOutbox({ budgetMs: 40_000 });
  const { runDueSyncs } = await import("@/server/platform/sync");
  const syncs = await runDueSyncs().catch((e) => ({ error: String(e) }));
  const { runScheduledAutomations } = await import("@/server/platform/automations");
  const scheduled = await runScheduledAutomations().catch((e) => ({ error: String(e) }));
  const { runDueWaits } = await import("@/server/platform/automations");
  const waits = await runDueWaits().catch((e) => ({ error: String(e) }));
  const after = await drainOutbox({ budgetMs: 8_000 });
  return NextResponse.json({ ok: true, stats, syncs, scheduled, waits, after });
}
export const GET = handle;
export const POST = handle;
