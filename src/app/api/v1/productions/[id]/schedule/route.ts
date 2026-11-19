import { NextResponse } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { scenes, scheduleBlocks, shootDays } from "@/db/schema";
import { apiContext } from "@/server/integrations/api-auth";
import { loadProduction } from "@/server/services/guards";

/** GET /api/v1/productions/:id/schedule — scope schedule:read. No personal data. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await apiContext(req, "schedule:read");
  if (a instanceof NextResponse) return a;
  const { id } = await params;
  if (!(await loadProduction(a.ctx, id).catch(() => null))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const days = await db.select().from(shootDays).where(and(eq(shootDays.productionId, id), isNull(shootDays.archivedAt))).orderBy(asc(shootDays.date));
  const blocks = await db.select({ b: scheduleBlocks, s: scenes }).from(scheduleBlocks).leftJoin(scenes, eq(scenes.id, scheduleBlocks.sceneId)).where(and(eq(scheduleBlocks.productionId, id), isNull(scheduleBlocks.archivedAt))).orderBy(asc(scheduleBlocks.sortOrder));
  return NextResponse.json({ version: 1, data: days.map((d) => ({ id: d.id, date: d.date, dayNumber: d.dayNumber, unit: d.unit, status: d.status, generalCall: d.generalCall,
    blocks: blocks.filter((x) => x.b.shootDayId === d.id).map(({ b, s }) => ({ kind: b.kind, start: b.startTime, end: b.endTime, sceneId: b.sceneId, sceneNumber: s?.number ?? null, title: s?.title ?? b.label })) })) });
}
