import { notFound } from "next/navigation";
import { getEntity } from "@/lib/entities";
import { requirePageContext } from "@/server/auth/request";
import { EntityView, type SP } from "@/components/entity-view";
import { PageHeader } from "@/components/ui";

export default async function EntityListPage({ params, searchParams }: { params: Promise<{ entity: string }>; searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const { entity } = await params;
  const d = getEntity(entity);
  if (!d) notFound();
  return (<><PageHeader title={d.plural} lede={d.description} /><EntityView ctx={ctx} entity={entity} sp={await searchParams} /></>);
}
