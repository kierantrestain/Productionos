import { requirePageContext } from "@/server/auth/request";
import { Workspace } from "@/components/workspace";
import type { SP } from "@/components/entity-view";

export const metadata = { title: "Rights, contracts & legal" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  return <Workspace ctx={ctx} sp={sp} base="/rights" title="Rights, contracts & legal" lede="Chain of title, contracts with signature evidence, releases and obligations. Missing clearance blocks delivery approval." tabs={[
    { key: "contracts", label: "Contracts", entity: "contracts" },
    { key: "rights", label: "Rights & chain of title", entity: "rights_entries" },
    { key: "releases", label: "Release forms", entity: "release_forms" },
    { key: "obligations", label: "Obligations", entity: "contract_obligations" },
    { key: "windows", label: "Licence windows", entity: "licence_windows" },
  ]} />;
}
