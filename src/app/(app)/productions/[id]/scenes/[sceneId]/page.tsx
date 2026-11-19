import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { scenes, shots, scheduleBlocks, shootDays } from "@/db/schema";
import { requirePageContext } from "@/server/auth/request";
import { getEntityRow, refLabel } from "@/server/entities/crud";
import { sceneLinks } from "@/server/services/production-ops";
import { loadProduction } from "@/server/services/guards";
import { RecordForm } from "@/components/record-form";
import { SceneLinks, ShotListEditor } from "@/components/scene-editors";
import { ActivityPanel, AttachmentsPanel } from "@/components/record-panels";
import { activity, listAttachments } from "@/server/services/attachments";
import { Badge, PageHeader } from "@/components/ui";
import { canWrite } from "@/lib/permissions";
import { getEntity } from "@/lib/entities";
import { date, humanize } from "@/lib/format";

export default async function ScenePage({ params }: { params: Promise<{ id: string; sceneId: string }> }) {
  const ctx = await requirePageContext();
  const { id, sceneId } = await params;
  const p = await loadProduction(ctx, id).catch(() => null);
  const scene = p ? await getEntityRow(ctx, "scenes", sceneId).catch(() => null) : null;
  if (!p || !scene || scene.productionId !== id) notFound();
  const [links, shotRows, siblings, atts, acts, days] = await Promise.all([
    sceneLinks(ctx, sceneId),
    db.select().from(shots).where(and(eq(shots.sceneId, sceneId), isNull(shots.archivedAt))).orderBy(asc(shots.sortOrder), asc(shots.number)),
    db.select({ id: scenes.id, number: scenes.number, sortOrder: scenes.sortOrder }).from(scenes).where(and(eq(scenes.productionId, id), scene.episodeId ? eq(scenes.episodeId, String(scene.episodeId)) : isNull(scenes.episodeId), isNull(scenes.archivedAt))).orderBy(asc(scenes.sortOrder), asc(scenes.number)),
    listAttachments(ctx, "scenes", sceneId), activity(ctx, "scenes", sceneId),
    db.select({ id: shootDays.id, date: shootDays.date, start: scheduleBlocks.startTime }).from(scheduleBlocks).innerJoin(shootDays, eq(shootDays.id, scheduleBlocks.shootDayId)).where(and(eq(scheduleBlocks.sceneId, sceneId), isNull(scheduleBlocks.archivedAt))),
  ]);
  const idx = siblings.findIndex((s) => s.id === sceneId);
  const prev = siblings[idx - 1], next = siblings[idx + 1];
  const writable = canWrite(ctx.role, "production");
  const ep = scene.episodeId ? await getEntityRow(ctx, "episodes", String(scene.episodeId)).catch(() => null) : null;
  return (
    <>
      <PageHeader
        eyebrow={<><Link href={`/productions/${id}`}>{p.title}</Link> / {ep ? <Link href={`/productions/${id}?tab=scenes&f_episodeId=${ep.id}`}>{refLabel(getEntity("episodes")!, ep)}</Link> : "Standalone"} / {humanize(String(scene.kind))}</>}
        title={<span className="row" style={{ gap: 10 }}><span className="mono" style={{ fontSize: 20 }}>{String(scene.number)}</span> {String(scene.title)} <Badge value={String(scene.status)} /></span>}
        lede={[scene.intExt, scene.dayNight, scene.estDurationMins ? `${scene.estDurationMins} min` : null].filter(Boolean).join(" · ") || undefined}
        actions={<>
          {days.map((d) => <Link key={d.id} className="btn btn-sm" href={`/schedule/day/${d.id}`}>Scheduled {date(d.date, { short: true })}</Link>)}
          {prev && <Link className="btn" href={`/productions/${id}/scenes/${prev.id}`} aria-label="Previous scene">← {prev.number}</Link>}
          {next && <Link className="btn" href={`/productions/${id}/scenes/${next.id}`} aria-label="Next scene">{next.number} →</Link>}
        </>} />
      <div className="grid-2">
        <div className="stack">
          <ShotListEditor sceneId={sceneId} productionId={id} shots={shotRows.map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(), archivedAt: null })) as never} canWrite={canWrite(ctx.role, "production", "shots")} />
          <section className="panel" aria-label="Breakdown"><div className="panel-head"><h2>Breakdown</h2><span className="subtle" style={{ fontSize: 12 }}>v{scene.version}</span></div>
            <div className="panel-body"><RecordForm entity="scenes" initial={scene} fixed={{ productionId: id }} canWrite={writable} /></div></section>
        </div>
        <div className="stack">
          <SceneLinks sceneId={sceneId} people={links.people} resources={links.resources} canWrite={writable} canWriteResources={canWrite(ctx.role, "production", "scene_resources")} />
          <AttachmentsPanel entity="scenes" id={sceneId} items={atts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))} canWrite={writable} />
          <ActivityPanel items={acts} />
        </div>
      </div>
    </>
  );
}
