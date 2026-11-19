import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { savedViews } from "@/db/schema";
import { getEntity } from "@/lib/entities";
import { canRead, canWrite } from "@/lib/permissions";
import type { Ctx } from "@/server/auth/context";
import { listEntity } from "@/server/entities/crud";
import { EntityTable, type TableState } from "./entity-table";
import { Forbidden } from "./ui";
import { customValuesFor, listFieldDefs } from "@/server/services/customise";

export type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseState(sp: SP): TableState {
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (k.startsWith("f_") && one(v)) filters[k.slice(2)] = one(v)!;
  return { q: one(sp.q), sort: one(sp.sort), dir: one(sp.dir) === "desc" ? "desc" : "asc", filters, archived: one(sp.archived) === "1", page: Math.max(1, Number(one(sp.page)) || 1), pageSize: 200 };
}

/** Server component: scoped, permission-checked list rendered as an editable grid. */
export async function EntityView({ ctx, entity, sp, fixed = {}, columns, title, hideCreate, emptyHint, recordBase, readOnly }: {
  ctx: Ctx; entity: string; sp: SP; fixed?: Record<string, string>; columns?: string[]; title?: string; hideCreate?: boolean; emptyHint?: string; recordBase?: string; readOnly?: boolean;
}) {
  const d = getEntity(entity)!;
  if (!canRead(ctx.role, d.readDomain ?? d.domain)) return <div className="panel"><Forbidden what={d.plural.toLowerCase()} /></div>;
  const state = parseState(sp);
  const defs = await listFieldDefs(ctx, entity);
  const customFilters = Object.entries(state.filters).filter(([k]) => k.startsWith("cf.")).map(([k, v]) => ({ fieldId: defs.find((x) => `cf.${x.key}` === k)?.id ?? "", value: v })).filter((x) => x.fieldId);
  const plainFilters = Object.fromEntries(Object.entries(state.filters).filter(([k]) => !k.startsWith("cf.")));
  const res = await listEntity(ctx, entity, { q: state.q, sort: state.sort, dir: state.dir, filters: { ...plainFilters, ...fixed }, customFilters, archived: state.archived, page: state.page, pageSize: state.pageSize });
  const customValues = defs.length ? await customValuesFor(ctx, entity, res.rows.map((r) => r.id)) : {};
  const views = await db.select().from(savedViews).where(and(eq(savedViews.orgId, ctx.orgId), eq(savedViews.entity, entity), or(eq(savedViews.userId, ctx.userId), eq(savedViews.shared, true))));
  return (
    <EntityTable entity={entity} rows={res.rows} refs={res.refs} total={res.total} state={state} canWrite={!readOnly && canWrite(ctx.role, d.domain, d.key)} fixed={fixed}
      columns={columns} redacted={res.redacted} customValues={customValues} title={title} hideCreate={hideCreate} emptyHint={emptyHint} recordBase={recordBase}
      savedViews={views.map((v) => ({ id: v.id, name: v.name, config: v.config as Record<string, unknown>, mine: v.userId === ctx.userId }))} />
  );
}
