"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { dateTime, humanize } from "@/lib/format";
import { archiveAttachmentAction, commentAction } from "@/app/actions";
import { useRun, useToast } from "./client";
import { Icon } from "./icons";

type Att = { id: string; filename: string; sizeBytes: number; sha256: string; createdAt: string; contentType: string };

export function AttachmentsPanel({ entity, id, items, canWrite }: { entity: string; id: string; items: Att[]; canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const { run } = useRun();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.set("entityType", entity); fd.set("entityId", id); fd.set("file", f);
        const res = await fetch("/api/attachments", { method: "POST", body: fd });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) toast(j.error ?? `Upload failed (${res.status})`, "bad"); else toast(`Uploaded ${f.name}`);
      }
    } finally { setBusy(false); if (input.current) input.current.value = ""; router.refresh(); }
  }
  return (
    <section className="panel" aria-label="Documents">
      <div className="panel-head"><h2>Documents</h2>{canWrite && <>
        <input ref={input} type="file" multiple hidden onChange={(e) => upload(e.target.files)} aria-label="Upload files" />
        <button className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}><Icon name="plus" /> {busy ? "Uploading…" : "Upload"}</button>
      </>}</div>
      {items.length === 0 ? <div className="empty" style={{ padding: 20 }}><p className="muted">No documents attached.</p></div> : (
        <ul className="list">
          {items.map((a) => (
            <li key={a.id}>
              <Icon name="file" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <a href={`/api/attachments/${a.id}`} style={{ fontWeight: 550 }}>{a.filename}</a>
                <div className="subtle mono" style={{ fontSize: 11 }} title={`SHA-256 ${a.sha256}`}>{(a.sizeBytes / 1024).toFixed(1)} KB · sha256 {a.sha256.slice(0, 12)}… · {dateTime(a.createdAt)}</div>
              </div>
              {canWrite && <button className="btn btn-quiet btn-sm" aria-label={`Archive ${a.filename}`} onClick={async () => { if (confirm(`Archive ${a.filename}? It is retained and can be restored by an admin.`) && await run(archiveAttachmentAction(a.id), "Archived") !== undefined) router.refresh(); }}><Icon name="x" /></button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CommentsPanel({ entity, id, items, canComment }: { entity: string; id: string; items: { id: string; body: string; createdAt: string; author: string | null }[]; canComment: boolean }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [body, setBody] = useState("");
  return (
    <section className="panel" aria-label="Comments">
      <div className="panel-head"><h2>Comments</h2></div>
      <div className="panel-body stack">
        {canComment && <form className="stack" style={{ gap: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await run(commentAction(entity, id, body))) { setBody(""); router.refresh(); } }}>
          <label className="sr-only" htmlFor={`c-${id}`}>Add a comment</label>
          <textarea id={`c-${id}`} className="textarea" style={{ minHeight: 60 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for the team…" />
          <div><button className="btn btn-sm" disabled={pending || !body.trim()}>Post comment</button></div>
        </form>}
        {items.length === 0 ? <p className="subtle">No comments yet.</p> : items.map((c) => (
          <div key={c.id}><div className="subtle" style={{ fontSize: 12 }}><strong className="muted">{c.author ?? "Unknown"}</strong> · {dateTime(c.createdAt)}</div><p style={{ whiteSpace: "pre-wrap" }}>{c.body}</p></div>
        ))}
      </div>
    </section>
  );
}

export function ActivityPanel({ items }: { items: { id: string; action: string; actor: string | null; at: string; after: unknown; meta: unknown }[] }) {
  return (
    <section className="panel" aria-label="Activity">
      <div className="panel-head"><h2>Activity</h2><span className="subtle" style={{ fontSize: 12 }}>Immutable audit trail</span></div>
      {items.length === 0 ? <div className="empty" style={{ padding: 20 }}><p className="muted">No history.</p></div> : (
        <ul className="list" style={{ maxHeight: 360, overflow: "auto" }}>
          {items.map((a) => {
            const changed = a.after && typeof a.after === "object" ? Object.keys(a.after as object).filter((k) => !["id", "orgId", "createdAt", "updatedAt", "version", "createdBy"].includes(k)) : [];
            return (
              <li key={a.id} style={{ alignItems: "flex-start", fontSize: 13 }}>
                <span className="badge plain">{humanize(a.action)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div><strong>{a.actor ?? "System"}</strong> <span className="subtle">· {dateTime(a.at)}</span></div>
                  {changed.length > 0 && a.action !== "create" && <div className="subtle" style={{ fontSize: 12 }}>{changed.slice(0, 6).map(humanize).join(", ")}{changed.length > 6 ? "…" : ""}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
