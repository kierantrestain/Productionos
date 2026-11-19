import { requirePageContext } from "@/server/auth/request";
import { Workspace } from "@/components/workspace";
import type { SP } from "@/components/entity-view";

export const metadata = { title: "Operations & tasks" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  return <Workspace ctx={ctx} sp={sp} base="/operations" title="Operations & tasks" lede="Tasks, SOPs, meetings and the decision log." tabs={[
    { key: "tasks", label: "Tasks", entity: "tasks" },
    { key: "sops", label: "SOP library", entity: "sops" },
    { key: "meetings", label: "Meetings", entity: "meetings" },
    { key: "decisions", label: "Decision log", entity: "decisions" },
  ]} />;
}
