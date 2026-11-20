import { requirePageContext } from "@/server/auth/request";
import { listBases } from "@/server/platform/schema";
import { TEMPLATES } from "@/server/platform/templates";
import { HomeView } from "@/components/platform/home";
import { listApps } from "@/server/apps/apps";
import { APP_TEMPLATES } from "@/server/apps/templates";

export const metadata = { title: "Home" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ loadDemo?: string; new?: string }> }) {
  const ctx = await requirePageContext();
  const apps = await listApps(ctx);
  const bases = await listBases(ctx);
  const sp = await searchParams;
  return <HomeView bases={bases.map((b) => ({ id: b.id, name: b.name, icon: b.icon, color: b.color, role: b.role, updatedAt: b.updatedAt.toISOString() }))}
    apps={apps.map((a) => ({ id: a.id, name: a.name, slug: a.slug, description: a.description, audience: a.audience, published: !!a.publishedVersionId, canBuild: ["owner", "creator"].includes(a.role), color: a.color, icon: a.icon }))}
    appTemplates={Object.entries(APP_TEMPLATES).map(([key, t]) => ({ key, name: t.name, description: t.description, icon: t.icon, color: t.color }))}
    templates={TEMPLATES} canCreate={["owner", "creator"].includes(ctx.platformRole)} loadDemo={sp.loadDemo === "1" && ctx.role === "org_admin"} startNew={sp.new === "base"} showToday />;
}
