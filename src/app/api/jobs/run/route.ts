import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processOutbox } from "@/server/workflows/engine";

/** Background job runner (Vercel Cron / external scheduler). Requires Bearer JOB_SECRET or CRON_SECRET. */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET || process.env.JOB_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const stats = await processOutbox({ limit: 200 });
  return NextResponse.json({ ok: true, stats });
}
export const GET = handle;
export const POST = handle;
