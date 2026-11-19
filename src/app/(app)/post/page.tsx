import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, people, postTasks, productions } from "@/db/schema";
import { requirePageContext } from "@/server/auth/request";
import { Workspace } from "@/components/workspace";
import { PostBoard } from "@/components/business-client";
import type { SP } from "@/components/entity-view";
import { canRead, canWrite } from "@/lib/permissions";
import { productionAllowed } from "@/server/entities/crud";

export const metadata = { title: "Post & delivery" };
export default async function PostPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const board = async () => {
    const prods = (await db.select({ id: productions.id, title: productions.title }).from(productions).where(and(eq(productions.orgId, ctx.orgId), isNull(productions.archivedAt)))).filter((p) => productionAllowed(ctx, p.id) && (!sp.production || p.id === sp.production));
    if (!prods.length) return <div className="panel"><div className="empty">No productions.</div></div>;
    const rows = await db.select({ t: postTasks, ep: episodes, person: people.fullName }).from(postTasks).leftJoin(episodes, eq(episodes.id, postTasks.episodeId)).leftJoin(people, eq(people.id, postTasks.assigneePersonId))
      .where(and(inArray(postTasks.productionId, prods.map((p) => p.id)), isNull(postTasks.archivedAt))).orderBy(asc(postTasks.dueDate));
    const title = new Map(prods.map((p) => [p.id, p.title]));
    return <PostBoard canWrite={canWrite(ctx.role, "post")} tasks={rows.map(({ t, ep, person }) => ({ id: t.id, version: t.version, title: t.title, kind: t.kind, status: t.status, dueDate: t.dueDate, assignee: person, episode: ep ? (ep.number != null ? `Ep ${ep.number}` : ep.title) : null, productionId: t.productionId, production: title.get(t.productionId) ?? "" }))} />;
  };
  return <Workspace ctx={ctx} sp={sp} base="/post" title="Post-production & delivery"
    lede="Ingest, edit, sound, graphics and QC tasks; versioned cuts with timecoded review; deliverables gated by rights clearance and sign-off."
    tabs={[
      ...(canRead(ctx.role, "post") ? [{ key: "board", label: "Board", render: board }] : []),
      { key: "tasks", label: "Tasks", entity: "post_tasks" },
      { key: "cuts", label: "Cuts & review", entity: "edit_versions" },
      { key: "comments", label: "Review comments", entity: "review_comments" },
      { key: "deliverables", label: "Deliverables", entity: "deliverables" },
      { key: "media", label: "Media & ingest", entity: "media_assets" },
      { key: "releases", label: "Release calendar", entity: "releases" },
    ]} />;
}
