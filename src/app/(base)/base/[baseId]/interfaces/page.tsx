import { listInterfaces, type Widget } from "@/server/platform/interfaces";
import { listApps } from "@/server/apps/apps";
import type { AppConfig } from "@/lib/apps/types";
import { InterfacesApp } from "@/components/platform/interfaces-ui";
import { InterfacesHome } from "@/components/platform/interfaces-home";
import { loadBaseMeta } from "../load";

export const metadata = { title: "Interfaces · Bang On OS" };
export default async function InterfacesPage({ params, searchParams }: { params: Promise<{ baseId: string }>; searchParams: Promise<{ i?: string; new?: string; edit?: string }> }) {
  const { baseId } = await params; const { i, new: startNew, edit } = await searchParams;
  const { ctx, ...meta } = await loadBaseMeta(baseId);
  const [list, all] = await Promise.all([listInterfaces(ctx, baseId), listApps(ctx)]);
  const apps = all.filter((a) => a.baseId === baseId).map((a) => ({ id: a.id, name: a.name, slug: a.slug, published: !!a.publishedVersionId, pages: ((a.draft as unknown as AppConfig)?.pages ?? []).filter((p) => !p.hidden).length, description: a.description, updatedAt: a.updatedAt.toISOString() }));
  const dashboards = list.map((x) => ({ id: x.id, name: x.name }));
  if (i && list.some((x) => x.id === i)) return <InterfacesApp key={i} meta={meta} activeId={i} startEditing={edit === "1"} apps={apps} interfaces={list.map((x) => ({ id: x.id, name: x.name, widgets: x.widgets as unknown as Widget[] }))} />;
  return <InterfacesHome meta={meta} apps={apps} dashboards={dashboards} startNew={startNew === "1"} />;
}
