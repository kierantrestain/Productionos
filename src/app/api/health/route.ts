import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { storageStatus } from "@/server/storage";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const [r] = (await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)) as unknown as { n: number }[];
    return NextResponse.json({ ok: true, db: "up", migrations: r?.n ?? null, storage: storageStatus().provider });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
