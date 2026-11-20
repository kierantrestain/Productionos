"use client";
import { useCallback, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/modal";
import { Avatar } from "@astryxdesign/core/Avatar";
import { ChevronUp, ChevronDown, X, Trash2, MessageSquare, History, Lock, Sparkles } from "lucide-react";
import { isComputed } from "@/lib/platform/fields";
import { addCommentAction, clickButtonAction, deleteCommentAction, recordDetailAction } from "@/app/platform-actions";
import { CellEditor, CellView } from "./cells";
import { FieldIcon } from "./icons";
import type { BaseData, ClientField, ClientRow } from "./types";

type Comment = { id: string; body: string; authorId: string; author: string | null; createdAt: string };
type Rev = { id: string; action: string; actor: string | null; at: string; changes: Record<string, unknown> };

function renderBody(body: string) {
  return body.split(/(@\[[^\]]+\]\([0-9a-f-]{36}\))/g).map((part, i) => {
    const m = part.match(/^@\[([^\]]+)\]\(([0-9a-f-]{36})\)$/);
    return m ? <span key={i} className="chip blue" style={{ height: 18 }}>@{m[1]}</span> : <span key={i}>{part}</span>;
  });
}

export function RecordDialog({ data, recordId, ids, onNavigate, onClose, onEdit, onDelete, onAiFill }: {
  data: BaseData; recordId: string; ids: string[]; onNavigate: (id: string) => void; onClose: () => void;
  onEdit: (recordId: string, fieldId: string, value: unknown, before: unknown) => Promise<boolean>; onDelete: (id: string) => void; onAiFill: (fieldId: string, ids: string[]) => Promise<void>;
}) {
  const [row, setRow] = useState<ClientRow | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [history, setHistory] = useState<Rev[]>([]);
  const [tab, setTab] = useState<"comments" | "history">("comments");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const [mention, setMention] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await recordDetailAction(data.table.id, recordId);
    if (!r.ok) { setErr(r.error); return; }
    setRow(r.data.row as ClientRow | null); setComments(r.data.comments as Comment[]); setHistory(r.data.history as Rev[]);
  }, [data.table.id, recordId]);
  useEffect(() => { setRow(null); setEditing(null); load(); }, [load]);

  const pos = ids.indexOf(recordId);
  const primary = data.allFields.find((f) => f.isPrimary);
  const title = row && primary ? (String(row.values[primary.id] ?? "") || "Unnamed record") : "…";
  const fieldName = (id?: string | null) => data.allFields.find((f) => f.id === id)?.name ?? "A field";
  const canEditField = (f: ClientField) => data.can.edit && f.editable && !isComputed(f.type);

  const press = async (f: ClientField) => {
    setErr("");
    const r = await clickButtonAction(f.id, recordId);
    if (!r.ok) { setErr(r.error); return; }
    if (r.data.url) window.open(r.data.url, "_blank", "noopener,noreferrer"); else load();
  };
  const commit = async (f: ClientField, v: unknown) => {
    setEditing(null);
    const before = row?.values[f.id] ?? null;
    if (JSON.stringify(before) === JSON.stringify(v)) return;
    if (await onEdit(recordId, f.id, v, before)) load();
  };

  const mentionMatches = mention !== null ? data.collaborators.filter((c) => c.name.toLowerCase().includes(mention.toLowerCase())).slice(0, 6) : [];

  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={1040} padding={0} purpose="info">
      <div style={{ display: "flex", flexDirection: "column", height: "min(86vh, 860px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <button type="button" className="p-tbtn" aria-label="Previous record" disabled={pos <= 0} onClick={() => onNavigate(ids[pos - 1])}><ChevronUp size={16} /></button>
          <button type="button" className="p-tbtn" aria-label="Next record" disabled={pos < 0 || pos >= ids.length - 1} onClick={() => onNavigate(ids[pos + 1])}><ChevronDown size={16} /></button>
          <h2 style={{ fontSize: 18, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h2>
          {row && <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>#{row.autonumber}</span>}
          {data.can.delete && <button type="button" className="p-tbtn" style={{ color: "var(--color-text-red)" }} onClick={() => { onDelete(recordId); onClose(); }}><Trash2 size={15} />Delete</button>}
          <button type="button" className="p-tbtn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
            {err && <p style={{ color: "var(--color-text-error)" }}>{err}</p>}
            {!row && !err && <p style={{ color: "var(--color-text-secondary)" }}>Loading…</p>}
            {row && data.allFields.map((f) => (
              <div key={f.id} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                  <FieldIcon type={f.type} size={12} />{f.name}{!canEditField(f) && !isComputed(f.type) && <Lock size={10} />}
                  {f.type === "aiText" && canEditField(f) && data.aiConfigured && <button type="button" className="p-tbtn" style={{ height: 20, fontSize: 11 }} onClick={async () => { await onAiFill(f.id, [recordId]); load(); }}><Sparkles size={11} />Generate</button>}
                </div>
                {f.description && <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>{f.description}</div>}
                {editing === f.id ? (
                  <div className="g-editor" style={{ position: "relative" }}>
                    <CellEditor f={f} value={row.values[f.id]} collaborators={data.collaborators} canSchema={data.can.schema} recordId={recordId} onRefresh={load} onCancel={() => setEditing(null)} onCommit={(v) => commit(f, v)} />
                  </div>
                ) : (
                  <div role={canEditField(f) || f.type === "button" ? "button" : undefined} tabIndex={canEditField(f) || f.type === "button" ? 0 : -1}
                    onClick={() => { if (f.type === "button") { press(f); return; } if (!canEditField(f)) return; if (f.type === "checkbox") commit(f, !row.values[f.id]); else setEditing(f.id); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && canEditField(f)) setEditing(f.id); }}
                    style={{ minHeight: 34, padding: "6px 10px", border: "1px solid var(--color-border)", borderRadius: 6, background: isComputed(f.type) || !canEditField(f) ? "var(--color-background-muted)" : "var(--color-background-surface)", cursor: canEditField(f) ? "text" : "default", whiteSpace: f.type === "longText" || f.type === "aiText" ? "pre-wrap" : undefined, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                    <CellView f={f} v={row.values[f.id]} />
                  </div>
                )}
              </div>
            ))}
            {row && <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Created {new Date(row.createdAt).toLocaleString("en-GB")} · Last modified {new Date(row.updatedAt).toLocaleString("en-GB")}</p>}
          </div>
          <aside style={{ width: 340, borderLeft: "1px solid var(--color-border)", display: "flex", flexDirection: "column", background: "var(--color-background-muted)" }}>
            <div style={{ display: "flex", gap: 4, padding: 8, borderBottom: "1px solid var(--color-border)" }}>
              <button type="button" className={`p-tbtn ${tab === "comments" ? "on-blue" : ""}`} onClick={() => setTab("comments")}><MessageSquare size={14} />Comments {comments.length ? `(${comments.length})` : ""}</button>
              <button type="button" className={`p-tbtn ${tab === "history" ? "on-blue" : ""}`} onClick={() => setTab("history")}><History size={14} />Revision history</button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
              {tab === "comments" ? (comments.length ? comments.map((c) => (
                <div key={c.id} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <Avatar name={c.author ?? "?"} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12 }}><strong>{c.author ?? "Someone"}</strong> <span style={{ color: "var(--color-text-secondary)" }}>{new Date(c.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span></div>
                    <div style={{ fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{renderBody(c.body)}</div>
                    {(c.authorId === data.me.id || data.role === "owner" || data.role === "creator") && <button type="button" className="p-tbtn" style={{ height: 20, fontSize: 11, color: "var(--color-text-secondary)" }} onClick={async () => { const r = await deleteCommentAction(c.id); if (r.ok) load(); }}>Delete</button>}
                  </div>
                </div>
              )) : <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No comments yet. Start the conversation — @mention a collaborator to notify them.</p>)
              : (history.length ? history.map((h) => (
                <div key={h.id} style={{ fontSize: 12, marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--color-border)" }}>
                  <div><strong>{h.actor ?? "Someone"}</strong> <span style={{ color: "var(--color-text-secondary)" }}>{h.action} · {new Date(h.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span></div>
                  {Object.entries(h.changes ?? {}).map(([fid, ch]) => {
                    const c = ch as { from?: unknown; to?: unknown } | null;
                    return <div key={fid} style={{ marginTop: 2 }}>{fieldName(fid)}: {c && typeof c === "object" && "to" in c ? <><s style={{ color: "var(--color-text-secondary)" }}>{fmt(c.from)}</s> → {fmt(c.to)}</> : fmt(ch)}</div>;
                  })}
                  {false && null}
                </div>
              )) : <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No changes recorded yet.</p>)}
            </div>
            {tab === "comments" && data.can.comment && (
              <form style={{ padding: 10, borderTop: "1px solid var(--color-border)", position: "relative" }} onSubmit={async (e) => {
                e.preventDefault(); if (!draft.trim()) return;
                const r = await addCommentAction(recordId, draft.trim());
                if (!r.ok) { setErr(r.error); return; }
                setDraft(""); load();
              }}>
                {mentionMatches.length > 0 && (
                  <div className="g-editor" style={{ bottom: "100%", left: 10, width: 220, padding: 4 }}>
                    {mentionMatches.map((c) => <div key={c.id} className="g-opt" onMouseDown={(e) => { e.preventDefault(); setDraft((d) => d.replace(/@([^\s@]*)$/, `@[${c.name}](${c.id}) `)); setMention(null); }}>{c.name}</div>)}
                  </div>
                )}
                <textarea className="p-textarea" rows={3} aria-label="Add a comment" placeholder="Leave a comment — type @ to mention" value={draft}
                  onChange={(e) => { setDraft(e.target.value); const m = e.target.value.match(/@([^\s@\]]*)$/); setMention(m ? m[1] : null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }} />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}><button type="submit" className="p-tbtn on-blue" disabled={!draft.trim()}>Comment</button></div>
              </form>
            )}
            {tab === "comments" && !data.can.comment && <p style={{ padding: 10, fontSize: 12, color: "var(--color-text-secondary)" }}>Readers can view comments but not add them.</p>}
          </aside>
        </div>
      </div>
    </Dialog>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length > 1 ? "s" : ""}` : "(empty)";
  if (typeof v === "object") return "…";
  const s = String(v); return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}
