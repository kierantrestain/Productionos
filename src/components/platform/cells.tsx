"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, X, Sparkles, Paperclip } from "lucide-react";
import { COLORS, displayValue, newChoiceId, type SelectChoice } from "@/lib/platform/fields";
import { cellText } from "@/lib/platform/cell-text";
export { cellText };
import { searchLinkAction, updateFieldAction } from "@/app/platform-actions";
import type { ClientField } from "./types";

type Ref = { id: string; title?: string; name?: string };
export const NUMERIC = new Set(["number", "currency", "percent", "duration", "rating", "count", "autonumber"]);

/** Value to send back to the server for an edit (objects → ids). */
export function toServerValue(f: ClientField, v: unknown): unknown {
  if (f.type === "link" || f.type === "user") return ((v as Ref[]) ?? []).map((x) => (typeof x === "string" ? x : x.id));
  return v;
}

function Chip({ name, color }: { name: string; color?: string }) { return <span className={`chip ${color ?? ""}`}>{name}</span>; }

export function CellView({ f, v }: { f: ClientField; v: unknown }) {
  if (f.type === "button") return <span className="chip blue" style={{ cursor: "pointer", fontWeight: 600 }}>{f.options.label || (f.options.action === "update_record" ? "Update" : f.options.action === "run_automation" ? "Run" : "Open")}</span>;
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) {
    if (f.type === "checkbox") return <span className="cbx" aria-label="Unchecked" />;
    return null;
  }
  switch (f.type) {
    case "checkbox": return <span className={`cbx ${v ? "on" : ""}`} aria-label={v ? "Checked" : "Unchecked"}>{v ? <Check size={12} strokeWidth={3} /> : null}</span>;
    case "rating": { const max = f.options.max ?? 5; return <span className="stars" aria-label={`${v} of ${max}`}>{Array.from({ length: max }, (_, i) => <span key={i} className={i < Number(v) ? "" : "off"}>★</span>)}</span>; }
    case "singleSelect": { const c = f.options.choices?.find((x) => x.id === v); return c ? <span className="chips"><Chip name={c.name} color={c.color} /></span> : null; }
    case "multipleSelects": return <span className="chips">{(v as string[]).map((id) => { const c = f.options.choices?.find((x) => x.id === id); return c ? <Chip key={id} name={c.name} color={c.color} /> : null; })}</span>;
    case "link": return <span className="chips">{(v as Ref[]).map((r) => <span key={r.id} className="chip link">{r.title || "Unnamed record"}</span>)}</span>;
    case "user": return <span className="chips">{(v as Ref[]).map((r) => <Chip key={r.id} name={r.name ?? ""} />)}</span>;
    case "createdBy": case "lastModifiedBy": return <span className="chips"><Chip name={(v as Ref).name ?? ""} /></span>;
    case "attachment": return <span className="chips">{(v as { id: string; filename: string }[]).map((a) => <span key={a.id} className="chip"><Paperclip size={10} />{a.filename}</span>)}</span>;
    case "url": return <a className="g-trunc" href={String(v)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{String(v).replace(/^https?:\/\//, "")}</a>;
    case "email": return <a className="g-trunc" href={`mailto:${v}`} onClick={(e) => e.stopPropagation()}>{String(v)}</a>;
    case "lookup": case "rollup": case "formula":
      if (Array.isArray(v) && v.some((x) => x && typeof x === "object")) return <span className="chips">{(v as Ref[]).map((r, i) => <Chip key={i} name={r?.title ?? r?.name ?? ""} />)}</span>;
      return <span className={`g-trunc ${typeof v === "number" ? "num" : ""}`}>{cellText(f, v)}</span>;
    default: return <span className="g-trunc">{cellText(f, v)}</span>;
  }
}

export interface EditorProps { f: ClientField; value: unknown; initial?: string; collaborators: { id: string; name: string }[]; canSchema: boolean; onCommit: (v: unknown, move?: "down" | "right" | null) => void; onCancel: () => void; recordId?: string; onRefresh?: () => void }

/** Type-aware cell editor. Text-like editors commit on Enter/Tab/blur, cancel on Escape. */
export function CellEditor(p: EditorProps) {
  switch (p.f.type) {
    case "attachment": return <AttachmentEditor {...p} />;
    case "singleSelect": case "multipleSelects": return <SelectEditor {...p} />;
    case "link": return <LinkEditor {...p} />;
    case "user": return <UserEditor {...p} />;
    case "date": case "dateTime": return <DateEditor {...p} />;
    case "longText": case "aiText": return <LongTextEditor {...p} />;
    default: return <TextEditor {...p} />;
  }
}

function keys(e: React.KeyboardEvent, commit: (move: "down" | "right" | null) => void, cancel: () => void, multiline = false) {
  if (e.key === "Escape") { e.preventDefault(); cancel(); }
  else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit("down"); }
  else if (e.key === "Tab") { e.preventDefault(); commit("right"); }
  e.stopPropagation();
}

function editText(f: ClientField, v: unknown) {
  if (v === null || v === undefined) return "";
  if (f.type === "percent") return String(Math.round(Number(v) * 10000) / 100);
  if (f.type === "duration") return displayValue(f, v);
  return String(v);
}

function TextEditor({ f, value, initial, onCommit, onCancel }: EditorProps) {
  const [s, setS] = useState(initial ?? editText(f, value));
  const done = useRef(false);
  const commit = (move: "down" | "right" | null) => {
    if (done.current) return; done.current = true;
    const v = s.trim() === "" ? null : f.type === "percent" ? Number(s.replace("%", "")) / 100 : s;
    onCommit(v, move);
  };
  return <input autoFocus value={s} onChange={(e) => setS(e.target.value)} onKeyDown={(e) => keys(e, commit, () => { done.current = true; onCancel(); })} onBlur={() => commit(null)}
    inputMode={NUMERIC.has(f.type) ? "decimal" : f.type === "email" ? "email" : f.type === "url" ? "url" : f.type === "phone" ? "tel" : "text"} aria-label={f.name} />;
}

function LongTextEditor({ f, value, initial, onCommit, onCancel }: EditorProps) {
  const [s, setS] = useState(initial ?? editText(f, value));
  const done = useRef(false);
  const commit = (move: "down" | "right" | null) => { if (done.current) return; done.current = true; onCommit(s === "" ? null : s, move); };
  return (
    <div>
      <textarea autoFocus value={s} onChange={(e) => setS(e.target.value)} onKeyDown={(e) => keys(e, commit, () => { done.current = true; onCancel(); }, true)} onBlur={() => commit(null)} aria-label={f.name} />
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", padding: "2px 8px 6px" }}>⌘/Ctrl + Enter to save · Esc to cancel</div>
    </div>
  );
}

function DateEditor({ f, value, onCommit, onCancel }: EditorProps) {
  const withTime = f.type === "dateTime" || !!f.options.includeTime;
  const init = value ? (withTime ? new Date(String(value)).toISOString().slice(0, 16) : String(value).slice(0, 10)) : "";
  const [s, setS] = useState(init);
  const done = useRef(false);
  const commit = (move: "down" | "right" | null) => { if (done.current) return; done.current = true; onCommit(s ? (withTime ? new Date(s).toISOString() : s) : null, move); };
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <input autoFocus type={withTime ? "datetime-local" : "date"} value={s} onChange={(e) => setS(e.target.value)} onKeyDown={(e) => keys(e, commit, () => { done.current = true; onCancel(); })} onBlur={() => commit(null)} aria-label={f.name} />
      <button type="button" className="g-hmenu" style={{ opacity: 1 }} onMouseDown={(e) => { e.preventDefault(); setS(new Date().toISOString().slice(0, withTime ? 16 : 10)); }}>Today</button>
    </div>
  );
}

function useListKeys<T>(items: T[], pick: (t: T) => void, cancel: () => void) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [items.length]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[active] !== undefined) pick(items[active]); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  };
  return { active, onKeyDown };
}

function SelectEditor({ f, value, initial, canSchema, onCommit, onCancel }: EditorProps) {
  const multi = f.type === "multipleSelects";
  const [q, setQ] = useState(initial ?? "");
  const [choices, setChoices] = useState<SelectChoice[]>(f.options.choices ?? []);
  const [sel, setSel] = useState<string[]>(multi ? ((value as string[]) ?? []) : value ? [String(value)] : []);
  const [err, setErr] = useState("");
  const list = useMemo(() => choices.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())), [choices, q]);
  const exact = choices.some((c) => c.name.toLowerCase() === q.trim().toLowerCase());
  type Item = SelectChoice | { create: string };
  const items: Item[] = [...list, ...(q.trim() && !exact && canSchema ? [{ create: q.trim() }] : [])];
  const choose = async (it: Item) => {
    let id: string;
    if ("create" in it) {
      const c: SelectChoice = { id: newChoiceId(), name: it.create, color: COLORS[choices.length % COLORS.length] };
      const r = await updateFieldAction(f.id, { options: { ...f.options, choices: [...choices, c] } });
      if (!r.ok) { setErr(r.error); return; }
      setChoices((cs) => [...cs, c]); f.options.choices = [...choices, c]; id = c.id; setQ("");
    } else id = it.id;
    if (!multi) { onCommit(id, null); return; }
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const { active, onKeyDown } = useListKeys(items, choose, () => (multi ? onCommit(sel, null) : onCancel()));
  return (
    <div style={{ width: 260 }}>
      <input autoFocus placeholder={canSchema ? "Find or create an option" : "Find an option"} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} aria-label={`${f.name} options`} />
      <div className="g-list" role="listbox" aria-multiselectable={multi}>
        {items.map((it, i) => "create" in it
          ? <div key="__create" className="g-opt" data-active={i === active} onMouseDown={(e) => { e.preventDefault(); choose(it); }}><Plus size={14} /> Add option “{it.create}”</div>
          : <div key={it.id} role="option" aria-selected={sel.includes(it.id)} className="g-opt" data-active={i === active} onMouseDown={(e) => { e.preventDefault(); choose(it); }}>
              <span style={{ width: 14 }}>{sel.includes(it.id) && <Check size={14} />}</span><Chip name={it.name} color={it.color} />
            </div>)}
        {!items.length && <div className="g-opt" style={{ color: "var(--color-text-secondary)" }}>No options</div>}
      </div>
      {err && <div style={{ color: "var(--color-text-error)", fontSize: 12, padding: "4px 8px" }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px 8px", gap: 6 }}>
        <button type="button" className="p-tbtn" onMouseDown={(e) => { e.preventDefault(); onCommit(multi ? [] : null, null); }}>Clear</button>
        {multi && <button type="button" className="p-tbtn on-blue" onMouseDown={(e) => { e.preventDefault(); onCommit(sel, null); }}>Done</button>}
      </div>
    </div>
  );
}

function LinkEditor({ f, value, onCommit, onCancel }: EditorProps) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Ref[]>((value as Ref[]) ?? []);
  const [found, setFound] = useState<Ref[]>([]);
  useEffect(() => {
    const t = setTimeout(async () => { const r = await searchLinkAction(f.options.linkedTableId!, q); if (r.ok) setFound(r.data); }, 150);
    return () => clearTimeout(t);
  }, [q, f.options.linkedTableId]);
  const single = !!f.options.singleRecord;
  const pick = (r: Ref) => {
    if (single) { onCommit([r], null); return; }
    setSel((s) => (s.some((x) => x.id === r.id) ? s.filter((x) => x.id !== r.id) : [...s, r]));
  };
  const { active, onKeyDown } = useListKeys(found, pick, () => onCommit(sel, null));
  return (
    <div style={{ width: 320 }}>
      {!!sel.length && <div className="chips" style={{ flexWrap: "wrap", padding: "8px 8px 0" }}>{sel.map((r) => <span key={r.id} className="chip link">{r.title || "Unnamed"}<button type="button" aria-label={`Remove ${r.title}`} className="g-hmenu" style={{ opacity: 1, padding: 0 }} onMouseDown={(e) => { e.preventDefault(); setSel((s) => s.filter((x) => x.id !== r.id)); }}><X size={10} /></button></span>)}</div>}
      <input autoFocus placeholder="Find a record" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} aria-label={`Link ${f.name}`} />
      <div className="g-list" role="listbox">
        {found.map((r, i) => <div key={r.id} role="option" aria-selected={sel.some((x) => x.id === r.id)} className="g-opt" data-active={i === active} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
          <span style={{ width: 14 }}>{sel.some((x) => x.id === r.id) && <Check size={14} />}</span>{r.title || "Unnamed record"}</div>)}
        {!found.length && <div className="g-opt" style={{ color: "var(--color-text-secondary)" }}>No matching records</div>}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 8px 8px", gap: 6 }}>
        <button type="button" className="p-tbtn" onMouseDown={(e) => { e.preventDefault(); onCancel(); }}>Cancel</button>
        <button type="button" className="p-tbtn on-blue" onMouseDown={(e) => { e.preventDefault(); onCommit(sel, null); }}>Done</button>
      </div>
    </div>
  );
}

function UserEditor({ f, value, collaborators, onCommit, onCancel }: EditorProps) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Ref[]>((value as Ref[]) ?? []);
  const list = collaborators.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  const pick = (c: { id: string; name: string }) => setSel((s) => (s.some((x) => x.id === c.id) ? s.filter((x) => x.id !== c.id) : [...s, c]));
  const { active, onKeyDown } = useListKeys(list, pick, onCancel);
  return (
    <div style={{ width: 260 }}>
      <input autoFocus placeholder="Find a collaborator" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} aria-label={`${f.name} collaborators`} />
      <div className="g-list" role="listbox">
        {list.map((c, i) => <div key={c.id} role="option" aria-selected={sel.some((x) => x.id === c.id)} className="g-opt" data-active={i === active} onMouseDown={(e) => { e.preventDefault(); pick(c); }}>
          <span style={{ width: 14 }}>{sel.some((x) => x.id === c.id) && <Check size={14} />}</span>{c.name}</div>)}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 8px 8px", gap: 6 }}>
        <button type="button" className="p-tbtn on-blue" onMouseDown={(e) => { e.preventDefault(); onCommit(sel, null); }}>Done</button>
      </div>
    </div>
  );
}

type Att = { id: string; filename: string; size: number; type: string };
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Upload, preview, open and remove files. Changes are saved immediately server-side. */
function AttachmentEditor({ f, value, recordId, onCancel, onRefresh }: EditorProps) {
  const [files, setFiles] = useState<Att[]>((value as Att[]) ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const changed = useRef(false);
  const close = () => { onCancel(); if (changed.current) onRefresh?.(); };
  const upload = async (list: FileList | null) => {
    if (!list?.length || !recordId) return;
    setBusy(true); setErr("");
    for (const file of [...list]) {
      const fd = new FormData(); fd.set("file", file); fd.set("recordId", recordId); fd.set("fieldId", f.id);
      const r = await fetch("/api/platform/attachments", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? `Upload failed (${r.status})`); break; }
      setFiles((x) => [...x, j.attachment]); changed.current = true;
    }
    setBusy(false);
  };
  const remove = async (a: Att) => {
    setErr("");
    const r = await fetch(`/api/platform/attachments/${a.id}`, { method: "DELETE" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Couldn't remove the file."); return; }
    setFiles((x) => x.filter((y) => y.id !== a.id)); changed.current = true;
  };
  return (
    <div style={{ width: 340, padding: 8 }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") close(); }}>
      {!recordId && <p style={{ fontSize: 12 }}>Save the record first, then add files.</p>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 240, overflow: "auto" }} aria-label={`${f.name} files`}>
        {files.map((a) => (
          <li key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--color-border)" }}>
            {a.type.startsWith("image/")
              ? <img src={`/api/platform/attachments/${a.id}`} alt="" width={32} height={32} style={{ objectFit: "cover", borderRadius: 4 }} />
              : <Paperclip size={16} aria-hidden />}
            <a href={`/api/platform/attachments/${a.id}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{a.filename}</a>
            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{fmtSize(a.size)}</span>
            <button type="button" className="g-hmenu" style={{ opacity: 1 }} aria-label={`Remove ${a.filename}`} onClick={() => remove(a)}><X size={13} /></button>
          </li>
        ))}
        {!files.length && <li style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "4px 0" }}>No files yet.</li>}
      </ul>
      {err && <p role="alert" style={{ color: "var(--color-text-error)", fontSize: 12, marginTop: 6 }}>{err}</p>}
      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
        <label className="p-tbtn on-blue" style={{ cursor: recordId ? "pointer" : "not-allowed" }}>
          <Plus size={14} />{busy ? "Uploading…" : "Add files"}
          <input type="file" multiple disabled={!recordId || busy} style={{ display: "none" }} aria-label={`Upload to ${f.name}`} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </label>
        <span style={{ flex: 1, fontSize: 11, color: "var(--color-text-secondary)" }}>Up to 25 MB each</span>
        <button type="button" className="p-tbtn" onClick={close}>Done</button>
      </div>
    </div>
  );
}

export function AiCellButton({ onRun }: { onRun: () => void }) {
  return <button type="button" className="g-hmenu" style={{ opacity: 1 }} aria-label="Generate with AI" title="Generate with AI" onClick={(e) => { e.stopPropagation(); onRun(); }}><Sparkles size={13} /></button>;
}
