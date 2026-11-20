"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@/components/ui/modal";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { RefreshCw, Plus, Trash2, Database, Link2 } from "lucide-react";
import { createSyncAction, deleteSyncAction, runSyncAction } from "@/app/platform-actions";
import type { BaseMeta } from "@/app/(base)/base/[baseId]/load";
import { BaseHeader } from "./base-header";
import { confirmDialog } from "@/components/ui/dialogs";

type S = { id: string; kind: string; name: string; tableId: string | null; status: string; lastSyncedAt: string | null; lastError: string | null; lastStats: Record<string, unknown> | null; intervalMinutes: number | null; source: string };
const inp: React.CSSProperties = { width: "100%", height: 34, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-background-surface)", color: "var(--color-text-primary)", font: "inherit", padding: "0 8px" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", margin: "12px 0 4px" };

export function SyncApp({ meta, syncs, secrets }: { meta: BaseMeta; syncs: S[]; secrets: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  return (
    <div className="p-base">
      <BaseHeader base={meta.base} role={meta.role} active="sync" />
      <main style={{ flex: 1, overflow: "auto", background: "var(--color-background-muted)", padding: 24 }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700 }}>Data sync</h1>
              <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>One-way syncs into a table from a CSV link or an Airtable table. Sources are only read, never changed. Records are matched by source ID; rows removed at the source are reported, not deleted. Synced changes never trigger automations.</p>
            </div>
            {meta.canEdit && <Button label="New sync" variant="primary" icon={<Plus size={16} />} onClick={() => setOpen(true)} />}
          </div>
          {msg && <p role="status" style={{ marginBottom: 10 }}>{msg}</p>}
          {!syncs.length && <EmptyState title="No syncs yet" description="Keep a table up to date from a published Google Sheet / CSV link or an existing Airtable base while you migrate." />}
          <div style={{ display: "grid", gap: 10 }}>
            {syncs.map((s) => (
              <article key={s.id} className="p-basecard" style={{ alignItems: "flex-start" }}>
                <span style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 8, background: "var(--color-background-blue)" }}>{s.kind === "airtable" ? <Database size={16} /> : <Link2 size={16} />}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t">{s.name} <span className={`chip ${s.status === "ok" ? "green" : s.status === "error" ? "red" : "gray"}`}>{s.status}</span></div>
                  <div className="s" style={{ overflowWrap: "anywhere" }}>{s.source}</div>
                  <div className="s">{s.tableId ? <Link href={`/base/${meta.base.id}/${s.tableId}`}>Open {meta.tables.find((t) => t.id === s.tableId)?.name ?? "table"}</Link> : "Table is created on the first run"}{s.intervalMinutes ? ` · every ${s.intervalMinutes >= 1440 ? `${s.intervalMinutes / 1440} day(s)` : `${s.intervalMinutes / 60} hour(s)`}` : " · manual"}{s.lastSyncedAt ? ` · last ${new Date(s.lastSyncedAt).toLocaleString("en-GB")}` : ""}</div>
                  {s.lastStats && <div className="s">{Object.entries(s.lastStats).map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${v}`).join(" · ")}</div>}
                  {s.lastError && <div className="s" style={{ color: "var(--color-text-error)" }}>{s.lastError}</div>}
                </div>
                {meta.canEdit && <button type="button" className="p-tbtn" disabled={busy === s.id} onClick={async () => { setBusy(s.id); setMsg(""); const r = await runSyncAction(s.id); setBusy(null); setMsg(r.ok ? `Synced: ${r.data.stats.created} new, ${r.data.stats.updated} updated, ${r.data.stats.unchanged} unchanged.` : r.error); router.refresh(); }}><RefreshCw size={14} />{busy === s.id ? "Syncing…" : "Sync now"}</button>}
                {meta.canEdit && <button type="button" className="p-tbtn" aria-label="Remove sync" onClick={async () => { if ((await confirmDialog("Remove this sync? The table and its records stay.", { danger: true, confirmLabel: "Remove" }))) { await deleteSyncAction(s.id); router.refresh(); } }}><Trash2 size={14} /></button>}
              </article>
            ))}
          </div>
        </div>
      </main>
      {open && <NewSync baseId={meta.base.id} secrets={secrets} onClose={() => setOpen(false)} onDone={() => { setOpen(false); router.refresh(); }} />}
    </div>
  );
}

function NewSync({ baseId, secrets, onClose, onDone }: { baseId: string; secrets: boolean; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"csv_url" | "airtable">("csv_url");
  const [f, setF] = useState({ name: "", url: "", keyColumn: "", airtableBaseId: "", airtableTable: "", token: "", interval: "" });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={520} padding={6} purpose="form">
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>New sync</h2>
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button type="button" className={`p-tbtn ${kind === "csv_url" ? "on-blue" : ""}`} onClick={() => setKind("csv_url")}><Link2 size={14} />CSV link</button>
        <button type="button" className={`p-tbtn ${kind === "airtable" ? "on-blue" : ""}`} onClick={() => setKind("airtable")}><Database size={14} />Airtable</button>
      </div>
      <label style={lbl} htmlFor="s-name">Table name</label><input id="s-name" style={inp} value={f.name} onChange={set("name")} placeholder="e.g. Leads (synced)" />
      {kind === "csv_url" ? <>
        <label style={lbl} htmlFor="s-url">CSV URL (https)</label><input id="s-url" style={inp} value={f.url} onChange={set("url")} placeholder="https://…/export?format=csv" />
        <label style={lbl} htmlFor="s-key">Unique ID column (optional — defaults to the first column)</label><input id="s-key" style={inp} value={f.keyColumn} onChange={set("keyColumn")} />
      </> : <>
        {!secrets && <p style={{ color: "var(--color-text-orange)", fontSize: 13, marginTop: 10 }}>Token storage isn&apos;t configured on this deployment (SECRET_ENCRYPTION_KEY). Airtable syncs can&apos;t be saved until an administrator adds it.</p>}
        <label style={lbl} htmlFor="s-ab">Airtable base ID</label><input id="s-ab" style={inp} value={f.airtableBaseId} onChange={set("airtableBaseId")} placeholder="appXXXXXXXXXXXXXX" />
        <label style={lbl} htmlFor="s-at">Table name or ID</label><input id="s-at" style={inp} value={f.airtableTable} onChange={set("airtableTable")} />
        <label style={lbl} htmlFor="s-tok">Personal access token (read-only scope: data.records:read)</label><input id="s-tok" type="password" autoComplete="off" style={inp} value={f.token} onChange={set("token")} />
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>Encrypted at rest and never shown again. Airtable is only read — nothing is written back.</p>
      </>}
      <label style={lbl} htmlFor="s-int">Schedule</label>
      <select id="s-int" style={inp} value={f.interval} onChange={set("interval")}><option value="">Manual only</option><option value="60">Hourly (with the job runner)</option><option value="1440">Daily</option></select>
      {err && <p style={{ color: "var(--color-text-error)", marginTop: 10 }}>{err}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <Button label="Cancel" onClick={onClose} />
        <Button label="Create sync" variant="primary" clickAction={async () => {
          const r = await createSyncAction(baseId, { kind, name: f.name, url: f.url, keyColumn: f.keyColumn, airtableBaseId: f.airtableBaseId, airtableTable: f.airtableTable, token: f.token, intervalMinutes: f.interval ? Number(f.interval) : null });
          if (!r.ok) setErr(r.error); else onDone();
        }} />
      </div>
    </Dialog>
  );
}
