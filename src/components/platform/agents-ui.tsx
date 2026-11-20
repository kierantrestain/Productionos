"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/modal";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Plus, Send, Pencil, Trash2, Check, X, MessageSquarePlus, Wrench, ShieldCheck } from "lucide-react";
import { COLORS } from "@/lib/platform/fields";
import { decideApprovalAction, deleteAgentAction, getThreadAction, saveAgentAction, sendAgentMessageAction } from "@/app/platform-actions";
import type { BaseMeta } from "@/app/(base)/base/[baseId]/load";
import { BaseHeader } from "./base-header";
import { confirmDialog } from "@/components/ui/dialogs";

type Agent = { id: string; name: string; emoji: string; color: string; role: string | null; instructions: string; tableIds: string[]; canPropose: boolean; provider?: string };
type Item = { id: string; kind: "user" | "assistant" | "activity"; text: string };
type Proposal = { id: string; kind: string; summary: string; status: string; result: Record<string, unknown> | null };
const inp: React.CSSProperties = { width: "100%", height: 34, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-background-surface)", color: "var(--color-text-primary)", font: "inherit", padding: "0 8px" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", margin: "12px 0 4px" };

/** Starter roles, written for this platform (not copied from any product). */
const PRESETS: Omit<Agent, "id" | "tableIds">[] = [
  { name: "Ops Lead", emoji: "🧭", color: "blue", role: "operations lead", canPropose: true, instructions: "Keep delivery on track. Each morning-style check: find overdue or blocked tasks, projects at risk, and anything missing an owner or date. Suggest concrete next actions and propose updates only when asked." },
  { name: "Revenue Analyst", emoji: "📈", color: "green", role: "sales & finance analyst", canPropose: false, instructions: "Answer questions about pipeline, won deals, invoices, payments and receivables using the records. Show your working (which records, which totals). Flag overdue invoices and unallocated payments. Never estimate figures you can't see." },
  { name: "Client Success", emoji: "🤝", color: "pink", role: "client success manager", canPropose: true, instructions: "Look after engagements: health, renewal dates, pause requests, wins. Draft check-in comments and propose status updates for at-risk clients. Be warm but factual." },
  { name: "Producer", emoji: "🎬", color: "red", role: "production coordinator", canPropose: true, instructions: "Help plan productions: episodes, scenes, shoot days, crew and kit. Spot clashes and gaps (missing locations, unassigned crew, dates). Propose fixes for the user to approve." },
];

export function AgentsApp({ meta, ai, agents, activeId, threads, threadId, items: initialItems, proposals: initialProposals, pendingCount }: {
  meta: BaseMeta; ai: boolean; agents: Agent[]; activeId: string | null; threads: { id: string; title: string; updatedAt: string }[];
  threadId: string | null; items: Item[]; proposals: Proposal[]; pendingCount: number;
}) {
  const router = useRouter();
  const active = agents.find((a) => a.id === activeId) ?? null;
  const [edit, setEdit] = useState<Agent | null>(null);
  const [tid, setTid] = useState(threadId);
  const [items, setItems] = useState<Item[]>(initialItems);
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [items.length, proposals.length, busy]);
  const base = `/base/${meta.base.id}/agents`;

  const send = async () => {
    if (!active || !draft.trim() || busy) return;
    const text = draft.trim(); setDraft(""); setErr(""); setBusy(true);
    setItems((x) => [...x, { id: `pending-${Date.now()}`, kind: "user", text }]);
    const r = await sendAgentMessageAction(active.id, tid, text);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setItems(r.data.items); setProposals(r.data.proposals as Proposal[]);
    if (!tid) { setTid(r.data.threadId); window.history.replaceState(null, "", `${base}?a=${active.id}&t=${r.data.threadId}`); }
  };
  const decide = async (p: Proposal, approve: boolean) => {
    setErr("");
    const r = await decideApprovalAction(p.id, approve);
    if (!r.ok) setErr(r.error);
    if (tid) { const t = await getThreadAction(tid); if (t.ok) setProposals(t.data.proposals as Proposal[]); }
    router.refresh();
  };

  return (
    <div className="p-base">
      <BaseHeader base={meta.base} role={meta.role} active="agents" />
      <div className="p-body">
        <aside className="p-views" aria-label="Agents">
          <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
            <div className="p-sect">Agents</div>
            {agents.map((a) => (
              <Link key={a.id} href={`${base}?a=${a.id}`} className="p-viewitem" aria-current={a.id === activeId ? "page" : undefined}>
                <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 8, background: `var(--color-background-${a.color})`, fontSize: 14 }} aria-hidden>{a.emoji}</span>
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontWeight: 600 }}>{a.name}</span><span style={{ display: "block", fontSize: 11, color: "var(--color-text-secondary)" }}>{a.role ?? (a.canPropose ? "can propose changes" : "read-only")}</span></span>
              </Link>
            ))}
            {active && <>
              <div className="p-sect">Conversations</div>
              <Link href={`${base}?a=${active.id}`} className="p-viewitem"><MessageSquarePlus size={15} />New conversation</Link>
              {threads.map((t) => <Link key={t.id} href={`${base}?a=${active.id}&t=${t.id}`} className="p-viewitem" aria-current={t.id === tid ? "page" : undefined}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span></Link>)}
            </>}
          </div>
          {meta.canEdit && <div style={{ borderTop: "1px solid var(--color-border)", padding: 8 }}><button type="button" className="p-viewitem" onClick={() => setEdit({ id: "", ...PRESETS[0], tableIds: [] })}><Plus size={15} />New agent</button></div>}
        </aside>
        <main className="p-main">
          {!ai && <div className="p-basecard" style={{ margin: 12, color: "var(--color-text-orange)" }}>AI isn&apos;t configured on this deployment (ANTHROPIC_API_KEY). You can set agents up now; they&apos;ll answer once the key is added.</div>}
          {pendingCount > 0 && <div style={{ margin: "12px 12px 0", fontSize: 13 }}><Link href={`/base/${meta.base.id}/automations`}>{pendingCount} request{pendingCount > 1 ? "s" : ""} waiting for approval →</Link></div>}
          {!active ? (
            <div style={{ display: "grid", placeItems: "center", flex: 1, padding: 24 }}>
              <div style={{ maxWidth: 720, width: "100%" }}>
                <EmptyState title="Give this base an AI team" description="Agents read your records with your permissions and propose changes for you to approve. They work only inside this app — no emails, messages or payments." />
                {meta.canEdit && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginTop: 16 }}>
                  {PRESETS.map((p) => <button key={p.name} type="button" className="p-basecard" style={{ textAlign: "left", cursor: "pointer", alignItems: "flex-start" }} onClick={() => setEdit({ id: "", ...p, tableIds: [] })}><span style={{ fontSize: 22 }} aria-hidden>{p.emoji}</span><span><span className="t" style={{ display: "block" }}>{p.name}</span><span className="s">{p.role}</span></span></button>)}
                </div>}
              </div>
            </div>
          ) : (
            <>
              <div className="p-toolbar">
                <span style={{ fontSize: 20 }} aria-hidden>{active.emoji}</span>
                <strong>{active.name}</strong>
                <span className="chip">{active.canPropose ? "proposes changes · you approve" : "read-only"}</span>{active.provider === "chatgpt" && <span className="chip">runs on your ChatGPT plan</span>}
                <span className="chip">{active.tableIds.length ? `${active.tableIds.length} table${active.tableIds.length > 1 ? "s" : ""}` : "all tables"}</span>
                <span style={{ flex: 1 }} />
                {meta.canEdit && <button type="button" className="p-tbtn" onClick={() => setEdit(active)}><Pencil size={14} />Edit</button>}
                {meta.canEdit && <button type="button" className="p-tbtn" aria-label="Delete agent" onClick={async () => { if ((await confirmDialog(`Delete ${active.name}? Conversations are removed too.`, { danger: true, confirmLabel: "Delete" }))) { await deleteAgentAction(active.id); router.push(base); router.refresh(); } }}><Trash2 size={14} /></button>}
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", background: "var(--color-background-muted)" }} aria-live="polite">
                <div style={{ maxWidth: 820, margin: "0 auto", display: "grid", gap: 10 }}>
                  {!items.length && <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>Ask {active.name} something like “What needs attention this week?” or “Which invoices are overdue and who owns them?”</p>}
                  {items.map((m) => m.kind === "activity"
                    ? <div key={m.id} style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", gap: 6, alignItems: "center" }}><Wrench size={12} />{m.text}</div>
                    : <div key={m.id} style={{ justifySelf: m.kind === "user" ? "end" : "start", maxWidth: "85%", background: m.kind === "user" ? "var(--color-background-blue)" : "var(--color-background-card)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "10px 14px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 14 }}>{m.text}</div>)}
                  {proposals.map((p) => (
                    <div key={p.id} className="p-basecard" style={{ display: "block", borderColor: p.status === "pending" ? "var(--color-text-yellow)" : undefined }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}><ShieldCheck size={15} /><strong style={{ fontSize: 13 }}>Proposed change</strong><span className={`chip ${p.status === "approved" ? "green" : p.status === "pending" ? "yellow" : p.status === "failed" ? "red" : "gray"}`}>{p.status}</span></div>
                      <div style={{ fontSize: 13 }}>{p.summary}</div>
                      {p.status === "failed" && <div style={{ fontSize: 12, color: "var(--color-text-error)" }}>{String(p.result?.error ?? "")}</div>}
                      {p.status === "pending" && <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        <button type="button" className="p-tbtn on-green" onClick={() => decide(p, true)}><Check size={14} />Approve</button>
                        <button type="button" className="p-tbtn" onClick={() => decide(p, false)}><X size={14} />Reject</button>
                      </div>}
                    </div>
                  ))}
                  {busy && <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{active.name} is working…</div>}
                  {err && <div role="alert" style={{ color: "var(--color-text-error)", fontSize: 13 }}>{err}</div>}
                  <div ref={endRef} />
                </div>
              </div>
              <form style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--color-border)" }} onSubmit={(e) => { e.preventDefault(); send(); }}>
                <textarea className="p-textarea" rows={2} aria-label={`Message ${active.name}`} placeholder={`Message ${active.name} — Enter to send, Shift+Enter for a new line`} value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} style={{ flex: 1 }} />
                <button type="submit" className="p-tbtn on-blue" disabled={busy || !draft.trim()} aria-label="Send"><Send size={16} /></button>
              </form>
            </>
          )}
        </main>
      </div>
      {edit && <AgentDialog meta={meta} initial={edit} onClose={() => setEdit(null)} onSaved={(id) => { setEdit(null); router.push(`${base}?a=${id}`); router.refresh(); }} />}
    </div>
  );
}

function AgentDialog({ meta, initial, onClose, onSaved }: { meta: BaseMeta; initial: Agent; onClose: () => void; onSaved: (id: string) => void }) {
  const [a, setA] = useState<Agent>(initial);
  const [err, setErr] = useState("");
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={620} padding={6} purpose="form">
      <div style={{ display: "block", flex: "none" }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>{a.id ? `Edit ${initial.name}` : "New agent"}</h2>
      {!a.id && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>{PRESETS.map((p) => <button key={p.name} type="button" className="chip" style={{ border: 0, cursor: "pointer" }} onClick={() => setA({ ...a, ...p })}>{p.emoji} {p.name}</button>)}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ width: 80 }}><label style={lbl} htmlFor="ag-emoji">Icon</label><input id="ag-emoji" style={inp} value={a.emoji} maxLength={4} onChange={(e) => setA({ ...a, emoji: e.target.value })} /></div>
        <div style={{ flex: 1 }}><label style={lbl} htmlFor="ag-name">Name</label><input id="ag-name" style={inp} value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} /></div>
        <div style={{ width: 120 }}><label style={lbl} htmlFor="ag-color">Colour</label><select id="ag-color" style={inp} value={a.color} onChange={(e) => setA({ ...a, color: e.target.value })}>{COLORS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
      </div>
      <label style={lbl} htmlFor="ag-role">Role</label><input id="ag-role" style={inp} value={a.role ?? ""} onChange={(e) => setA({ ...a, role: e.target.value })} placeholder="e.g. finance analyst" />
      <label style={lbl} htmlFor="ag-ins">Instructions</label>
      <textarea id="ag-ins" className="p-textarea" rows={6} value={a.instructions} onChange={(e) => setA({ ...a, instructions: e.target.value })} placeholder="What this agent is responsible for, what good looks like, what to avoid." />
      <label style={lbl}>Tables it can use</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {meta.tables.map((t) => { const on = a.tableIds.includes(t.id); return <button key={t.id} type="button" className={`chip ${on ? "blue" : ""}`} style={{ border: 0, cursor: "pointer" }} onClick={() => setA({ ...a, tableIds: on ? a.tableIds.filter((x) => x !== t.id) : [...a.tableIds, t.id] })}>{t.name}</button>; })}
      </div>
      <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>{a.tableIds.length ? "" : "None selected = all tables. "}Agents always read with the chatting person&apos;s own permissions, so hidden fields stay hidden.</p>
      <label style={{ display: "grid", gap: 4, marginTop: 12, fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>Runs on
        <select className="ui-input" value={a.provider ?? "claude"} onChange={(e) => setA({ ...a, provider: e.target.value })}>
          <option value="claude">Workspace AI (Claude, the workspace&apos;s key)</option>
          <option value="chatgpt">The ChatGPT plan of whoever is chatting (they connect it in Settings → Connected apps)</option>
        </select>
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}><input type="checkbox" checked={a.canPropose} onChange={(e) => setA({ ...a, canPropose: e.target.checked })} />Can propose changes (create, update, comment) — each one needs a person&apos;s approval</label>
      {err && <p style={{ color: "var(--color-text-error)", marginTop: 10 }}>{err}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <Button label="Cancel" onClick={onClose} />
        <Button label="Save agent" variant="primary" clickAction={async () => { const r = await saveAgentAction(meta.base.id, { id: a.id || undefined, name: a.name, emoji: a.emoji, color: a.color, role: a.role ?? undefined, instructions: a.instructions, tableIds: a.tableIds, provider: a.provider ?? "claude", canPropose: a.canPropose }); if (!r.ok) setErr(r.error); else onSaved(r.data.id); }} />
      </div>
      </div>
    </Dialog>
  );
}
