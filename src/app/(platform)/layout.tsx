import "../platform.css";
import { requirePageContext } from "@/server/auth/request";
import { myOrganisations } from "@/server/services/admin";
import { PlatformShell } from "@/components/platform/shell";
import { redirect } from "next/navigation";
import { listBases } from "@/server/platform/schema";
import { listApps } from "@/server/apps/apps";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  // Client-portal visitors never see workspace pages: send them to their portal (or explain it isn't ready).
  if (ctx.platformRole === "portal") {
    const portal = (await listApps(ctx)).find((a) => a.audience === "portal" && a.publishedVersionId);
    if (portal) redirect(`/a/${portal.slug}`);
    return <div style={{ padding: 40, fontFamily: "system-ui, sans-serif" }}>Your client portal is not available yet. Please contact your account manager.</div>;
  }
  const [orgs, bases, apps] = await Promise.all([myOrganisations(ctx.userId), ctx.platformRole === "portal" ? [] : listBases(ctx), ctx.platformRole === "portal" ? [] : listApps(ctx)]);
  return (
    <PlatformShell user={{ name: ctx.name, email: ctx.email, role: ctx.platformRole }} org={{ id: ctx.orgId, name: ctx.orgName, isDemo: ctx.orgIsDemo }} orgs={orgs.map((o) => ({ id: o.id, name: o.name, isDemo: o.isDemo }))}
      bases={bases.map((b) => ({ id: b.id, name: b.name, color: b.color, icon: b.icon }))} suiteUrl={process.env.SUITE_URL || undefined} apps={apps.filter((a) => a.audience !== "portal" || a.role !== "portal").map((a) => ({ id: a.id, name: a.name, href: a.publishedVersionId ? `/a/${a.slug}` : `/builder/${a.id}` }))}>
      {children}
    </PlatformShell>
  );
}
