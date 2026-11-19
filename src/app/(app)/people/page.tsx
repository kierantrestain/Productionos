import { requirePageContext } from "@/server/auth/request";
import { Workspace } from "@/components/workspace";
import type { SP } from "@/components/entity-view";

export const metadata = { title: "Cast, crew & talent" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  return <Workspace ctx={ctx} sp={sp} base="/people" title="Cast, crew & talent" lede="One record per person, reused across productions. Engagements hold role, rate and contract status per production." tabs={[
    { key: "people", label: "People", entity: "people" },
    { key: "engagements", label: "Engagements", entity: "engagements" },
    { key: "cast", label: "Cast & contributors", entity: "engagements", fixed: { kind: "cast" } },
    { key: "crew", label: "Crew", entity: "engagements", fixed: { kind: "crew" } },
    { key: "availability", label: "Availability", entity: "availability_blocks" },
    { key: "companies", label: "Companies & agencies", entity: "companies" },
  ]} />;
}
