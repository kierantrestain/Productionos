import { NextResponse } from "next/server";
import { apiContext } from "@/server/integrations/api-auth";
import { listEntity } from "@/server/entities/crud";

/** GET /api/v1/productions — scope productions:read. Contract version 1. */
export async function GET(req: Request) {
  const a = await apiContext(req, "productions:read");
  if (a instanceof NextResponse) return a;
  const r = await listEntity(a.ctx, "productions", { pageSize: 500 });
  return NextResponse.json({ version: 1, data: r.rows.map((p) => ({ id: p.id, title: p.title, code: p.code, kind: p.kind, status: p.status, startDate: p.startDate, endDate: p.endDate, usesEpisodes: p.usesEpisodes })) });
}
