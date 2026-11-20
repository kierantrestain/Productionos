"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { date, dateTime, humanize, money } from "@/lib/format";
import { cancelMessagesAction, confirmMessagesAction, decideApprovalAction, retryEventAction, runQueueAction, setWorkflowStatusAction, updateRecord, withdrawApprovalAction } from "@/app/actions";
import { Drawer, useRun } from "./client";
import { alertDialog, confirmDialog } from "@/components/ui/dialogs";

export function ApprovalRow({ a, chain, href, isMine }: { a: { id: string; title: string; kind: string; amountMinor: number | null; currency: string | null; requiredRole: string; status: string; createdAt: string; canDecide: boolean; decisionNote: string | null }; chain: { decision: string; actorRole: string; at: string; note: string | null; actor: string }[]; href: string | null; isMine: boolean }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<"approved" | "rejected" | null>(null);
  return (
    <li style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontWeight: 600 }}>{href ? <Link href={href}>{a.title}</Link> : a.title}</div>
        <div className="subtle" style={{ fontSize: 12 }}>{humanize(a.kind)} · needs {humanize(a.requiredRole)} · raised {dateTime(a.createdAt)}</div>
        <ol className="subtle" style={{ fontSize: 12, margin: "6px 0 0", paddingLeft: 18 }} aria-label="Approval chain">
          {chain.map((c, i) => <li key={i} style={{ display: "list-item", padding: 0, border: 0 }}>{humanize(c.decision)} by {c.actor} ({humanize(c.actorRole)}) · {dateTime(c.at)}{c.note ? ` — “${c.note}”` : ""}</li>)}
        </ol>
      </div>
      <div style={{ textAlign: "right", minWidth: 120 }}><div style={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{a.amountMinor != null ? money(a.amountMinor, a.currency ?? "GBP") : ""}</div><span className={`badge ${a.status === "approved" ? "tone-ok" : a.status === "rejected" ? "tone-bad" : "tone-warn"}`}>{humanize(a.status)}</span></div>
      {a.status === "pending" && <div className="row" style={{ width: "100%", justifyContent: "flex-end" }}>
        {a.canDecide ? <>
          <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => setOpen("approved")}>Approve</button>
          <button className="btn btn-sm btn-danger" disabled={pending} onClick={() => setOpen("rejected")}>Reject</button>
        </> : <span className="subtle" style={{ fontSize: 12 }}>{isMine ? "You raised this — another approver must decide." : `Awaiting ${humanize(a.requiredRole)} authority.`}</span>}
        {isMine && <button className="btn btn-quiet btn-sm" onClick={() => run(withdrawApprovalAction(a.id), "Withdrawn").then((r) => r !== undefined && router.refresh())}>Withdraw</button>}
      </div>}
      <Drawer modal open={!!open} onClose={() => setOpen(null)} title={open === "approved" ? "Approve request" : "Reject request"}
        footer={<><button className="btn" onClick={() => setOpen(null)}>Cancel</button><button className={`btn ${open === "approved" ? "btn-primary" : "btn-danger"}`} disabled={pending || (open === "rejected" && !note.trim())} onClick={() => run(decideApprovalAction(a.id, open!, note || undefined), open === "approved" ? "Approved" : "Rejected").then((r) => { if (r) { setOpen(null); router.refresh(); } })}>Confirm {open === "approved" ? "approval" : "rejection"}</button></>}>
        <p style={{ marginBottom: 12 }}><strong>{a.title}</strong>{a.amountMinor != null ? ` — ${money(a.amountMinor, a.currency ?? "GBP")}` : ""}. Your decision is recorded permanently in the approval chain.</p>
        <label className="label" htmlFor={`n-${a.id}`}>{open === "rejected" ? "Reason (required)" : "Note (optional)"}</label>
        <textarea id={`n-${a.id}`} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
      </Drawer>
    </li>
  );
}

type Task = { id: string; version: number; title: string; kind: string; status: string; dueDate: string | null; assignee: string | null; episode: string | null; productionId: string; production: string };
const LANES = ["todo", "in_progress", "review", "blocked", "done"];
export function PostBoard({ tasks, canWrite }: { tasks: Task[]; canWrite: boolean }) {
  const router = useRouter();
  const { run } = useRun();
  const [drag, setDrag] = useState<Task | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const move = (t: Task, status: string) => { if (t.status !== status) run(updateRecord("post_tasks", t.id, { status }, t.version), `Moved to ${humanize(status)}`).then((r) => r && router.refresh()); };
  return (
    <div className="board" aria-label="Post-production board">
      {LANES.map((l) => (
        <div key={l} className="lane" data-drop={over === l} onDragOver={(e) => { e.preventDefault(); setOver(l); }} onDragLeave={() => setOver(null)} onDrop={() => { if (drag) move(drag, l); setDrag(null); setOver(null); }}>
          <h3>{humanize(l)}<span>{tasks.filter((t) => t.status === l).length}</span></h3>
          {tasks.filter((t) => t.status === l).map((t) => (
            <div key={t.id} className="card" draggable={canWrite} onDragStart={() => setDrag(t)}>
              <Link href={`/data/post_tasks/${t.id}`} style={{ fontWeight: 560 }}>{t.title}</Link>
              <div className="subtle" style={{ fontSize: 12 }}>{t.production}{t.episode ? ` · ${t.episode}` : ""}</div>
              <div className="row" style={{ marginTop: 6, justifyContent: "space-between" }}>
                <span className="badge plain">{humanize(t.kind)}</span>
                <span className="subtle" style={{ fontSize: 12 }}>{t.assignee ?? "Unassigned"}{t.dueDate ? ` · ${date(t.dueDate, { short: true })}` : ""}</span>
              </div>
              {canWrite && <select className="select btn-sm" style={{ marginTop: 6, height: 28 }} aria-label={`Move ${t.title}`} value={t.status} onChange={(e) => move(t, e.target.value)}>{LANES.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function OutboxReview({ messages, provider }: { messages: { id: string; to: string | null; subject: string; body: string; status: string; template: string; lastError: string | null; createdAt: string }[]; provider: { enabled: boolean; reason?: string } }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);
  const pendingMsgs = messages.filter((m) => ["awaiting_confirmation", "blocked_no_provider", "failed"].includes(m.status));
  const p = messages.find((m) => m.id === preview);
  return (
    <section className="panel" aria-label="Outbound messages">
      <div className="panel-head"><h2>Outbox · review before sending</h2>
        <div className="actions">
          <button className="btn btn-sm btn-primary" disabled={!sel.size || pending} onClick={async () => (await confirmDialog(`Confirm ${sel.size} message(s) for sending?${provider.enabled ? "" : `\n\nNo mail provider is active (${provider.reason}). They will be marked BLOCKED, not sent.`}`)) && run(confirmMessagesAction([...sel])).then(async (r) => { if (r) { (await alertDialog(r.queued ? `${r.queued} queued for delivery.` : `${r.blocked} blocked: ${r.providerReason}`)); setSel(new Set()); router.refresh(); } })}>Confirm & send ({sel.size})</button>
          <button className="btn btn-sm" disabled={!sel.size || pending} onClick={() => run(cancelMessagesAction([...sel]), "Cancelled").then((r) => { if (r !== undefined) { setSel(new Set()); router.refresh(); } })}>Cancel</button>
        </div>
      </div>
      {!provider.enabled && <div className="notice warn" style={{ margin: 12 }}>Email delivery is disabled: {provider.reason}. Confirmed messages are recorded as blocked — nothing leaves the system.</div>}
      <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
        <table className="data"><thead><tr><th className="sel"><span className="sr-only">Select</span></th><th>To</th><th>Subject</th><th>Template</th><th>Status</th><th>Created</th><th /></tr></thead>
          <tbody>{messages.map((m) => (
            <tr key={m.id}>
              <td className="sel">{pendingMsgs.includes(m) && <input type="checkbox" aria-label="Select message" checked={sel.has(m.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} />}</td>
              <td>{m.to}</td><td>{m.subject}</td><td>{humanize(m.template)}</td><td><span className={`badge ${m.status === "sent" ? "tone-ok" : m.status.includes("block") || m.status === "failed" ? "tone-bad" : "tone-warn"}`} title={m.lastError ?? undefined}>{humanize(m.status)}</span></td>
              <td>{dateTime(m.createdAt)}</td><td><button className="btn btn-quiet btn-sm" onClick={() => setPreview(m.id)}>Preview</button></td>
            </tr>))}
            {messages.length === 0 && <tr><td colSpan={7}><div className="empty" style={{ padding: 16 }}>No outbound messages.</div></td></tr>}
          </tbody></table>
      </div>
      <Drawer open={!!p} onClose={() => setPreview(null)} title="Message preview">{p && <div className="stack" style={{ gap: 8 }}><div><span className="label">To</span><div>{p.to}</div></div><div><span className="label">Subject</span><div>{p.subject}</div></div><pre style={{ whiteSpace: "pre-wrap", font: "inherit", background: "var(--surface-2)", padding: 12, borderRadius: 8 }}>{p.body}</pre>{p.lastError && <div className="notice bad">{p.lastError}</div>}</div>}</Drawer>
    </section>
  );
}

export function WorkflowControls({ id, status, disposition, isAdmin }: { id: string; status: string; disposition: string; isAdmin: boolean }) {
  const router = useRouter();
  const { run, pending } = useRun();
  if (!isAdmin) return null;
  const set = (s: "active" | "paused" | "retired") => run(setWorkflowStatusAction(id, s), `Workflow ${s}`).then((r) => r !== undefined && router.refresh());
  return <span className="row" style={{ gap: 4 }}>
    {status !== "active" && !["blocked", "retired"].includes(disposition) && <button className="btn btn-sm" disabled={pending} onClick={() => set("active")}>Activate</button>}
    {status === "active" && <button className="btn btn-sm" disabled={pending} onClick={() => set("paused")}>Pause</button>}
  </span>;
}

export function QueueControls({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const { run, pending } = useRun();
  if (!isAdmin) return null;
  return <button className="btn" disabled={pending} onClick={() => run(runQueueAction()).then(async (r) => { if (r) { (await alertDialog(`Processed: ${r.claimed} claimed, ${r.done} done, ${r.retried} retried, ${r.dead} dead-lettered, ${r.skipped} skipped.`)); router.refresh(); } })}>Run queue now</button>;
}

export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const { run, pending } = useRun();
  return <button className="btn btn-sm" disabled={pending} onClick={() => run(retryEventAction(id), "Retry scheduled").then((r) => r !== undefined && router.refresh())}>Retry</button>;
}
