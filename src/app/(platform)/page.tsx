import { requirePageContext } from "@/server/auth/request";
import { listBases } from "@/server/platform/schema";
import { TEMPLATES } from "@/server/platform/templates";
import { HomeView } from "@/components/platform/home";

export const metadata = { title: "Home" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ loadDemo?: string }> }) {
  const ctx = await requirePageContext();
  const bases = await listBases(ctx);
  const sp = await searchParams;
  return <HomeView bases={bases.map((b) => ({ id: b.id, name: b.name, icon: b.icon, color: b.color, role: b.role, updatedAt: b.updatedAt.toISOString() }))}
    templates={TEMPLATES} canCreate={["owner", "creator"].includes(ctx.platformRole)} loadDemo={sp.loadDemo === "1" && ctx.role === "org_admin"} />;
}
