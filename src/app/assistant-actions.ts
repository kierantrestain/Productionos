"use server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentThreads } from "@/db/schema";
import { requireContext } from "@/server/auth/request";
import { toResult } from "@/server/errors";
import { ensureAssistant, getThread, sendAgentMessage } from "@/server/platform/agents";
import { aiConfigured } from "@/server/platform/ai";
import { chatgptConnection } from "@/server/integrations/chatgpt";
import { listBases } from "@/server/platform/schema";

/** Which AI the assistant uses for this person: the workspace key, else their own ChatGPT plan. */
async function provider(ctx: Awaited<ReturnType<typeof requireContext>>) {
  if (aiConfigured()) return "claude" as const;
  if (await chatgptConnection(ctx)) return "chatgpt" as const;
  return null;
}

export async function assistantStateAction(baseId: string | null) {
  return toResult(async () => {
    const ctx = await requireContext();
    const bases = ctx.platformRole === "portal" ? [] : (await listBases(ctx)).map((b) => ({ id: b.id, name: b.name, color: b.color, role: b.role }));
    const p = await provider(ctx);
    if (!baseId || !bases.some((b) => b.id === baseId)) return { bases, base: null, threads: [], ready: !!p, provider: p };
    const { agent, role } = await ensureAssistant(ctx, baseId);
    const threads = await db.select({ id: agentThreads.id, title: agentThreads.title, updatedAt: agentThreads.updatedAt }).from(agentThreads).where(and(eq(agentThreads.agentId, agent.id), eq(agentThreads.userId, ctx.userId))).orderBy(desc(agentThreads.updatedAt)).limit(15);
    return { bases, base: { id: baseId, role, agentId: agent.id }, threads: threads.map((t) => ({ ...t, updatedAt: t.updatedAt.toISOString() })), ready: !!p, provider: p };
  });
}

export async function assistantSendAction(baseId: string, threadId: string | null, text: string) {
  return toResult(async () => {
    const ctx = await requireContext();
    const p = await provider(ctx);
    if (!p) throw new Error("AI isn't set up yet: an administrator must add the AI key, or connect your ChatGPT plan in Settings → Connected apps.");
    const { agent } = await ensureAssistant(ctx, baseId);
    const r = await sendAgentMessage(ctx, agent.id, threadId, text, { provider: p });
    return getThread(ctx, r.threadId);
  });
}

export async function assistantThreadAction(threadId: string) {
  return toResult(async () => getThread(await requireContext(), threadId));
}
