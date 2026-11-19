import { requirePageContext } from "@/server/auth/request";
import { Workspace } from "@/components/workspace";
import type { SP } from "@/components/entity-view";

export const metadata = { title: "Slate & IP development" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  return <Workspace ctx={ctx} sp={sp} base="/slate" title="Slate & IP development" lede="Idea intake through packaging, coverage and greenlight gates. Gate decisions run through role-checked approvals." tabs={[
    { key: "pipeline", label: "Pipeline", entity: "ip_projects" },
    { key: "gates", label: "Gate room", entity: "greenlight_gates" },
    { key: "calendar", label: "Decision calendar", entity: "ip_projects", columns: ["title", "stage", "decisionDate", "nextMilestone", "nextMilestoneDate", "ownerUserId"] },
    { key: "materials", label: "Materials library", entity: "development_materials" },
    { key: "coverage", label: "Coverage & reviews", entity: "creative_reviews" },
    { key: "packaging", label: "Packaging studio", entity: "packaging_items" },
    { key: "rights", label: "Rights command", entity: "rights_entries" },
  ]} />;
}
