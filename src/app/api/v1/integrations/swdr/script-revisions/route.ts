import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { episodes, scenes } from "@/db/schema";
import { apiContext } from "@/server/integrations/api-auth";
import { loadProduction } from "@/server/services/guards";
import { audit, emit } from "@/server/audit";

const Body = z.object({
  productionId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  revisionRef: z.string().min(1).max(200),
  approved: z.literal(true, { message: "Only approved/locked SWDR revisions are accepted" }),
  scenes: z.array(z.object({ number: z.string().min(1).max(20), heading: z.string().min(1).max(500), intExt: z.string().max(20).optional(), dayNight: z.string().max(20).optional(), pageEighths: z.number().int().min(0).max(1000).optional(), summary: z.string().max(5000).optional() })).max(1000),
});

/**
 * POST /api/v1/integrations/swdr/script-revisions — scope scripts:write.
 * Conflict policy: never overwrites existing breakdown content. Existing scenes (matched by number)
 * get the pinned revision ref; missing scenes are created as drafts. Idempotent per revisionRef.
 */
export async function POST(req: Request) {
  const a = await apiContext(req, "scripts:write");
  if (a instanceof NextResponse) return a;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;
  const prod = await loadProduction(a.ctx, b.productionId).catch(() => null);
  if (!prod) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (b.episodeId) {
    const [ep] = await db.select().from(episodes).where(and(eq(episodes.id, b.episodeId), eq(episodes.productionId, prod.id))).limit(1);
    if (!ep) return NextResponse.json({ error: "episode not in production" }, { status: 400 });
  }
  const result = await db.transaction(async (tx) => {
    let linked = 0, created = 0;
    for (const s of b.scenes) {
      const [existing] = await tx.select().from(scenes).where(and(eq(scenes.productionId, prod.id), b.episodeId ? eq(scenes.episodeId, b.episodeId) : isNull(scenes.episodeId), eq(scenes.number, s.number), isNull(scenes.archivedAt))).limit(1);
      if (existing) { await tx.update(scenes).set({ scriptRevisionRef: b.revisionRef, updatedAt: new Date(), version: sql`${scenes.version} + 1` }).where(eq(scenes.id, existing.id)); linked++; }
      else { await tx.insert(scenes).values({ orgId: a.ctx.orgId, productionId: prod.id, episodeId: b.episodeId ?? null, number: s.number, title: s.heading, intExt: s.intExt ?? null, dayNight: s.dayNight ?? null, pageEighths: s.pageEighths ?? null, description: s.summary ?? null, scriptRevisionRef: b.revisionRef, status: "draft" }); created++; }
    }
    await audit(tx, a.ctx, "swdr_revision_import", "productions", prod.id, { productionId: prod.id, meta: { revisionRef: b.revisionRef, linked, created, token: a.tokenName } });
    await emit(tx, { orgId: a.ctx.orgId, type: "swdr.revision_received", entityType: "productions", entityId: prod.id, productionId: prod.id, idempotencyKey: `swdr:${prod.id}:${b.revisionRef}`, origin: "api" });
    return { linked, created };
  });
  return NextResponse.json({ version: 1, data: { revisionRef: b.revisionRef, ...result } });
}
