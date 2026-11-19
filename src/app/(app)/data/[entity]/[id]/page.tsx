import { notFound } from "next/navigation";
import { getEntity } from "@/lib/entities";
import { requirePageContext } from "@/server/auth/request";
import { RecordDetail } from "@/components/record-detail";
import { RecordActions } from "@/components/record-actions";
import type { SP } from "@/components/entity-view";
import { getEntityRow } from "@/server/entities/crud";
import { listAttachments } from "@/server/services/attachments";

export default async function EntityRecordPage({ params, searchParams }: { params: Promise<{ entity: string; id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const { entity, id } = await params;
  if (!getEntity(entity)) notFound();
  const row = await getEntityRow(ctx, entity, id).catch(() => null);
  if (!row) notFound();
  const atts = entity === "contracts" ? (await listAttachments(ctx, entity, id)).map((a) => ({ id: a.id, filename: a.filename })) : [];
  return <RecordDetail ctx={ctx} entity={entity} id={id} sp={await searchParams} actions={<RecordActions entity={entity} row={row} role={ctx.role} attachments={atts} />} />;
}
