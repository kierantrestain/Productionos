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
  return NextResponse.json({ ok: true, stats, syncs });
}
export const GET = handle;
export const POST = handle;
