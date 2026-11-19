import Link from "next/link";
import { requirePageContext } from "@/server/auth/request";
import { listTemplates } from "@/server/services/templates";
import { TemplateWizard } from "@/components/template-wizard";
import { Forbidden, PageHeader } from "@/components/ui";
import { canWrite } from "@/lib/permissions";

export const metadata = { title: "New production" };
export const maxDuration = 120;

export default async function NewProductionPage() {
  const ctx = await requirePageContext();
  if (!canWrite(ctx.role, "production")) return <Forbidden what="creating productions" />;
  return (
    <>
      <PageHeader eyebrow={<Link href="/productions">Productions</Link>} title="New production"
        lede="Choose the kind of production. Its template builds the structure — episodes or units, running order, budget categories, deliverables, post pipeline and kickoff tasks — and you can change anything afterwards." />
      <TemplateWizard templates={await listTemplates(ctx)} canManage={["org_admin", "producer", "executive"].includes(ctx.role)} />
    </>
  );
}
