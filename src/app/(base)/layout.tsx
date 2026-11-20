import "../platform.css";
import { requirePageContext } from "@/server/auth/request";
import { WorkspaceRail } from "@/components/hub/rail";

export const dynamic = "force-dynamic";
export default async function BaseLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  return <div className="ws-frame"><WorkspaceRail userName={ctx.name} /><div className="ws-main">{children}</div></div>;
}
