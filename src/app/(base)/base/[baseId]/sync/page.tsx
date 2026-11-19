import { listSyncs } from "@/server/platform/sync";
import { secretsConfigured } from "@/server/crypto";
import { SyncApp } from "@/components/platform/sync-ui";
import { loadBaseMeta } from "../load";

export const metadata = { title: "Sync · Bang On OS" };
export default async function SyncPage({ params }: { params: Promise<{ baseId: string }> }) {
  const { baseId } = await params;
  const { ctx, ...meta } = await loadBaseMeta(baseId);
  const list = await listSyncs(ctx, baseId);
  return <SyncApp meta={meta} secrets={secretsConfigured()} syncs={list.map((s) => ({ id: s.id, kind: s.kind, name: String((s.config as { name?: string }).name ?? "Sync"), tableId: s.tableId, status: s.status, lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null, lastError: s.lastError, lastStats: s.lastStats ?? null, intervalMinutes: s.intervalMinutes, source: s.kind === "csv_url" ? String((s.config as { url?: string }).url) : `Airtable ${(s.config as { airtableBaseId?: string }).airtableBaseId} / ${(s.config as { airtableTable?: string }).airtableTable}` }))} />;
}
