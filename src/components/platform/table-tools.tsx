"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, Eye, EyeOff, FileSpreadsheet, Database, Link2, Plus, RefreshCw, Search, Sparkles, Table2 } from "lucide-react";
import { FIELD_META, FIELD_TYPES, type FieldType } from "@/lib/platform/fields";
import { FieldIcon } from "./icons";

/** Small anchored popover: closes on outside click and Escape, stays inside the viewport. */
export function Popover({ anchor, onClose, width = 300, children, label }: { anchor: DOMRect; onClose: () => void; width?: number; children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 });
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0; const vw = window.innerWidth; const vh = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.left, vw - width - 8));
    const top = anchor.bottom + 6 + h > vh - 8 ? Math.max(8, anchor.top - h - 6) : anchor.bottom + 6;
    setPos({ left, top });
  }, [anchor, width]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    setTimeout(() => document.addEventListener("mousedown", down), 0); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [onClose]);
  return <div ref={ref} className="tt-pop" role="dialog" aria-label={label} style={{ left: pos.left, top: pos.top, width: Math.min(width, window.innerWidth - 16) }}>{children}</div>;
}

function SearchBox({ value, onChange, placeholder, onEnter }: { value: string; onChange: (v: string) => void; placeholder: string; onEnter?: () => void }) {
  return <label className="tt-search"><Search size={15} aria-hidden /><input autoFocus aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onEnter?.()} /></label>;
}

/** All tables: search, jump, hide/show from the tab bar (per person, this browser), add a table. */
export function TableSwitcher({ anchor, tables, currentId, hidden, onToggleHidden, onPick, onAdd, onClose }: {
  anchor: DOMRect; tables: { id: string; name: string }[]; currentId: string; hidden: Set<string>;
  onToggleHidden: (id: string) => void; onPick: (id: string) => void; onAdd?: (r: DOMRect) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const list = tables.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover anchor={anchor} onClose={onClose} width={340} label="All tables">
      <SearchBox value={q} onChange={setQ} placeholder="Find a table" onEnter={() => list[0] && onPick(list[0].id)} />
      <ul className="tt-list" role="listbox" aria-label="Tables">
        {list.map((t) => (
          <li key={t.id} role="option" aria-selected={t.id === currentId} className={t.id === currentId ? "on" : ""}>
            <button type="button" className="tt-row" onClick={() => onPick(t.id)}><span className="tt-check">{t.id === currentId && <Check size={14} />}</span><span className={hidden.has(t.id) ? "tt-dim" : ""}>{t.name}</span></button>
            <button type="button" className="tt-icon" aria-label={hidden.has(t.id) ? `Show ${t.name} in the tab bar` : `Hide ${t.name} from the tab bar`} title={hidden.has(t.id) ? "Show in tab bar" : "Hide from tab bar"} onClick={() => onToggleHidden(t.id)} disabled={t.id === currentId && !hidden.has(t.id)}>{hidden.has(t.id) ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </li>
        ))}
        {!list.length && <li className="tt-empty">No table matches “{q}”.</li>}
      </ul>
      {onAdd && <button type="button" className="tt-foot" onClick={(e) => onAdd(e.currentTarget.getBoundingClientRect())}><Plus size={15} />Add table<ChevronRight size={15} style={{ marginLeft: "auto" }} /></button>}
    </Popover>
  );
}

/** Where a new table comes from. Only sources that actually work are listed. */
export function AddTableMenu({ anchor, onClose, onBlank, onImport, onSync, onAi, aiConfigured }: { anchor: DOMRect; onClose: () => void; onBlank: () => void; onImport: () => void; onSync: () => void; onAi?: () => void; aiConfigured: boolean }) {
  const item = (icon: React.ReactNode, label: string, run: () => void, note?: string) => <button type="button" className="tt-item" onClick={() => { onClose(); run(); }}>{icon}<span>{label}</span>{note && <em>{note}</em>}</button>;
  return (
    <Popover anchor={anchor} onClose={onClose} width={300} label="Add a table">
      <div className="tt-sect">Add a blank table</div>
      {item(<Table2 size={15} />, "Start from scratch", onBlank)}
      {onAi && <><div className="tt-sect">Build with AI</div>{item(<Sparkles size={15} />, "Describe a new system", onAi, aiConfigured ? undefined : "needs AI key")}</>}
      <div className="tt-sect">Add from other sources</div>
      {item(<FileSpreadsheet size={15} />, "CSV or Excel file", onImport)}
      {item(<RefreshCw size={15} />, "Google Sheets (published CSV link)", onSync, "sync")}
      {item(<Database size={15} />, "Airtable base", onSync, "sync")}
    </Popover>
  );
}

const CATS: [string, FieldType[]][] = [
  ["Standard fields", ["singleLineText", "longText", "attachment", "checkbox", "multipleSelects", "singleSelect", "user", "date", "phone", "email", "url", "number", "currency", "percent", "duration", "rating"]],
  ["Relationships", ["lookup", "rollup", "count"]],
  ["Calculated", ["formula", "autonumber", "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy", "dateTime"]],
  ["Advanced", ["barcode", "button"]],
];

/** Pick a field type first (searchable), then the field dialog opens pre-set to it. */
export function FieldTypePicker({ anchor, onClose, onPick, tables, aiConfigured }: { anchor: DOMRect; onClose: () => void; onPick: (t: FieldType, linkTableId?: string) => void; tables: { id: string; name: string }[]; aiConfigured: boolean }) {
  const [q, setQ] = useState(""); const [linkOpen, setLinkOpen] = useState(false);
  const n = q.trim().toLowerCase();
  const match = (t: FieldType) => !n || `${FIELD_META[t].label} ${FIELD_META[t].description}`.toLowerCase().includes(n);
  const all = FIELD_TYPES.filter(match);
  return (
    <Popover anchor={anchor} onClose={onClose} width={400} label="Add a field">
      <SearchBox value={q} onChange={setQ} placeholder="Find a field type" onEnter={() => all[0] && onPick(all[0])} />
      <div className="tt-scroll">
        {(!n || match("aiText")) && <><div className="tt-sect">AI</div>
          <button type="button" className="tt-item" onClick={() => onPick("aiText")}><Sparkles size={15} /><span>Generate text with AI</span>{!aiConfigured && <em>needs AI key</em>}</button></>}
        {match("link") && <>
          <button type="button" className="tt-item" aria-expanded={linkOpen} onClick={() => setLinkOpen((o) => !o)}><Link2 size={15} /><span>Link to another record</span><ChevronRight size={15} style={{ marginLeft: "auto", transform: linkOpen ? "rotate(90deg)" : undefined }} /></button>
          {linkOpen && <div className="tt-sub">{tables.map((t) => <button key={t.id} type="button" className="tt-item" onClick={() => onPick("link", t.id)}><Table2 size={14} /><span>{t.name}</span></button>)}</div>}
        </>}
        {CATS.map(([cat, types]) => { const ts = types.filter(match); return ts.length ? <div key={cat}><div className="tt-sect">{cat}</div>{ts.map((t) => <button key={t} type="button" className="tt-item" onClick={() => onPick(t)} title={FIELD_META[t].description}><FieldIcon type={t} size={15} /><span>{FIELD_META[t].label}</span></button>)}</div> : null; })}
        {!all.length && <p className="tt-empty">No field type matches “{q}”.</p>}
      </div>
    </Popover>
  );
}
