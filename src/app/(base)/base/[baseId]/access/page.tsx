import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { bases, memberships, users } from "@/db/schema";
import { listBaseMembers } from "@/server/platform/members";
import { AccessApp } from "@/components/platform/access-ui";
import { loadBaseMeta } from "../load";

export const metadata = { title: "Access · Bang On OS" };
export default async function AccessPage({ params }: { params: Promise<{ baseId: string }> }) {
  const { baseId } = await params;
  const { ctx, ...meta } = await loadBaseMeta(baseId);
  const [overrides, people] = await Promise.all([
    listBaseMembers(ctx, baseId),
    db.select({ id: users.id, name: users.name, role: memberships.platformRole }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, ctx.orgId), isNull(users.disabledAt))).orderBy(asc(users.name)),
  ]);
  const [b] = await db.select({ visibility: bases.visibility }).from(bases).where(eq(bases.id, baseId));
  return <AccessApp meta={meta} visibility={b.visibility} isOwner={meta.role === "owner"} people={people.map((p) => ({ ...p, override: overrides.find((o) => o.userId === p.id)?.role ?? null }))} />;
}
