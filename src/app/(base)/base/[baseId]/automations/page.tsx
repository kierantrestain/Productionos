import { listAutomations, type Action, type Trigger } from "@/server/platform/automations";
import { AutomationsApp } from "@/components/platform/automations-ui";
import { loadBaseMeta } from "../load";

export const metadata = { title: "Automations · Bang On OS" };
export default async function AutomationsPage({ params }: { params: Promise<{ baseId: string }> }) {
  const { baseId } = await params;
  const { ctx, ...meta } = await loadBaseMeta(baseId);
  const list = await listAutomations(ctx, baseId);
  return <AutomationsApp meta={meta} automations={list.map((a) => ({ id: a.id, name: a.name, isEnabled: a.isEnabled, trigger: a.trigger as unknown as Trigger, actions: a.actions as unknown as Action[], lastRunAt: a.lastRunAt?.toISOString() ?? null, runCount: a.runCount, failCount: a.failCount }))} />;
}
