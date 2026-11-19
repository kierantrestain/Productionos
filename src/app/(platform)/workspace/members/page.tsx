import { requirePageContext } from "@/server/auth/request";
import { listPlatformMembers } from "@/server/platform/members";
import { MembersView } from "@/components/platform/workspace-ui";

export const metadata = { title: "Members & roles" };
export default async function MembersPage() {
  const ctx = await requirePageContext();
  if (!["owner", "creator"].includes(ctx.platformRole)) return <div style={{ padding: 32 }}>Only owners and creators can see workspace members.</div>;
  const members = await listPlatformMembers(ctx);
  return <MembersView me={ctx.userId} isOwner={ctx.platformRole === "owner"} members={members} />;
}
