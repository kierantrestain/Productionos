import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { baseAutomations } from "@/db/schema";
import { requirePageContext } from "@/server/auth/request";
import { getAppForBuilder } from "@/server/apps/apps";
import { asLite, loadBaseStructure } from "@/server/platform/schema";
import { Builder } from "@/components/builder/builder";
import type { AppConfig } from "@/lib/apps/types";

export const metadata = { title: "Builder · Bang On OS" };
export default async function BuilderPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const ctx = await requirePageContext();
  let app: Awaited<ReturnType<typeof getAppForBuilder>>["app"];
  try { app = (await getAppForBuilder(ctx, appId)).app; } catch { notFound(); }
  const st = await loadBaseStructure(ctx, app.baseId);
  const autos = await db.select({ id: baseAutomations.id, name: baseAutomations.name }).from(baseAutomations).where(and(eq(baseAutomations.baseId, app.baseId), isNull(baseAutomations.archivedAt)));
  return <Builder
    app={{ id: app.id, name: app.name, slug: app.slug, audience: app.audience, baseId: app.baseId, published: !!app.publishedVersionId, revision: app.draftRevision }}
    initial={app.draft as unknown as AppConfig}
    meta={{
      baseName: st.access.base.name,
      tables: st.tables.map((t) => ({ id: t.id, name: t.name, primaryFieldId: t.primaryFieldId })),
      fields: st.fields.map((f) => ({ ...asLite(f), tableId: f.tableId })),
      views: st.views.filter((v) => !v.ownerUserId).map((v) => ({ id: v.id, name: v.name, tableId: v.tableId })),
      automations: autos,
    }} />;
}
