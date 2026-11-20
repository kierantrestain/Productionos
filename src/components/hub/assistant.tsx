"use client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, History, Loader2, MessageSquarePlus, Send, Sparkles, X } from "lucide-react";
import { assistantSendAction, assistantStateAction, assistantThreadAction } from "@/app/assistant-actions";
import { decideApprovalAction } from "@/app/platform-actions";
import { HEAD_BG } from "@/components/platform/base-header";

type Item = { id: string; kind: "user" | "assistant" | "activity"; text: string };
type Proposal = { id: string; kind: string; summary: string; status: string; result: Record<string, unknown> | null };
type State = { bases: { id: string; name: string; color: string; role: string }[]; base: { id: string; role: string; agentId: string } | null; threads: { id: string; title: string | null; updatedAt: string }[]; ready: boolean; provider: string | null };
const SUGGEST = ["What needs attention in this base?", "Summarise the records added this week", "Find records with missing information", "Draft a new record for…"];

/** Ask AI — available on every workspace screen (⌘J). Scoped to one base and to the person's own access. */
export function Assistant({ defaultBaseId }: { defaultBaseId?: string }) {
  const router = useRouter(); const path = usePathname();
  const pathBase = path.match(/^\/base\/([0-9a-f-]{36})/)?.[1];
  const [open, setOpen] = useState(false);
  const [baseId, setBaseId] = useState<string | null>(pathBase ?? defaultBaseId ?? null);
  const [st, setSt] = useState<State | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]); const [proposals, setProposals] = useState<Proposal[]>([]);
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [showHistory, setShowHistory] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { if (pathBase && pathBase !== baseId) { setBaseId(pathBase); setThreadId(null); setItems([]); setProposals([]); } }, [pathBase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const load = useCallback(async () => { const r = await assistantStateAction(baseId); if (r.ok) { setSt(r.data); if (!baseId && r.data.bases[0]) setBaseId(r.data.bases[0].id); } else setErr(r.error); }, [baseId]);
  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [items, proposals, busy]);

  const openThread = async (id: string) => { setShowHistory(false); const r = await assistantThreadAction(id); if (r.ok) { setThreadId(id); setItems(r.data.items); setProposals(r.data.proposals as Proposal[]); } };
  const send = async (msg: string) => {
    if (!baseId || !msg.trim() || busy) return;
    setErr(""); setBusy(true); setText(""); setItems((x) => [...x, { id: `local-${Date.now()}`, kind: "user", text: msg }]);
    const r = await assistantSendAction(baseId, threadId, msg);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setThreadId(r.data.thread.id); setItems(r.data.items); setProposals(r.data.proposals as Proposal[]);
  };
  const decide = async (p: Proposal, approve: boolean) => {
    setErr("");
    const r = await decideApprovalAction(p.id, approve);
    if (!r.ok) { setErr(r.error); return; }
    if (threadId) await openThread(threadId);
    if (approve) router.refresh();
  };
  const base = st?.bases.find((b) => b.id === baseId);
  const pending = proposals.filter((p) => p.status === "pending");

  return (
    <>
      {!open && <button type="button" className="as-fab" onClick={() => setOpen(true)} aria-label="Ask AI (Ctrl+J)" title="Ask AI (Ctrl+J)"><Sparkles size={18} /><span>Ask AI</span></button>}
      {open && (
        <aside className="as-panel" role="dialog" aria-label="AI assistant">
          <header className="as-head">
            <span className="as-mark" aria-hidden><Sparkles size={15} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>Assistant</strong>
              <label className="as-base"><span className="ws-dot" style={{ background: HEAD_BG[base?.color ?? "blue"] ?? HEAD_BG.blue, width: 10, height: 10 }} />
                <select aria-label="Base the assistant works in" value={baseId ?? ""} onChange={(e) => { setBaseId(e.target.value); setThreadId(null); setItems([]); setProposals([]); }}>
                  {!st?.bases.length && <option value="">No bases</option>}
                  {st?.bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            </div>
            <button type="button" className="as-ic" aria-label="Past conversations" aria-pressed={showHistory} onClick={() => setShowHistory((h) => !h)}><History size={16} /></button>
            <button type="button" className="as-ic" aria-label="New conversation" onClick={() => { setThreadId(null); setItems([]); setProposals([]); setShowHistory(false); }}><MessageSquarePlus size={16} /></button>
            <button type="button" className="as-ic" aria-label="Close assistant" onClick={() => setOpen(false)}><X size={16} /></button>
          </header>
          <p className="as-scope">Works only in <strong>{base?.name ?? "the selected base"}</strong>, with your access{st?.base ? ` (${st.base.role})` : ""}. Every change waits for you to apply it.</p>
          {showHistory ? (
            <ul className="as-history">{(st?.threads ?? []).map((t) => <li key={t.id}><button type="button" onClick={() => openThread(t.id)}>{t.title || "Conversation"}<small>{new Date(t.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></button></li>)}
              {!st?.threads.length && <li className="as-muted">No past conversations in this base.</li>}</ul>
          ) : (
            <div className="as-body" aria-live="polite">
              {!items.length && (
                <div className="as-empty">
                  <p>Ask about your data, or ask for a change — “mark every overdue task as blocked”, “add a Priority field to Tasks”, “who owns the Acme deal?”.</p>
                  <div className="as-chips">{SUGGEST.map((s) => <button key={s} type="button" onClick={() => (s.endsWith("…") ? setText(s.replace("…", " ")) : send(s))} disabled={!st?.ready || !baseId}>{s}</button>)}</div>
                </div>
              )}
              {items.map((it) => it.kind === "activity" ? <div key={it.id} className="as-activity">{it.text}</div> : <div key={it.id} className={`as-msg ${it.kind}`}>{it.text}</div>)}
              {proposals.map((p) => (
                <div key={p.id} className={`as-prop ${p.status}`}>
                  <div className="as-prop-k">{p.status === "pending" ? "Proposed change" : p.status === "approved" ? "Applied" : p.status === "rejected" ? "Dismissed" : "Couldn't apply"}</div>
                  <div>{p.summary}</div>
                  {p.status === "failed" && <div className="as-err">{String(p.result?.error ?? "")}</div>}
                  {p.status === "pending" && <div className="as-prop-a"><button type="button" className="as-apply" onClick={() => decide(p, true)}><Check size={14} />Apply</button><button type="button" className="as-dismiss" onClick={() => decide(p, false)}>Dismiss</button></div>}
                </div>
              ))}
              {busy && <div className="as-activity"><Loader2 size={14} className="as-spin" /> Working on it…</div>}
              {err && <div className="as-err" role="alert">{err}</div>}
              <div ref={end} />
            </div>
          )}
          {st && !st.ready && <p className="as-warn">AI isn&apos;t set up yet. An administrator adds the AI key, or you can connect your ChatGPT plan in Settings → Connected apps.</p>}
          <form className="as-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <textarea rows={2} value={text} placeholder={baseId ? `Ask about ${base?.name ?? "this base"}…` : "Pick a base first"} aria-label="Message the assistant" disabled={!baseId || !st?.ready}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} onChange={(e) => setText(e.target.value)} />
            <button type="submit" aria-label="Send" disabled={busy || !text.trim() || !st?.ready}><Send size={16} /></button>
          </form>
          {pending.length > 0 && <span className="as-sr" role="status">{pending.length} change{pending.length === 1 ? "" : "s"} waiting for you</span>}
        </aside>
      )}
    </>
  );
}
