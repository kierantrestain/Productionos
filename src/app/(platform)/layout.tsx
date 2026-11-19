import "../platform.css";
import { requirePageContext } from "@/server/auth/request";
import { myOrganisations } from "@/server/services/admin";
import { PlatformShell } from "@/components/platform/shell";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const orgs = await myOrganisations(ctx.userId);
  return (
    <PlatformShell user={{ name: ctx.name, email: ctx.email, role: ctx.platformRole }} org={{ id: ctx.orgId, name: ctx.orgName, isDemo: ctx.orgIsDemo }} orgs={orgs.map((o) => ({ id: o.id, name: o.name, isDemo: o.isDemo }))}>
      {children}
    </PlatformShell>
  );
}
