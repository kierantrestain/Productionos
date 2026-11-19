import { requirePageContext } from "@/server/auth/request";
import { navFor } from "@/lib/nav";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  return <Shell nav={navFor(ctx.role)} user={{ name: ctx.name, role: ctx.role, orgName: ctx.orgName, isDemo: ctx.orgIsDemo }}>{children}</Shell>;
}
