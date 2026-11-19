import { requirePageContext } from "@/server/auth/request";
import { Workspace } from "@/components/workspace";
import type { SP } from "@/components/entity-view";

export const metadata = { title: "Governance" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  return <Workspace ctx={ctx} sp={sp} base="/executive" title="Governance" lede="Business units, legal entities, initiatives, risks, KPIs and funding. Restricted to executive and finance/legal roles." tabs={[
    { key: "risks", label: "Risk register", entity: "risks" },
    { key: "kpis", label: "KPIs & targets", entity: "kpis" },
    { key: "funding", label: "Funding & capital", entity: "funding_sources" },
    { key: "initiatives", label: "Strategic initiatives", entity: "strategic_initiatives" },
    { key: "units", label: "Business units", entity: "business_units" },
    { key: "entities", label: "Legal entities & SPVs", entity: "legal_entities" },
    { key: "meetings", label: "Board & meetings", entity: "meetings", fixed: { kind: "board" } },
  ]} />;
}
