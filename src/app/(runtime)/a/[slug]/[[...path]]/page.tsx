import { notFound } from "next/navigation";
import { requirePageContext } from "@/server/auth/request";
import { canSee, findPage, listApps, resolveRuntime, visiblePages, type Runtime } from "@/server/apps/apps";
import { assertRecordInScope, componentData, type ComponentData } from "@/server/apps/data";
import { AppRuntimeShell } from "@/components/apps/shell";
import { PageGrid } from "@/components/apps/renderer";
import type { Page } from "@/lib/apps/types";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; return { title: slug.replace(/-/g, " ") }; }

export default async function AppRuntimePage({ params, searchParams }: { params: Promise<{ slug: string; path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug, path = [] } = await params;
  const sp = await searchParams;
  const preview = sp.preview === "1";
  const pageFilters = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k.startsWith("f_") && typeof v === "string").slice(0, 10).map(([k, v]) => [k.slice(2), String(v).slice(0, 200)]));
  const ctx = await requirePageContext();
  let rt: Runtime;
  try { rt = await resolveRuntime(ctx, slug, preview); } catch { notFound(); }
  const [pageSlug, recordId] = path;
  const page = findPage(rt, pageSlug) as Page | undefined;
  if (!page) notFound(); // a renamed/removed page: the not-found screen links back to the app
  if (page.kind === "detail") {
    if (!recordId) notFound();
    try { await assertRecordInScope({ ctx, rt, page }, page.tableId!, recordId); } catch { notFound(); }
  }
  const comps = page.components.filter((c) => canSee(rt.role, c.visibleTo));
  const data: Record<string, ComponentData> = {};
  await Promise.all(comps.map(async (c) => { data[c.id] = await componentData({ ctx, rt, page, recordId, pageFilters }, c); }));
  const myApps = (await listApps(ctx)).filter((a) => a.publishedVersionId).map((a) => ({ slug: a.slug, name: a.name }));
  const pages = visiblePages(rt);
  return (
    <AppRuntimeShell app={{ id: rt.app.id, name: rt.app.name, slug: rt.app.slug, description: rt.app.description, audience: rt.app.audience, baseId: rt.app.baseId }} version={rt.versionLabel} preview={preview} canBuild={rt.canBuild}
      nav={pages.filter((p) => p.kind !== "detail" && !p.hidden).map((p) => ({ id: p.id, title: p.title, slug: p.slug, icon: p.icon, parentId: p.parentId }))}
      currentPageId={page.id} user={{ name: ctx.name, role: rt.role }} apps={myApps}
      header={{ title: page.title, heading: page.heading, subtitle: page.subtitle }}>
      <PageGrid page={{ ...page, components: comps }} data={data} rc={{ slug, pageId: page.id, preview, recordId, role: rt.role, pages: pages.map((p) => ({ id: p.id, slug: p.slug, kind: p.kind, tableId: p.tableId })) }} />
    </AppRuntimeShell>
  );
}
