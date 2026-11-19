import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requirePageContext } from "@/server/auth/request";
import { getSso } from "@/server/auth/sso";
import { secretsConfigured } from "@/server/crypto";
import { SecurityView } from "@/components/platform/workspace-ui";

export const metadata = { title: "Security & SSO" };
export default async function SecurityPage() {
  const ctx = await requirePageContext();
  if (ctx.platformRole !== "owner") return <div style={{ padding: 32 }}>Only workspace owners can manage security settings.</div>;
  const [org] = await db.select({ slug: organisations.slug }).from(organisations).where(eq(organisations.id, ctx.orgId));
  return <SecurityView sso={await getSso(ctx)} orgSlug={org.slug} secrets={secretsConfigured()} />;
}
