import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { requirePageContext } from "@/server/auth/request";
import { AuditView } from "@/components/platform/workspace-ui";

export const metadata = { title: "Audit log" };
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; before?: string }> }) {
  const ctx = await requirePageContext();
  if (ctx.platformRole !== "owner" && ctx.role !== "org_admin") return <div style={{ padding: 32 }}>Only workspace owners can view the audit log.</div>;
  const { q, before } = await searchParams;
  const conds = [eq(auditEvents.orgId, ctx.orgId)];
  if (q?.trim()) conds.push(or(ilike(auditEvents.action, `%${q.trim()}%`), ilike(auditEvents.actorLabel, `%${q.trim()}%`), ilike(auditEvents.entityType, `%${q.trim()}%`))!);
  if (before && !Number.isNaN(Date.parse(before))) conds.push(lt(auditEvents.at, new Date(before)));
  const rows = await db.select().from(auditEvents).where(and(...conds)).orderBy(desc(auditEvents.at)).limit(100);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(auditEvents).where(eq(auditEvents.orgId, ctx.orgId));
  return <AuditView total={n} q={q ?? ""} rows={rows.map((r) => ({ id: r.id, at: r.at.toISOString(), actor: r.actorLabel ?? "System", action: r.action, entity: r.entityType, entityId: r.entityId, detail: JSON.stringify(r.meta ?? r.after ?? {}).slice(0, 300) }))} />;
}
