import { requirePageContext } from "@/server/auth/request";
import { Workspace } from "@/components/workspace";
import type { SP } from "@/components/entity-view";

export const metadata = { title: "Commercial, sponsorship & distribution" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  return <Workspace ctx={ctx} sp={sp} base="/commercial" title="Commercial, sponsorship & distribution" lede="Sponsor and brand integrations with deliverable tracking, the sales and licensing pipeline, and release planning." tabs={[
    { key: "sponsors", label: "Sponsorship & brand", entity: "sponsor_deals" },
    { key: "commercial_deliverables", label: "Commercial deliverables", entity: "commercial_deliverables" },
    { key: "sales", label: "Sales & licensing", entity: "sales_opportunities" },
    { key: "windows", label: "Licence windows", entity: "licence_windows" },
    { key: "releases", label: "Release & distribution", entity: "releases" },
    { key: "companies", label: "Buyers & partners", entity: "companies" },
    { key: "territories", label: "Territories", entity: "territories" },
  ]} />;
}
