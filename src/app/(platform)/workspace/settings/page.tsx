import { requirePageContext } from "@/server/auth/request";
import { systemStatus } from "@/server/hub/hub";
import { SettingsView } from "@/components/hub/settings";

export const metadata = { title: "Settings" };
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageContext();
  const { tab } = await searchParams;
  const admin = ctx.platformRole === "owner";
  return <SettingsView tab={tab} user={{ name: ctx.name, email: ctx.email, role: ctx.platformRole }} org={{ name: ctx.orgName, isDemo: ctx.orgIsDemo }} admin={admin} status={admin ? systemStatus() : null} />;
}
