import { requirePageContext } from "@/server/auth/request";
import { systemStatus } from "@/server/hub/hub";
import { SettingsView } from "@/components/hub/settings";

export const metadata = { title: "Settings" };
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; connected?: string; error?: string }> }) {
  const ctx = await requirePageContext();
  const { tab, connected, error } = await searchParams;
  const notice = connected ? (connected === "chatgpt" ? "Your ChatGPT plan is connected." : `${connected} connected. It may take a moment to show as active.`) : undefined;
  const admin = ctx.platformRole === "owner";
  return <SettingsView tab={tab} user={{ name: ctx.name, email: ctx.email, role: ctx.platformRole }} org={{ name: ctx.orgName, isDemo: ctx.orgIsDemo }} admin={admin} status={admin ? systemStatus() : null} notice={notice} error={error?.slice(0, 300)} />;
}
