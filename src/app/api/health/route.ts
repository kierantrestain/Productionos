import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { storageStatus } from "@/server/storage";

export const dynamic = "force-dynamic";
/** Liveness + migration count. `?timing=1` adds the server→database round trip (ms) for diagnosing slowness. */
export async function GET(req: Request) {
  try {
    const t0 = performance.now();
    const [r] = (await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)) as unknown as { n: number }[];
    const first = performance.now() - t0;
    let rtt: number[] | undefined;
    if (new URL(req.url).searchParams.get("timing") === "1") {
      rtt = [];
      for (let i = 0; i < 3; i++) { const t = performance.now(); await db.execute(sql`select 1`); rtt.push(Math.round(performance.now() - t)); }
    }
    return NextResponse.json({ ok: true, db: "up", migrations: r?.n ?? null, storage: storageStatus().provider, ...(rtt ? { dbFirstMs: Math.round(first), dbRoundTripMs: rtt, region: process.env.VERCEL_REGION ?? null } : {}) });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
