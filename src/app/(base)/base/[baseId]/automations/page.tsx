import { listAutomations, type Action, type Trigger } from "@/server/platform/automations";
import { listApprovals } from "@/server/platform/approvals";
import { AutomationsApp } from "@/components/platform/automations-ui";
import { loadBaseMeta } from "../load";

export const metadata = { title: "Automations · Bang On OS" };
export default async function AutomationsPage({ params }: { params: Promise<{ baseId: string }> }) {
  const { baseId } = await params;
  const { ctx, ...meta } = await loadBaseMeta(baseId);
  const [list, approvals] = await Promise.all([listAutomations(ctx, baseId), listApprovals(ctx, baseId)]);
  return <AutomationsApp meta={meta} automations={list.map((a) => ({ id: a.id, name: a.name, isEnabled: a.isEnabled, trigger: a.trigger as unknown as Trigger, actions: a.actions as unknown as Action[], lastRunAt: a.lastRunAt?.toISOString() ?? null, runCount: a.runCount, failCount: a.failCount, webhookToken: a.webhookToken }))}
    approvals={approvals.map((x) => ({ id: x.id, kind: x.kind, summary: x.summary, status: x.status, source: x.source, createdAt: x.createdAt.toISOString(), result: x.result ?? null }))} />;
}
