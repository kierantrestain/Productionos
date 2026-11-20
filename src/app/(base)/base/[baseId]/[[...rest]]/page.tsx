import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { requirePageContext } from "@/server/auth/request";
import { loadBaseStructure, asLite } from "@/server/platform/schema";
import { runView } from "@/server/platform/query";
import { commentCounts } from "@/server/platform/records";
import { atLeast, fieldEditable, fieldVisible } from "@/server/platform/access";
import { aiConfigured } from "@/server/platform/ai";
import { BaseApp } from "@/components/platform/base-app";
import type { BaseData, ClientView, Role } from "@/components/platform/types";

export async function generateMetadata() { return { title: "Base · Bang On OS" }; }

export default async function BasePage({ params }: { params: Promise<{ baseId: string; rest?: string[] }> }) {
  const { baseId, rest = [] } = await params;
  const ctx = await requirePageContext();
  let st: Awaited<ReturnType<typeof loadBaseStructure>>;
  try { st = await loadBaseStructure(ctx, baseId); } catch { notFound(); }
  const role = st.access.role as Role;
  const base = st.access.base;
  if (!st.tables.length) return <div style={{ padding: 40 }}>This base has no tables.</div>;
  const [tableId, viewId] = rest;
  // Unknown or missing table/view ids render the defaults (no server redirect mid-stream); the client tidies the URL.
  const table = st.tables.find((t) => t.id === tableId) ?? st.tables[0];
  const tViews = st.views.filter((v) => v.tableId === table.id);
  const view = tViews.find((v) => v.id === viewId) ?? tViews[0];
  if (!view) return <div style={{ padding: 40 }}>No views are visible to you in this table.</div>;

  const result = await runView(ctx, role, table.id, view.config, { limit: 1000 });
  const counts = await commentCounts(ctx, result.rows.map((r) => r.id));
  const tFields = st.fields.filter((f) => f.tableId === table.id);
  const collabs = await db.select({ id: users.id, name: users.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, ctx.orgId), isNull(users.disabledAt))).orderBy(asc(users.name));
  const perms = (table.permissions ?? {}) as BaseData["table"]["permissions"];
  const toView = (v: (typeof tViews)[number]): ClientView => ({
    id: v.id, name: v.name, type: v.type, config: v.config, personal: !!v.ownerUserId, isLocked: v.isLocked, visibleTo: v.visibleTo, shareToken: v.shareToken,
    canEdit: v.ownerUserId ? v.ownerUserId === ctx.userId : !v.isLocked && atLeast(role, "creator"),
  });
  const data: BaseData = {
    base: { id: base.id, name: base.name, color: base.color ?? "blue", icon: base.icon ?? "grid", description: base.description ?? null },
    role, me: { id: ctx.userId, name: ctx.name },
    tables: st.tables.map((t) => ({ id: t.id, name: t.name })),
    table: { id: table.id, name: table.name, description: table.description ?? null, primaryFieldId: table.primaryFieldId, permissions: perms },
    allFields: tFields.filter((f) => fieldVisible(role, asLite(f))).map((f) => ({ ...asLite(f), tableId: f.tableId, editable: fieldEditable(role, asLite(f)), isPrimary: f.id === table.primaryFieldId })),
    views: tViews.map(toView), view: toView(view),
    rows: result.rows, total: result.total, matched: result.matched, commentCounts: counts,
    collaborators: collabs,
    baseFields: st.fields.filter((f) => fieldVisible(role, asLite(f))).map((f) => ({ id: f.id, name: f.name, type: f.type, tableId: f.tableId })),
    can: {
      create: atLeast(role, perms.create ?? "editor"), edit: atLeast(role, perms.edit ?? "editor"), delete: atLeast(role, perms.delete ?? "editor"),
      comment: atLeast(role, "commenter"), schema: atLeast(role, "creator"), collabViews: atLeast(role, "creator"),
    },
    aiConfigured: aiConfigured(),
  };
  return <BaseApp data={data} />;
}
