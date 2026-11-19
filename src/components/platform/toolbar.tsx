"use client";
import { useState } from "react";
import { Popover } from "@astryxdesign/core/Popover";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { EyeOff, Filter, Layers, ArrowUpDown, PaintBucket, Rows3, Share2, Search, X, Plus, Sparkles, Trash2, Download, Lock, Menu } from "lucide-react";
import type { ViewConfig } from "@/db/schema";
import { COLORS, operatorsFor } from "@/lib/platform/fields";
import { aiFilterAction } from "@/app/platform-actions";
import { FieldIcon, VIEW_ICONS } from "./icons";
import type { ClientField, ClientView } from "./types";

type Cond = { fieldId: string; op: string; value?: unknown };
const DATE_T = ["date", "dateTime", "createdTime", "lastModifiedTime"];

function Btn({ icon, label, on, tone }: { icon: React.ReactNode; label: string; on?: boolean; tone?: string }) {
  return <button type="button" className={`p-tbtn ${on ? `on-${tone}` : ""}`}>{icon}<span className="p-tlabel">{label}</span></button>;
}
const rowStyle: React.CSSProperties = { display: "flex", gap: 6, alignItems: "center", marginBottom: 6 };
const sel: React.CSSProperties = { height: 30, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-background-surface)", color: "var(--color-text-primary)", font: "inherit", fontSize: 13, padding: "0 6px", minWidth: 0 };

export function ValueInput({ f, op, value, onChange }: { f: ClientField; op: string; value: unknown; onChange: (v: unknown) => void }) {
  const need = operatorsFor(f.type).find((o) => o.op === op)?.needsValue;
  if (!need) return <span style={{ flex: 1 }} />;
  if (f.type === "singleSelect" || f.type === "multipleSelects") {
    const multi = ["isAnyOf", "isNoneOf", "hasAnyOf", "hasAllOf", "hasNoneOf"].includes(op);
    if (multi) {
      const cur = Array.isArray(value) ? (value as string[]) : [];
      return <select multiple aria-label="Values" style={{ ...sel, flex: 1, height: 64 }} value={cur} onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}>{f.options.choices?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
    }
    return <select aria-label="Value" style={{ ...sel, flex: 1 }} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}><option value="">Select…</option>{f.options.choices?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
  }
  if (DATE_T.includes(f.type) && !op.startsWith("isWithin")) return <input type="date" aria-label="Date" style={{ ...sel, flex: 1 }} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  return <input aria-label="Value" style={{ ...sel, flex: 1 }} value={String(value ?? "")} placeholder={op.startsWith("isWithin") ? "days" : "Enter a value"} onChange={(e) => onChange(e.target.value)} />;
}

export function ConditionList({ fields, conds, onChange }: { fields: ClientField[]; conds: Cond[]; onChange: (c: Cond[]) => void }) {
  return <>{conds.map((c, i) => {
    const f = fields.find((x) => x.id === c.fieldId) ?? fields[0];
    return (
      <div key={i} style={rowStyle}>
        <select aria-label="Field" style={{ ...sel, width: 130 }} value={f.id} onChange={(e) => { const nf = fields.find((x) => x.id === e.target.value)!; onChange(conds.map((x, j) => (j === i ? { fieldId: nf.id, op: operatorsFor(nf.type)[0].op } : x))); }}>{fields.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select aria-label="Operator" style={{ ...sel, width: 120 }} value={c.op} onChange={(e) => onChange(conds.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))}>{operatorsFor(f.type).map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</select>
        <ValueInput f={f} op={c.op} value={c.value} onChange={(v) => onChange(conds.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
        <button type="button" className="p-tbtn" aria-label="Remove condition" onClick={() => onChange(conds.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
      </div>
    );
  })}</>;
}

export interface ToolbarProps {
  view: ClientView; fields: ClientField[]; allFields: ClientField[]; search: string; aiConfigured: boolean;
  onSearch: (s: string) => void; onConfig: (p: ViewConfig) => void; onToggleSidebar: () => void;
  onExport: (fmt: "csv" | "json" | "xml" | "xlsx") => void; onShare: () => void; onLock: () => void; canLock: boolean;
  notify: (m: string) => void;
}

export function Toolbar(p: ToolbarProps) {
  const c = p.view.config;
  const all = p.allFields;
  const filters = c.filters?.conditions ?? [];
  const hidden = new Set(c.hidden ?? []);
  const [aiQ, setAiQ] = useState(""); const [aiBusy, setAiBusy] = useState(false); const [aiErr, setAiErr] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const isGrid = p.view.type === "grid";
  const VI = VIEW_ICONS[p.view.type];
  const ro = !p.view.canEdit;

  return (
    <div className="p-toolbar" role="toolbar" aria-label="View options">
      <button type="button" className="p-tbtn" aria-label="Toggle views sidebar" onClick={p.onToggleSidebar}><Menu size={16} /></button>
      <span className="p-tbtn" style={{ fontWeight: 600, cursor: "default" }}>{VI && <VI size={15} />}{p.view.name}{p.view.isLocked && <Lock size={12} />}{p.view.personal && <span className="chip" style={{ height: 18 }}>Personal</span>}</span>
      <span style={{ width: 1, height: 20, background: "var(--color-border)", margin: "0 4px" }} />
      {ro && <span className="p-tbtn" style={{ color: "var(--color-text-secondary)", cursor: "default" }}><Lock size={13} />{p.view.isLocked ? "Locked view" : "Read-only view"}</span>}
      {!ro && (isGrid || p.view.type === "gallery" || p.view.type === "kanban" || p.view.type === "list") && (
        <Popover label="Hide fields" width={300} content={
          <div>
            <div style={{ maxHeight: 340, overflow: "auto" }}>
              {all.filter((f) => !f.isPrimary).map((f) => (
                <label key={f.id} className="g-opt" style={{ justifyContent: "space-between" }}>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}><FieldIcon type={f.type} />{f.name}</span>
                  <input type="checkbox" checked={!hidden.has(f.id)} onChange={() => p.onConfig({ hidden: hidden.has(f.id) ? [...hidden].filter((x) => x !== f.id) : [...hidden, f.id] })} />
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button type="button" className="p-tbtn" onClick={() => p.onConfig({ hidden: all.filter((f) => !f.isPrimary).map((f) => f.id) })}>Hide all</button>
              <button type="button" className="p-tbtn" onClick={() => p.onConfig({ hidden: [] })}>Show all</button>
            </div>
          </div>
        }><Btn icon={<EyeOff size={15} />} label={hidden.size ? `${hidden.size} hidden field${hidden.size > 1 ? "s" : ""}` : "Hide fields"} on={hidden.size > 0} tone="blue" /></Popover>
      )}
      {!ro && (
        <Popover label="Filter" width={560} content={
          <div>
            {p.aiConfigured && (
              <form style={{ ...rowStyle, marginBottom: 10 }} onSubmit={async (e) => {
                e.preventDefault(); setAiBusy(true); setAiErr("");
                const r = await aiFilterAction(p.view.id, aiQ); setAiBusy(false);
                if (!r.ok) { setAiErr(r.error); return; }
                p.onConfig({ filters: r.data as ViewConfig["filters"] }); p.notify("Filter applied");
              }}>
                <Sparkles size={15} color="var(--color-text-purple)" />
                <input aria-label="Describe a filter" style={{ ...sel, flex: 1 }} placeholder="Describe it: “high priority tasks due this week”" value={aiQ} onChange={(e) => setAiQ(e.target.value)} />
                <button type="submit" className="p-tbtn on-purple" disabled={aiBusy || !aiQ.trim()}>{aiBusy ? "Thinking…" : "Apply"}</button>
              </form>
            )}
            {aiErr && <p style={{ color: "var(--color-text-error)", fontSize: 12, marginBottom: 8 }}>{aiErr}</p>}
            {filters.length > 1 && (
              <div style={{ ...rowStyle, fontSize: 12, color: "var(--color-text-secondary)" }}>Match
                <select aria-label="Conjunction" style={sel} value={c.filters?.conjunction ?? "and"} onChange={(e) => p.onConfig({ filters: { conjunction: e.target.value as "and" | "or", conditions: filters } })}><option value="and">all conditions</option><option value="or">any condition</option></select>
              </div>
            )}
            {!filters.length && <p style={{ color: "var(--color-text-secondary)", fontSize: 13, marginBottom: 8 }}>No filter conditions are applied to this view.</p>}
            <ConditionList fields={all} conds={filters} onChange={(conds) => p.onConfig({ filters: { conjunction: c.filters?.conjunction ?? "and", conditions: conds } })} />
            <button type="button" className="p-tbtn" onClick={() => p.onConfig({ filters: { conjunction: c.filters?.conjunction ?? "and", conditions: [...filters, { fieldId: all[0].id, op: operatorsFor(all[0].type)[0].op }] } })}><Plus size={14} />Add condition</button>
          </div>
        }><Btn icon={<Filter size={15} />} label={filters.length ? `Filtered by ${filters.length} field${filters.length > 1 ? "s" : ""}` : "Filter"} on={filters.length > 0} tone="green" /></Popover>
      )}
      {!ro && (isGrid || p.view.type === "list") && (
        <Popover label="Group" width={380} content={
          <SortLike title="Group by" items={c.groups ?? []} fields={all} max={3} onChange={(groups) => p.onConfig({ groups })} />
        }><Btn icon={<Layers size={15} />} label={c.groups?.length ? `Grouped by ${c.groups.length} field${c.groups.length > 1 ? "s" : ""}` : "Group"} on={!!c.groups?.length} tone="purple" /></Popover>
      )}
      {!ro && p.view.type !== "form" && (
        <Popover label="Sort" width={380} content={
          <SortLike title="Sort by" items={c.sorts ?? []} fields={all} max={5} onChange={(sorts) => p.onConfig({ sorts })} />
        }><Btn icon={<ArrowUpDown size={15} />} label={c.sorts?.length ? `Sorted by ${c.sorts.length} field${c.sorts.length > 1 ? "s" : ""}` : "Sort"} on={!!c.sorts?.length} tone="orange" /></Popover>
      )}
      {!ro && (isGrid || p.view.type === "list" || p.view.type === "calendar" || p.view.type === "timeline") && (
        <Popover label="Colour" width={520} content={<ColorPanel config={c} fields={all} onConfig={p.onConfig} />}>
          <Btn icon={<PaintBucket size={15} />} label="Colour" on={!!c.color && c.color.mode !== "none"} tone="pink" />
        </Popover>
      )}
      {!ro && isGrid && (
        <DropdownMenu menuWidth={160} items={(["short", "medium", "tall", "extra"] as const).map((h) => ({ label: h === "extra" ? "Extra tall" : h[0].toUpperCase() + h.slice(1), onClick: () => p.onConfig({ rowHeight: h }) }))}
          renderTrigger={(t) => <button type="button" {...t} className="p-tbtn" aria-label="Row height"><Rows3 size={15} /></button>} />
      )}
      <DropdownMenu menuWidth={220} items={[
        { label: "Download CSV", icon: <Download size={14} />, onClick: () => p.onExport("csv") },
        { label: "Download Excel (.xlsx)", icon: <Download size={14} />, onClick: () => p.onExport("xlsx") },
        { label: "Download JSON", icon: <Download size={14} />, onClick: () => p.onExport("json") },
        { label: "Download XML", icon: <Download size={14} />, onClick: () => p.onExport("xml") },
        ...(p.view.type === "form" ? [{ type: "divider" as const }, { label: p.view.shareToken ? "Manage public form link" : "Share form publicly", icon: <Share2 size={14} />, onClick: p.onShare }] : []),
        ...(p.canLock ? [{ type: "divider" as const }, { label: p.view.isLocked ? "Unlock view" : "Lock view", icon: <Lock size={14} />, onClick: p.onLock }] : []),
      ]} renderTrigger={(t) => <button type="button" {...t} className="p-tbtn"><Share2 size={15} /><span className="p-tlabel">Share & export</span></button>} />
      <span style={{ flex: 1 }} />
      {showSearch || p.search ? (
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input autoFocus aria-label="Search records" placeholder="Find in view" value={p.search} onChange={(e) => p.onSearch(e.target.value)} style={{ ...sel, width: 200 }} onKeyDown={(e) => e.key === "Escape" && (p.onSearch(""), setShowSearch(false))} />
          <button type="button" className="p-tbtn" aria-label="Close search" onClick={() => { p.onSearch(""); setShowSearch(false); }}><X size={14} /></button>
        </span>
      ) : <button type="button" className="p-tbtn" aria-label="Search" onClick={() => setShowSearch(true)}><Search size={15} /></button>}
    </div>
  );
}

function SortLike({ title, items, fields, max, onChange }: { title: string; items: { fieldId: string; dir: "asc" | "desc" }[]; fields: ClientField[]; max: number; onChange: (i: { fieldId: string; dir: "asc" | "desc" }[]) => void }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>{title}</div>
      {items.map((s, i) => (
        <div key={i} style={rowStyle}>
          <select aria-label="Field" style={{ ...sel, flex: 1 }} value={s.fieldId} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, fieldId: e.target.value } : x)))}>{fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          <select aria-label="Direction" style={{ ...sel, width: 110 }} value={s.dir} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, dir: e.target.value as "asc" | "desc" } : x)))}><option value="asc">A → Z / 1 → 9</option><option value="desc">Z → A / 9 → 1</option></select>
          <button type="button" className="p-tbtn" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
        </div>
      ))}
      {items.length < max && <button type="button" className="p-tbtn" onClick={() => onChange([...items, { fieldId: fields.find((f) => !items.some((x) => x.fieldId === f.id))?.id ?? fields[0].id, dir: "asc" }])}><Plus size={14} />Add {title.toLowerCase().replace(" by", "")}</button>}
    </div>
  );
}

function ColorPanel({ config, fields, onConfig }: { config: ViewConfig; fields: ClientField[]; onConfig: (p: ViewConfig) => void }) {
  const col = config.color ?? { mode: "none" as const };
  const selects = fields.filter((f) => f.type === "singleSelect");
  const rules = col.rules ?? [];
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["none", "select", "conditions"] as const).map((m) => <button key={m} type="button" className={`p-tbtn ${col.mode === m ? "on-blue" : ""}`} onClick={() => onConfig({ color: { ...col, mode: m, fieldId: m === "select" ? col.fieldId ?? selects[0]?.id : col.fieldId } })}>{m === "none" ? "Manual / none" : m === "select" ? "By select field" : "By conditions"}</button>)}
      </div>
      {col.mode === "none" && <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Rows use their own colour (right-click a row → Row colour).</p>}
      {col.mode === "select" && (selects.length
        ? <select aria-label="Colour field" style={{ ...sel, width: "100%" }} value={col.fieldId ?? ""} onChange={(e) => onConfig({ color: { mode: "select", fieldId: e.target.value } })}>{selects.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        : <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Add a single select field to colour by it.</p>)}
      {col.mode === "conditions" && (
        <div>
          {rules.map((r, i) => {
            const f = fields.find((x) => x.id === r.fieldId) ?? fields[0];
            return (
              <div key={i} style={rowStyle}>
                <select aria-label="Colour" style={{ ...sel, width: 80 }} value={r.color} onChange={(e) => onConfig({ color: { ...col, rules: rules.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) } })}>{COLORS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                <select aria-label="Field" style={{ ...sel, width: 120 }} value={f.id} onChange={(e) => { const nf = fields.find((x) => x.id === e.target.value)!; onConfig({ color: { ...col, rules: rules.map((x, j) => (j === i ? { ...x, fieldId: nf.id, op: operatorsFor(nf.type)[0].op, value: undefined } : x)) } }); }}>{fields.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <select aria-label="Operator" style={{ ...sel, width: 110 }} value={r.op} onChange={(e) => onConfig({ color: { ...col, rules: rules.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)) } })}>{operatorsFor(f.type).map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</select>
                <ValueInput f={f} op={r.op} value={r.value} onChange={(v) => onConfig({ color: { ...col, rules: rules.map((x, j) => (j === i ? { ...x, value: v } : x)) } })} />
                <button type="button" className="p-tbtn" aria-label="Remove rule" onClick={() => onConfig({ color: { ...col, rules: rules.filter((_, j) => j !== i) } })}><Trash2 size={14} /></button>
              </div>
            );
          })}
          <button type="button" className="p-tbtn" onClick={() => onConfig({ color: { ...col, rules: [...rules, { color: COLORS[rules.length % COLORS.length], fieldId: fields[0].id, op: operatorsFor(fields[0].type)[0].op }] } })}><Plus size={14} />Add colour rule</button>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 6 }}>The first matching rule wins.</p>
        </div>
      )}
    </div>
  );
}
