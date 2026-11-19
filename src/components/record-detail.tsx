import Link from "next/link";
import { getEntity } from "@/lib/entities";
import { canRead, canWrite } from "@/lib/permissions";
import type { Ctx } from "@/server/auth/context";
import { getEntityRow, redact, refLabel } from "@/server/entities/crud";
import { activity, listAttachments, listComments } from "@/server/services/attachments";
import { customValuesFor } from "@/server/services/customise";
import { EntityView, type SP } from "./entity-view";
import { RecordForm } from "./record-form";
import { ActivityPanel, AttachmentsPanel, CommentsPanel } from "./record-panels";
import { Badge, PageHeader } from "./ui";
import type { ReactNode } from "react";

/** Full record page: editable form, related records, documents, comments and audit trail. */
export async function RecordDetail({ ctx, entity, id, eyebrow, actions, aside, below, bare }: { ctx: Ctx; entity: string; id: string; sp?: SP; eyebrow?: ReactNode; actions?: ReactNode; aside?: ReactNode; below?: ReactNode; bare?: boolean }) {
  const d = getEntity(entity)!;
  const row = await getEntityRow(ctx, entity, id);
  const writable = canWrite(ctx.role, d.domain, d.key);
  const [atts, comms, acts, cv] = await Promise.all([listAttachments(ctx, entity, id), listComments(ctx, entity, id), activity(ctx, entity, id), customValuesFor(ctx, entity, [id])]);
  const { redacted } = redact(ctx, d, { ...row });
  const status = (row.status ?? row.stage) as string | undefined;
  const childTabs = (d.children ?? []).filter((c) => { const cd = getEntity(c.entity); return cd && canRead(ctx.role, cd.readDomain ?? cd.domain); });
  return (
    <div>
      {bare ? (actions && <div className="actions" style={{ marginBottom: 16 }}>{actions}</div>) : <PageHeader title={<span className="row" style={{ gap: 10 }}>{refLabel(d, row)} {status && <Badge value={status} />}</span>}
        eyebrow={eyebrow ?? <><Link href={`/data/${entity}`}>{d.plural}</Link></>} lede={d.description} actions={actions} />}
      <div className="grid-2">
        <div className="stack">
          <section className="panel" aria-label="Details">
            <div className="panel-head"><h2>Details</h2><span className="subtle" style={{ fontSize: 12 }}>v{row.version} · updated {new Date(String(row.updatedAt)).toLocaleString("en-GB")}</span></div>
            <div className="panel-body"><RecordForm entity={entity} initial={row} redacted={redacted} canWrite={writable} customInitial={cv[id] ?? {}} /></div>
          </section>
          {below}
          {childTabs.map((c) => {
            const fixed: Record<string, string> = { [c.foreignKey]: id };
            const cd = getEntity(c.entity)!;
            if (row.productionId && cd.scope !== "org" && c.foreignKey !== "productionId") fixed.productionId = String(row.productionId);
            if (entity === "productions") fixed.productionId = id;
            return <section key={c.entity} className="panel" aria-label={c.label}><div className="panel-body"><EntityView ctx={ctx} entity={c.entity} sp={{}} fixed={fixed} title={c.label} /></div></section>;
          })}
        </div>
        <div className="stack">
          {aside}
          <AttachmentsPanel entity={entity} id={id} items={atts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))} canWrite={writable || (d.domain === "review" && ctx.role === "external_reviewer")} />
          <CommentsPanel entity={entity} id={id} items={comms.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))} canComment={ctx.role !== "cast"} />
          <ActivityPanel items={acts} />
        </div>
      </div>
    </div>
  );
}
