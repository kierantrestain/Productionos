import { notFound } from "next/navigation";
import { requirePageContext } from "@/server/auth/request";
import { asLite, loadBaseStructure } from "@/server/platform/schema";
import { atLeast, fieldVisible } from "@/server/platform/access";

/** Shared loader for base sub-pages: base meta, role, tables, visible fields, views. */
export async function loadBaseMeta(baseId: string) {
  const ctx = await requirePageContext();
  let st: Awaited<ReturnType<typeof loadBaseStructure>>;
  try { st = await loadBaseStructure(ctx, baseId); } catch { notFound(); }
  const role = st.access.role;
  const b = st.access.base;
  return {
    ctx, role, canEdit: atLeast(role, "creator"),
    base: { id: b.id, name: b.name, color: b.color, icon: b.icon },
    tables: st.tables.map((t) => ({ id: t.id, name: t.name, primaryFieldId: t.primaryFieldId })),
    fields: st.fields.filter((f) => fieldVisible(role, asLite(f))).map((f) => ({ ...asLite(f), tableId: f.tableId })),
    views: st.views.map((v) => ({ id: v.id, name: v.name, tableId: v.tableId, type: v.type })),
  };
}
export type BaseMeta = Omit<Awaited<ReturnType<typeof loadBaseMeta>>, "ctx">;
