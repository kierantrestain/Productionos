import { requirePageContext } from "@/server/auth/request";
import { navFor } from "@/lib/nav";
import { Shell } from "@/components/shell";
import { myOrganisations } from "@/server/services/admin";
import { listFieldDefs } from "@/server/services/customise";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const [orgs, customFields] = await Promise.all([myOrganisations(ctx.userId), listFieldDefs(ctx)]);
  return <Shell nav={navFor(ctx.role)} orgs={orgs.map((o) => ({ id: o.id, name: o.name, isDemo: o.isDemo }))} orgId={ctx.orgId} config={{ settings: ctx.settings, customFields }} user={{ name: ctx.name, role: ctx.role, orgName: ctx.orgName, isDemo: ctx.orgIsDemo }}>{children}</Shell>;
}
