import { requirePageContext } from "@/server/auth/request";
import { listPlatformTokens, V2_SCOPES } from "@/server/platform/api-v2";
import { ApiTokensView } from "@/components/platform/api-tokens";

export const metadata = { title: "API & tokens" };
export default async function ApiPage() {
  const ctx = await requirePageContext();
  if (!["owner", "creator"].includes(ctx.platformRole)) return <div style={{ padding: 32 }}>Only owners and creators can manage API tokens.</div>;
  return <ApiTokensView tokens={await listPlatformTokens(ctx)} scopes={[...V2_SCOPES]} />;
}
