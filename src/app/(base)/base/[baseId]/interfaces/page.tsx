import { listInterfaces, type Widget } from "@/server/platform/interfaces";
import { InterfacesApp } from "@/components/platform/interfaces-ui";
import { loadBaseMeta } from "../load";

export const metadata = { title: "Interfaces · Bang On OS" };
export default async function InterfacesPage({ params, searchParams }: { params: Promise<{ baseId: string }>; searchParams: Promise<{ i?: string }> }) {
  const { baseId } = await params; const { i } = await searchParams;
  const { ctx, ...meta } = await loadBaseMeta(baseId);
  const list = await listInterfaces(ctx, baseId);
  return <InterfacesApp key={i ?? "first"} meta={meta} activeId={i} interfaces={list.map((x) => ({ id: x.id, name: x.name, widgets: x.widgets as unknown as Widget[] }))} />;
}
