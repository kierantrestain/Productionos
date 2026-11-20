"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, ImageIcon, Check } from "lucide-react";
import type { ViewConfig } from "@/db/schema";
import { isComputed } from "@/lib/platform/fields";
import { cleanAnswers, formClosed, missingRequired, pagesOf, safeRedirect, visibleItems, type FormItem } from "@/lib/platform/form-logic";
import { CellView, cellText } from "./cells";
import type { ClientField, ClientRow, ClientView } from "./types";

export interface ViewProps {
  view: ClientView; fields: ClientField[]; allFields: ClientField[]; rows: ClientRow[];
  canCreate: boolean; canEdit: boolean;
  onExpand: (id: string) => void; onConfig: (p: ViewConfig) => void;
  onEdit: (cells: { recordId: string; fieldId: string; value: unknown; before?: unknown }[]) => Promise<boolean>;
  onCreate: (values: Record<string, unknown>) => void;
}
const pick: React.CSSProperties = { height: 28, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-background-surface)", color: "var(--color-text-primary)", font: "inherit", fontSize: 13, padding: "0 6px" };
const primaryOf = (fs: ClientField[]) => fs.find((f) => f.isPrimary) ?? fs[0];
const titleOf = (fs: ClientField[], r: ClientRow) => { const p = primaryOf(fs); return (p && cellText(p, r.values[p.id])) || "Unnamed record"; };
const DATE_T = ["date", "dateTime", "createdTime", "lastModifiedTime"];
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const asDay = (v: unknown) => (v ? String(v).slice(0, 10) : null);

function Setting({ label, value, options, onChange, empty }: { label: string; value?: string; options: ClientField[]; onChange: (id: string) => void; empty: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--color-border)", fontSize: 13 }}>
      <span style={{ color: "var(--color-text-secondary)" }}>{label}</span>
      {options.length ? <select aria-label={label} style={pick} value={value ?? ""} onChange={(e) => onChange(e.target.value)}><option value="" disabled>Choose…</option>{options.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        : <span style={{ color: "var(--color-text-secondary)" }}>{empty}</span>}
    </div>
  );
}

function CardFields({ fields, row, skip }: { fields: ClientField[]; row: ClientRow; skip?: string[] }) {
  return <>{fields.filter((f) => !f.isPrimary && !skip?.includes(f.id)).slice(0, 5).map((f) => {
    const v = row.values[f.id];
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return null;
    return <div key={f.id} className="kf"><div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>{f.name}</div><div style={{ color: "var(--color-text-primary)", display: "flex", overflow: "hidden" }}><CellView f={f} v={v} /></div></div>;
  })}</>;
}

// ───────── Kanban ─────────
export function KanbanView(p: ViewProps) {
  const options = p.allFields.filter((f) => f.type === "singleSelect");
  const kf = p.allFields.find((f) => f.id === p.view.config.kanbanFieldId) ?? options[0];
  const [over, setOver] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  if (!kf) return <Setting label="Stack by" options={[]} onChange={() => {}} empty="Add a single select field to use a kanban board." />;
  const cols = [{ id: "", name: "Uncategorised", color: "gray" }, ...(kf.options.choices ?? [])];
  const editable = p.canEdit && kf.editable;
  return (
    <>
      <Setting label="Stack by" value={kf.id} options={options} onChange={(id) => p.onConfig({ kanbanFieldId: id })} empty="" />
      <div className="k-board">
        {cols.map((c) => {
          const rows = p.rows.filter((r) => (r.values[kf.id] ?? "") === c.id);
          if (!c.id && !rows.length) return null;
          return (
            <section key={c.id || "none"} className="k-col" data-drop={over === c.id} aria-label={c.name}
              onDragOver={(e) => { if (editable) { e.preventDefault(); setOver(c.id); } }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const r = p.rows.find((x) => x.id === dragId); if (r && (r.values[kf.id] ?? "") !== c.id) p.onEdit([{ recordId: r.id, fieldId: kf.id, value: c.id || null, before: r.values[kf.id] ?? null }]); }}>
              <header style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 4px 8px" }}><span className={`chip ${c.color}`}>{c.name}</span><span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{rows.length}</span></header>
              <div className="k-cards">
                {rows.map((r) => (
                  <article key={r.id} className="k-card" draggable={editable} onDragStart={() => setDragId(r.id)} onClick={() => p.onExpand(r.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && p.onExpand(r.id)}
                    style={r.color ? { borderLeft: `4px solid`, borderLeftColor: `var(--color-text-${r.color})` } : undefined}>
                    <div style={{ fontWeight: 600 }}>{titleOf(p.allFields, r)}</div>
                    <CardFields fields={p.fields} row={r} skip={[kf.id]} />
                  </article>
                ))}
              </div>
              {p.canCreate && <button type="button" className="p-tbtn" style={{ marginTop: 6 }} onClick={() => p.onCreate(c.id ? { [kf.id]: c.id } : {})}><Plus size={14} />Add record</button>}
            </section>
          );
        })}
      </div>
    </>
  );
}

// ───────── Calendar ─────────
export function CalendarView(p: ViewProps) {
  const options = p.allFields.filter((f) => DATE_T.includes(f.type));
  const df = p.allFields.find((f) => f.id === p.view.config.dateFieldId) ?? options[0];
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const byDay = useMemo(() => { const m = new Map<string, ClientRow[]>(); if (df) for (const r of p.rows) { const k = asDay(r.values[df.id]); if (k) m.set(k, [...(m.get(k) ?? []), r]); } return m; }, [p.rows, df]);
  if (!df) return <Setting label="Date field" options={[]} onChange={() => {}} empty="Add a date field to use a calendar." />;
  const start = new Date(month); start.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const today = dayKey(new Date());
  const editable = p.canEdit && df.editable && !isComputed(df.type);
  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
        <button type="button" className="p-tbtn" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
        <button type="button" className="p-tbtn" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
        <button type="button" className="p-tbtn" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
        <strong style={{ fontSize: 15 }}>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</strong>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Date field</span>
        <select aria-label="Date field" style={pick} value={df.id} onChange={(e) => p.onConfig({ dateFieldId: e.target.value })}>{options.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      </div>
      <div className="cal" role="grid" aria-label="Calendar">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="dow">{d}</div>)}
        {days.map((d) => {
          const k = dayKey(d); const evs = byDay.get(k) ?? [];
          return (
            <div key={k} role="gridcell" className={`day ${d.getMonth() !== month.getMonth() ? "other" : ""} ${k === today ? "today" : ""}`} data-drop={over === k}
              onDragOver={(e) => { if (editable) { e.preventDefault(); setOver(k); } }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const r = p.rows.find((x) => x.id === dragId); if (r) { const before = r.values[df.id]; const v = df.type === "dateTime" || df.options.includeTime ? `${k}${String(before ?? "T09:00:00.000Z").slice(10) || "T09:00:00.000Z"}` : k; p.onEdit([{ recordId: r.id, fieldId: df.id, value: v, before }]); } }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span className="dn">{d.getDate()}</span><span style={{ flex: 1 }} />
                {p.canCreate && editable && <button type="button" className="g-hmenu" aria-label={`Add record on ${k}`} onClick={() => p.onCreate({ [df.id]: k })}><Plus size={12} /></button>}
              </div>
              {evs.slice(0, 4).map((r) => <button key={r.id} type="button" className={`ev ${r.color ? `chip ${r.color}` : ""}`} draggable={editable} onDragStart={() => setDragId(r.id)} onClick={() => p.onExpand(r.id)}>{titleOf(p.allFields, r)}</button>)}
              {evs.length > 4 && <div style={{ fontSize: 11, color: "var(--color-text-secondary)", padding: "0 6px" }}>+{evs.length - 4} more</div>}
            </div>
          );
        })}
      </div>
      {(() => { const undated = p.rows.filter((r) => !r.values[df.id]).length; return undated ? <div style={{ padding: "6px 12px", fontSize: 12, color: "var(--color-text-secondary)", borderTop: "1px solid var(--color-border)" }}>{undated} record{undated > 1 ? "s" : ""} without a {df.name.toLowerCase()} — not shown.</div> : null; })()}
    </>
  );
}

// ───────── Gallery ─────────
export function GalleryView(p: ViewProps) {
  const covers = p.allFields.filter((f) => f.type === "attachment" || f.type === "url");
  const cf = p.allFields.find((f) => f.id === p.view.config.coverFieldId);
  const coverUrl = (r: ClientRow) => {
    if (!cf) return null; const v = r.values[cf.id];
    if (cf.type === "url" && typeof v === "string" && /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(v)) return v;
    if (cf.type === "attachment" && Array.isArray(v)) { const a = (v as { id: string; type: string }[]).find((x) => x.type?.startsWith("image/")); return a ? `/api/platform/attachments/${a.id}` : null; }
    return null;
  };
  return (
    <>
      {covers.length > 0 && <Setting label="Cover" value={cf?.id} options={covers} onChange={(id) => p.onConfig({ coverFieldId: id })} empty="" />}
      <div className="gal">
        {p.rows.map((r) => { const src = coverUrl(r); return (
          <article key={r.id} className="gal-card" onClick={() => p.onExpand(r.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && p.onExpand(r.id)}>
            <div className="gal-cover">{src ? <img src={src} alt="" loading="lazy" /> : <ImageIcon size={28} strokeWidth={1.4} />}</div>
            <div style={{ padding: 12 }}><div style={{ fontWeight: 600, marginBottom: 4 }}>{titleOf(p.allFields, r)}</div><CardFields fields={p.fields} row={r} /></div>
          </article>
        ); })}
        {p.canCreate && <button type="button" className="gal-card" style={{ minHeight: 200, display: "grid", placeItems: "center", color: "var(--color-text-secondary)", font: "inherit" }} onClick={() => p.onCreate({})}><span><Plus size={18} /> Add record</span></button>}
      </div>
    </>
  );
}

// ───────── Timeline ─────────
export function TimelineView(p: ViewProps) {
  const options = p.allFields.filter((f) => DATE_T.includes(f.type));
  const sf = p.allFields.find((f) => f.id === p.view.config.dateFieldId) ?? options[0];
  const ef = p.allFields.find((f) => f.id === p.view.config.endDateFieldId);
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); return d; });
  const DAYS = 42, DW = 36;
  if (!sf) return <Setting label="Start date" options={[]} onChange={() => {}} empty="Add a date field to use a timeline." />;
  const toX = (v: unknown) => { const d = new Date(`${asDay(v)}T00:00:00`); return Math.round((d.getTime() - from.getTime()) / 864e5); };
  const rows = p.rows.filter((r) => r.values[sf.id]);
  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--color-border)", fontSize: 13, flexWrap: "wrap" }}>
        <button type="button" className="p-tbtn" aria-label="Earlier" onClick={() => setFrom(new Date(from.getTime() - 14 * 864e5))}><ChevronLeft size={16} /></button>
        <button type="button" className="p-tbtn" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); setFrom(d); }}>Today</button>
        <button type="button" className="p-tbtn" aria-label="Later" onClick={() => setFrom(new Date(from.getTime() + 14 * 864e5))}><ChevronRight size={16} /></button>
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--color-text-secondary)" }}>Start</span>
        <select aria-label="Start date field" style={pick} value={sf.id} onChange={(e) => p.onConfig({ dateFieldId: e.target.value })}>{options.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <span style={{ color: "var(--color-text-secondary)" }}>End</span>
        <select aria-label="End date field" style={pick} value={ef?.id ?? ""} onChange={(e) => p.onConfig({ endDateFieldId: e.target.value || undefined })}><option value="">(single day)</option>{options.filter((f) => f.id !== sf.id).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      </div>
      <div className="tl">
        <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 2, background: "var(--color-background-muted)", borderBottom: "1px solid var(--color-border)" }}>
          <div className="tl-label" style={{ background: "var(--color-background-muted)", fontWeight: 600, fontSize: 12 }}>{primaryOf(p.allFields)?.name}</div>
          {Array.from({ length: DAYS }, (_, i) => { const d = new Date(from.getTime() + i * 864e5); const t = dayKey(d) === dayKey(new Date()); return <div key={i} style={{ width: DW, flex: "none", textAlign: "center", fontSize: 10, padding: "4px 0", color: t ? "var(--color-accent)" : "var(--color-text-secondary)", fontWeight: t ? 700 : 400, borderLeft: d.getDay() === 1 ? "1px solid var(--color-border)" : undefined }}>{d.getDate() === 1 || i === 0 ? d.toLocaleDateString("en-GB", { month: "short" }) : ""}<br />{d.getDate()}</div>; })}
        </div>
        {rows.map((r) => {
          const x0 = toX(r.values[sf.id]); const x1 = ef && r.values[ef.id] ? Math.max(x0, toX(r.values[ef.id])) : x0;
          const visible = x1 >= 0 && x0 < DAYS;
          return (
            <div key={r.id} className="tl-row" style={{ position: "relative" }}>
              <div className="tl-label" role="button" tabIndex={0} onClick={() => p.onExpand(r.id)} style={{ cursor: "pointer" }}>{titleOf(p.allFields, r)}</div>
              <div style={{ position: "relative", width: DAYS * DW, height: "100%" }}>
                {visible && <div className="tl-bar" style={{ left: Math.max(0, x0) * DW + 2, width: (Math.min(DAYS - 1, x1) - Math.max(0, x0) + 1) * DW - 4, background: r.color ? `var(--color-text-${r.color})` : undefined }} onClick={() => p.onExpand(r.id)}>{titleOf(p.allFields, r)}</div>}
              </div>
            </div>
          );
        })}
        {!rows.length && <p style={{ padding: 16, color: "var(--color-text-secondary)" }}>No records have a {sf.name.toLowerCase()} yet.</p>}
      </div>
    </>
  );
}

// ───────── List ─────────
export function ListView(p: ViewProps) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
      {p.rows.map((r) => (
        <div key={r.id} role="button" tabIndex={0} onClick={() => p.onExpand(r.id)} onKeyDown={(e) => e.key === "Enter" && p.onExpand(r.id)}
          style={{ display: "flex", gap: 16, alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--color-border)", cursor: "pointer", borderLeft: r.color ? `4px solid var(--color-text-${r.color})` : "4px solid transparent" }}>
          {p.fields.find((f) => f.type === "checkbox") && (() => { const cf = p.fields.find((f) => f.type === "checkbox")!; const on = !!r.values[cf.id]; return <button type="button" aria-label={cf.name} className={`cbx ${on ? "on" : ""}`} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); if (p.canEdit && cf.editable) p.onEdit([{ recordId: r.id, fieldId: cf.id, value: !on, before: on }]); }}>{on && <Check size={12} strokeWidth={3} />}</button>; })()}
          <span style={{ fontWeight: 600, minWidth: 200, flex: "0 0 auto" }}>{titleOf(p.allFields, r)}</span>
          <span style={{ display: "flex", gap: 12, overflow: "hidden", color: "var(--color-text-secondary)", fontSize: 13 }}>
            {p.fields.filter((f) => !f.isPrimary && f.type !== "checkbox").slice(0, 5).map((f) => <span key={f.id} style={{ display: "flex", maxWidth: 220, overflow: "hidden" }}><CellView f={f} v={r.values[f.id]} /></span>)}
          </span>
        </div>
      ))}
      {p.canCreate && <button type="button" className="p-tbtn" style={{ margin: 12 }} onClick={() => p.onCreate({})}><Plus size={14} />Add record</button>}
    </div>
  );
}

// ───────── Form ─────────
type FormCfg = NonNullable<ViewConfig["form"]>;
type Item = NonNullable<FormCfg["fields"]>[number];

/** Form builder: question list (order, add/remove), per-question settings and logic, form settings, live preview. */
export function FormView(p: ViewProps & { onSubmit: (values: Record<string, unknown>) => Promise<string | null>; color: string }) {
  const cfg = p.view.config.form ?? {};
  const inputs = p.allFields.filter((f) => !isComputed(f.type) && f.editable && !["aiText", "button", "link", "user"].includes(f.type));
  const chosen: Item[] = (cfg.fields?.length ? cfg.fields : inputs.slice(0, 8).map((f) => ({ fieldId: f.id, required: f.isPrimary }))).filter((x) => inputs.some((f) => f.id === x.fieldId));
  const editing = p.view.canEdit;
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"questions" | "settings">("questions");
  const setCfg = (patch: Partial<FormCfg>) => p.onConfig({ form: { ...cfg, fields: chosen, ...patch } });
  const setItem = (id: string, patch: Partial<Item>) => setCfg({ fields: chosen.map((c) => (c.fieldId === id ? { ...c, ...patch } : c)) });
  const move = (i: number, d: number) => { const n = [...chosen]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setCfg({ fields: n }); };
  const unused = inputs.filter((f) => !chosen.some((c) => c.fieldId === f.id));
  const name = (id: string) => inputs.find((f) => f.id === id)?.name ?? "?";
  const closed = formClosed(cfg);
  return (
    <div className="fb-wrap">
      {editing && (
        <aside className="fb-side" aria-label="Form builder">
          <div className="fb-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "questions"} className={tab === "questions" ? "on" : ""} onClick={() => setTab("questions")}>Questions</button>
            <button type="button" role="tab" aria-selected={tab === "settings"} className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>Settings</button>
          </div>
          {tab === "questions" ? <>
            <ol className="fb-list">
              {chosen.map((c, i) => { const f = inputs.find((x) => x.id === c.fieldId)!; const isOpen = open === c.fieldId; return (
                <li key={c.fieldId} className={isOpen ? "open" : ""}>
                  {c.pageBreak && i > 0 && <div className="fb-break">Page break</div>}
                  <div className="fb-row">
                    <button type="button" className="fb-name" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.fieldId)}>{c.label || f.name}{c.required && <span className="fb-req">*</span>}{c.showIf && <span className="fb-tag">logic</span>}</button>
                    <button type="button" className="fb-ic" aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="fb-ic" aria-label={`Move ${f.name} down`} disabled={i === chosen.length - 1} onClick={() => move(i, 1)}>↓</button>
                    <button type="button" className="fb-ic" aria-label={`Remove ${f.name} from the form`} onClick={() => setCfg({ fields: chosen.filter((x) => x.fieldId !== c.fieldId) })}>×</button>
                  </div>
                  {isOpen && (
                    <div className="fb-edit">
                      <label>Question<input className="ui-input" defaultValue={c.label ?? ""} placeholder={f.name} onBlur={(e) => setItem(c.fieldId, { label: e.target.value || undefined })} /></label>
                      <label>Help text<input className="ui-input" defaultValue={c.help ?? ""} placeholder={f.description ?? "Optional guidance"} onBlur={(e) => setItem(c.fieldId, { help: e.target.value || undefined })} /></label>
                      {!["checkbox", "singleSelect", "multipleSelects", "rating"].includes(f.type) && <label>Placeholder<input className="ui-input" defaultValue={c.placeholder ?? ""} onBlur={(e) => setItem(c.fieldId, { placeholder: e.target.value || undefined })} /></label>}
                      <label className="fb-check"><input type="checkbox" checked={!!c.required} onChange={(e) => setItem(c.fieldId, { required: e.target.checked })} /> Required</label>
                      {i > 0 && <label className="fb-check"><input type="checkbox" checked={!!c.pageBreak} onChange={(e) => setItem(c.fieldId, { pageBreak: e.target.checked })} /> Start a new page here</label>}
                      {i > 0 && <fieldset className="fb-logic"><legend>Only show when…</legend>
                        <select className="ui-input" aria-label="Condition question" value={c.showIf?.fieldId ?? ""} onChange={(e) => setItem(c.fieldId, { showIf: e.target.value ? { fieldId: e.target.value, op: "isNotEmpty" } : undefined })}>
                          <option value="">Always show</option>{chosen.slice(0, i).map((x) => <option key={x.fieldId} value={x.fieldId}>{x.label || name(x.fieldId)}</option>)}
                        </select>
                        {c.showIf && (() => { const src = inputs.find((x) => x.id === c.showIf!.fieldId); const sel = src?.type === "singleSelect" || src?.type === "multipleSelects"; return <>
                          <select className="ui-input" aria-label="Condition" value={c.showIf.op} onChange={(e) => setItem(c.fieldId, { showIf: { ...c.showIf!, op: e.target.value as "is" } })}>
                            <option value="isNotEmpty">is answered</option><option value="isEmpty">is not answered</option>{src?.type === "checkbox" && <option value="isChecked">is ticked</option>}<option value="is">is</option><option value="isNot">is not</option>
                          </select>
                          {(c.showIf.op === "is" || c.showIf.op === "isNot") && (sel ? <select className="ui-input" aria-label="Value" value={c.showIf.value ?? ""} onChange={(e) => setItem(c.fieldId, { showIf: { ...c.showIf!, value: e.target.value } })}><option value="">Choose…</option>{src!.options.choices?.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}</select>
                            : <input className="ui-input" aria-label="Value" defaultValue={c.showIf.value ?? ""} onBlur={(e) => setItem(c.fieldId, { showIf: { ...c.showIf!, value: e.target.value } })} />)}
                        </>; })()}
                      </fieldset>}
                    </div>
                  )}
                </li>
              ); })}
            </ol>
            {unused.length > 0 && <><div className="p-sect" style={{ padding: "12px 2px 6px" }}>Add a question</div>
              <div className="fb-add">{unused.map((f) => <button key={f.id} type="button" className="p-tbtn" onClick={() => { setCfg({ fields: [...chosen, { fieldId: f.id }] }); setOpen(f.id); }}><Plus size={13} />{f.name}</button>)}</div></>}
            <p className="fb-note">Linked records and people can&apos;t be collected on public forms, so they aren&apos;t listed. File questions accept up to 5 files of 10 MB on the public link. Pre-fill a link with <code>?prefill_Field+name=value</code>.</p>
          </> : (
            <div className="fb-settings">
              <label>Submit button<input className="ui-input" defaultValue={cfg.submitLabel ?? ""} placeholder="Submit" onBlur={(e) => setCfg({ submitLabel: e.target.value || undefined })} /></label>
              <label>Thank-you message<textarea className="ui-input" rows={3} defaultValue={cfg.successMessage ?? ""} placeholder="Your response has been recorded." onBlur={(e) => setCfg({ successMessage: e.target.value || undefined })} /></label>
              <label>After submitting, go to (optional)<input className="ui-input" type="url" defaultValue={cfg.redirectUrl ?? ""} placeholder="https://…" onBlur={(e) => setCfg({ redirectUrl: e.target.value || undefined })} />{cfg.redirectUrl && !safeRedirect(cfg.redirectUrl) && <small style={{ color: "#d93025" }}>Must start with http:// or https://</small>}</label>
              <label className="fb-check"><input type="checkbox" checked={cfg.allowAnother !== false} onChange={(e) => setCfg({ allowAnother: e.target.checked })} /> Show “Submit another response”</label>
              <label className="fb-check"><input type="checkbox" checked={!!cfg.closed} onChange={(e) => setCfg({ closed: e.target.checked })} /> Close the form now</label>
              <label>Close automatically on<input className="ui-input" type="datetime-local" defaultValue={cfg.closesAt?.slice(0, 16) ?? ""} onBlur={(e) => setCfg({ closesAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></label>
              <p className="fb-note">{closed ? "This form is closed: the public link shows a closed message and submissions are refused." : "Open: share the public link from “Share & export”. Submissions arrive as new records and can trigger automations (“When a form is submitted”)."}</p>
            </div>
          )}
        </aside>
      )}
      <div className="form-page">
        {closed && <div className="fb-closed" role="status">This form is closed. People with the link see a closed message.</div>}
        <div className="form-card">
          <div className="form-band" style={{ background: `var(--color-text-${p.color})` }} />
          <FormBody title={cfg.title ?? p.view.name} description={cfg.description} fields={chosen.map((c) => ({ ...c, f: inputs.find((f) => f.id === c.fieldId)! }))}
            submitLabel={cfg.submitLabel} successMessage={cfg.successMessage} allowAnother={cfg.allowAnother !== false} onSubmit={p.onSubmit}
            onTitle={editing ? (t) => setCfg({ title: t }) : undefined} onDescription={editing ? (d) => setCfg({ description: d }) : undefined} />
        </div>
      </div>
    </div>
  );
}

export type FormField = Item & { f: ClientField };
/** Shared by the in-app form view and the public form page: pages, progress, conditional questions, validation. */
export function FormBody({ title, description, fields, submitLabel, successMessage, onSubmit, onTitle, onDescription, initial, redirectUrl, allowAnother = true, uploadUrl }: {
  title: string; description?: string; fields: FormField[]; submitLabel?: string; successMessage?: string;
  onSubmit: (values: Record<string, unknown>) => Promise<string | null>;
  onTitle?: (t: string) => void; onDescription?: (d: string) => void; onRequired?: (id: string, req: boolean) => void;
  initial?: Record<string, unknown>; redirectUrl?: string; allowAnother?: boolean; uploadUrl?: string;
}) {
  const [vals, setVals] = useState<Record<string, unknown>>(initial ?? {});
  const [err, setErr] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const items = fields as FormItem[];
  const shown = visibleItems(items, vals);
  const pages = pagesOf(items).map((pg) => pg.filter((it) => shown.has(it.fieldId))).filter((pg) => pg.length);
  const cur = Math.min(page, Math.max(0, pages.length - 1));
  const last = cur >= pages.length - 1;
  const inp: React.CSSProperties = { width: "100%", minHeight: 40, border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-background-surface)", color: "var(--color-text-primary)", font: "inherit", padding: "8px 12px", boxSizing: "border-box" };
  const label = (it: FormField) => it.label || it.f.name;
  if (done) return (
    <div style={{ padding: 40, textAlign: "center" }} role="status">
      <div className="fb-done" aria-hidden><Check size={26} /></div>
      <h2 style={{ fontSize: 22, fontWeight: 700, margin: "12px 0 8px" }}>Thank you</h2><p style={{ whiteSpace: "pre-wrap" }}>{successMessage || "Your response has been recorded."}</p>
      {allowAnother && <button type="button" className="p-tbtn" style={{ marginTop: 16 }} onClick={() => { setVals(initial ?? {}); setPage(0); setDone(false); }}>Submit another response</button>}
    </div>
  );
  const check = (pg: FormItem[]) => { const m = missingRequired(pg, vals, shown); if (m.length) { setErr(`Please answer: ${m.map((x) => label(fields.find((f) => f.fieldId === x.fieldId)!)).join(", ")}`); document.getElementById(`ff-${m[0].fieldId}`)?.focus(); return false; } setErr(""); return true; };
  return (
    <form style={{ padding: 28 }} noValidate onSubmit={async (e) => {
      e.preventDefault();
      if (!last) { if (check(pages[cur] ?? [])) setPage(cur + 1); return; }
      if (!check(items)) return;
      setBusy(true); const r = await onSubmit(cleanAnswers(items, vals)); setBusy(false);
      if (r) { setErr(r); return; }
      const go = safeRedirect(redirectUrl); if (go) { window.location.href = go; return; }
      setDone(true);
    }}>
      {onTitle ? <input aria-label="Form title" defaultValue={title} onBlur={(e) => e.target.value !== title && onTitle(e.target.value)} style={{ fontSize: 24, fontWeight: 700, border: 0, background: "transparent", color: "inherit", width: "100%", marginBottom: 6 }} />
        : <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>{title}</h1>}
      {onDescription ? <textarea aria-label="Form description" className="p-textarea" rows={2} defaultValue={description ?? ""} placeholder="Add a description" onBlur={(e) => e.target.value !== (description ?? "") && onDescription(e.target.value)} style={{ marginBottom: 16 }} />
        : description && cur === 0 ? <p style={{ color: "var(--color-text-secondary)", marginBottom: 16, whiteSpace: "pre-wrap" }}>{description}</p> : null}
      {pages.length > 1 && <div className="fb-progress" aria-label={`Page ${cur + 1} of ${pages.length}`}><span style={{ width: `${((cur + 1) / pages.length) * 100}%` }} /><small>Page {cur + 1} of {pages.length}</small></div>}
      {(pages[cur] ?? []).map((it) => { const ff = fields.find((x) => x.fieldId === it.fieldId)!; return (
        <div key={it.fieldId} style={{ marginBottom: 20 }}>
          <label htmlFor={`ff-${it.fieldId}`} style={{ display: "flex", gap: 6, fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{label(ff)}{ff.required && <span style={{ color: "var(--color-text-red)" }} aria-label="required">*</span>}</label>
          {(ff.help || ff.f.description) && <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 6 }}>{ff.help || ff.f.description}</div>}
          <FormInput id={`ff-${it.fieldId}`} f={ff.f} value={vals[it.fieldId]} placeholder={ff.placeholder} uploadUrl={uploadUrl} onChange={(v) => setVals((s) => ({ ...s, [it.fieldId]: v }))} style={inp} />
        </div>
      ); })}
      {!pages.length && <p style={{ color: "var(--color-text-secondary)" }}>This form has no questions yet.</p>}
      {err && <p role="alert" style={{ color: "var(--color-text-error)", marginBottom: 12 }}>{err}</p>}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {cur > 0 && <button type="button" className="p-tbtn" style={{ height: 40, padding: "0 16px" }} onClick={() => { setErr(""); setPage(cur - 1); }}><ChevronLeft size={15} />Back</button>}
        <button type="submit" disabled={busy || !pages.length} style={{ height: 42, padding: "0 22px", borderRadius: 8, border: 0, background: "var(--color-accent)", color: "#fff", font: "inherit", fontWeight: 600, cursor: "pointer" }}>{busy ? "Submitting…" : last ? submitLabel || "Submit" : <>Next <ChevronRight size={15} style={{ verticalAlign: -3 }} /></>}</button>
      </div>
    </form>
  );
}

function FormInput({ id, f, value, onChange, style, placeholder, uploadUrl }: { id: string; f: ClientField; value: unknown; onChange: (v: unknown) => void; style: React.CSSProperties; placeholder?: string; uploadUrl?: string }) {
  const ph = placeholder ? { placeholder } : {};
  switch (f.type) {
    case "attachment": return <FileQuestion id={id} fieldId={f.id} value={value} onChange={onChange} uploadUrl={uploadUrl} />;
    case "longText": return <textarea id={id} rows={4} style={style} {...ph} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "checkbox": return <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case "singleSelect": return <select id={id} style={style} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)}><option value="">Choose…</option>{f.options.choices?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
    case "multipleSelects": { const cur = (value as string[]) ?? []; return <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{f.options.choices?.map((c) => <label key={c.id} className={`chip ${c.color}`} style={{ cursor: "pointer" }}><input type="checkbox" checked={cur.includes(c.id)} onChange={() => onChange(cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id])} /> {c.name}</label>)}</div>; }
    case "date": return <input id={id} type={f.options.includeTime ? "datetime-local" : "date"} style={style} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "dateTime": return <input id={id} type="datetime-local" style={style} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "rating": { const max = f.options.max ?? 5; return <span className="stars" style={{ fontSize: 22, cursor: "pointer" }}>{Array.from({ length: max }, (_, i) => <span key={i} role="button" aria-label={`${i + 1} stars`} tabIndex={0} className={i < Number(value ?? 0) ? "" : "off"} onClick={() => onChange(i + 1)}>★</span>)}</span>; }
    case "number": case "currency": case "percent": case "duration": return <input id={id} inputMode="decimal" style={style} {...ph} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "email": return <input id={id} type="email" style={style} {...ph} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "url": return <input id={id} type="url" style={style} {...ph} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "phone": return <input id={id} type="tel" style={style} {...ph} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "link": case "user": return <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Linked records can be added after submission.</p>;
    default: return <input id={id} style={style} {...ph} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}

type UploadedFile = { id: string; filename: string; size: number; type: string };
/** File question on public forms: uploads immediately, attaches on submit. */
function FileQuestion({ id, fieldId, value, onChange, uploadUrl }: { id: string; fieldId: string; value: unknown; onChange: (v: unknown) => void; uploadUrl?: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const files = (value as UploadedFile[] | undefined) ?? [];
  if (!uploadUrl) return <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>People answering through the shared link can upload files here (up to 5, 10 MB each).</p>;
  return (
    <div>
      <input id={id} type="file" multiple disabled={busy || files.length >= 5} onChange={async (e) => {
        const list = [...(e.target.files ?? [])].slice(0, 5 - files.length); e.target.value = ""; setErr(""); setBusy(true);
        const added: UploadedFile[] = [];
        for (const file of list) {
          const fd = new FormData(); fd.append("file", file); fd.append("fieldId", fieldId);
          const r = await fetch(uploadUrl, { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({ error: "Upload failed. Check your connection." }));
          if (r.attachment) added.push(r.attachment); else { setErr(`${file.name}: ${r.error ?? "upload failed"}`); break; }
        }
        setBusy(false); if (added.length) onChange([...files, ...added]);
      }} />
      {busy && <span role="status" style={{ fontSize: 12, marginLeft: 8 }}>Uploading…</span>}
      {err && <p role="alert" style={{ color: "var(--color-text-error)", fontSize: 12, margin: "4px 0 0" }}>{err}</p>}
      {files.length > 0 && <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 4 }}>{files.map((x) => <li key={x.id} style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "center" }}><Check size={14} color="#15803d" />{x.filename}<span style={{ color: "var(--color-text-secondary)" }}>{Math.max(1, Math.round(x.size / 1024))} KB</span><button type="button" className="p-tbtn" aria-label={`Remove ${x.filename}`} onClick={() => onChange(files.filter((y) => y.id !== x.id))}>Remove</button></li>)}</ul>}
    </div>
  );
}
