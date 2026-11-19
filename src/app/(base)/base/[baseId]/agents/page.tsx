import { listAgents, listThreads, getThread } from "@/server/platform/agents";
import { listApprovals } from "@/server/platform/approvals";
import { aiConfigured } from "@/server/platform/ai";
import { AgentsApp } from "@/components/platform/agents-ui";
import { loadBaseMeta } from "../load";

export const metadata = { title: "Agents · Bang On OS" };
export default async function AgentsPage({ params, searchParams }: { params: Promise<{ baseId: string }>; searchParams: Promise<{ a?: string; t?: string }> }) {
  const { baseId } = await params; const { a, t } = await searchParams;
  const { ctx, ...meta } = await loadBaseMeta(baseId);
  const agents = await listAgents(ctx, baseId);
  const active = agents.find((x) => x.id === a) ?? agents[0];
  const threads = active ? await listThreads(ctx, active.id) : [];
  const thread = t && threads.some((x) => x.id === t) ? await getThread(ctx, t) : null;
  const approvals = await listApprovals(ctx, baseId);
  return <AgentsApp key={`${active?.id}:${t ?? ""}`} meta={meta} ai={aiConfigured()}
    agents={agents.map((x) => ({ id: x.id, name: x.name, emoji: x.emoji, color: x.color, role: x.role, instructions: x.instructions, tableIds: x.tableIds, canPropose: x.canPropose }))}
    activeId={active?.id ?? null} threads={threads.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt.toISOString() }))}
    threadId={thread?.thread.id ?? null} items={thread?.items ?? []} proposals={thread?.proposals.map((p) => ({ ...p, result: (p.result ?? null) as Record<string, unknown> | null })) ?? []}
    pendingCount={approvals.filter((x) => x.status === "pending").length} />;
}
