import { Suspense } from "react";
import { requirePageContext } from "@/server/auth/request";
import { SettingsFrame } from "@/components/hub/settings-frame";

/** Members, security, API tokens, audit log and personal settings share one Settings area. */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  return <Suspense><SettingsFrame role={ctx.platformRole} orgName={ctx.orgName}>{children}</SettingsFrame></Suspense>;
}
