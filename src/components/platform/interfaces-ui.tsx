"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Dialog } from "@astryxdesign/core/Dialog";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { BarChart3, Hash, LineChart, PieChart, Table2, Plus, Pencil, Trash2, Check } from "lucide-react";
import { computeWidgetsAction, deleteInterfaceAction, saveInterfaceAction } from "@/app/platform-actions";
import type { Widget, WidgetData } from "@/server/platform/interfaces";
import type { BaseMeta } from "@/app/(base)/base/[baseId]/load";
import { BaseHeader } from "./base-header";

type Iface = { id: string; name: string; widgets: Widget[] };
const SLOTS = 8;
const vizColor = (i: number) => (i < SLOTS ? `var(--viz-${i + 1})` : "var(--viz-other)");
const fmt = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
const TYPE_ICON = { number: Hash, bar: BarChart3, line: LineChart, pie: PieChart, list: Table2 };
const sel: React.CSSProperties = { width: "100%", height: 34, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-background-surface)", color: "var(--color-text-primary)", font: "inherit", padding: "0 8px" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", margin: "10px 0 4px" };

export function InterfacesApp({ meta, interfaces, activeId }: { meta: BaseMeta; interfaces: Iface[]; activeId?: string }) {
  const router = useRouter();
  const active = interfaces.find((i) => i.id === activeId) ?? interfaces[0];
  const [widgets, setWidgets] = useState<Widget[]>(active?.widgets ?? []);
  const [data, setData] = useState<Record<string, WidgetData>>({});
  const [editing, setEditing] = useState(meta.canEdit && !!active && !active.widgets.length);
  const [dlg, setDlg] = useState<Widget | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { setWidgets(active?.widgets ?? []); }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const compute = useCallback(async (ws: Widget[]) => {
    if (!ws.length) { setData({}); return; }
    const r = await computeWidgetsAction(meta.base.id, ws);
    if (r.ok) setData(Object.fromEntries(r.data.map((d) => [d.id, d]))); else setErr(r.error);
  }, [meta.base.id]);
  useEffect(() => { compute(widgets); }, [widgets, compute]);

  const persist = async (ws: Widget[]) => {
    setWidgets(ws);
    if (!active) return;
    const r = await saveInterfaceAction(meta.base.id, { id: active.id, name: active.name, widgets: ws });
    if (!r.ok) setErr(r.error);
  };
  const create = async () => {
    const name = prompt("Interface name", "Overview"); if (!name?.trim()) return;
    const r = await saveInterfaceAction(meta.base.id, { name, widgets: [] });
    if (!r.ok) { setErr(r.error); return; }
    router.push(`/base/${meta.base.id}/interfaces?i=${r.data.id}`); router.refresh(); setEditing(true);
  };

  return (
    <div className="p-base">
      <BaseHeader base={meta.base} role={meta.role} active="interfaces" />
      <div className="p-body">
        <aside className="p-views" aria-label="Interfaces">
          <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
            <div className="p-sect">Interfaces</div>
            {interfaces.map((i) => <a key={i.id} href={`/base/${meta.base.id}/interfaces?i=${i.id}`} className="p-viewitem" aria-current={i.id === active?.id ? "page" : undefined}><BarChart3 size={15} />{i.name}</a>)}
            {!interfaces.length && <p style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "4px 10px" }}>Dashboards with live numbers and charts built from your tables.</p>}
          </div>
          {meta.canEdit && <div style={{ borderTop: "1px solid var(--color-border)", padding: 8 }}><button type="button" className="p-viewitem" onClick={create}><Plus size={15} />New interface</button></div>}
        </aside>
        <main className="p-main">
          {active ? (
            <>
              <div className="p-toolbar">
                <strong style={{ fontSize: 15, padding: "0 6px" }}>{active.name}</strong>
                <span style={{ flex: 1 }} />
                {err && <span style={{ color: "var(--color-text-error)", fontSize: 12 }}>{err}</span>}
                {meta.canEdit && editing && <button type="button" className="p-tbtn" onClick={() => setDlg({ id: crypto.randomUUID(), type: "bar", title: "", tableId: meta.tables[0]?.id ?? "", agg: "count", width: 1 })}><Plus size={14} />Add widget</button>}
                {meta.canEdit && <button type="button" className={`p-tbtn ${editing ? "on-blue" : ""}`} onClick={() => setEditing((e) => !e)}>{editing ? <><Check size={14} />Done</> : <><Pencil size={14} />Edit</>}</button>}
                {meta.canEdit && editing && <button type="button" className="p-tbtn" style={{ color: "var(--color-text-red)" }} onClick={async () => { if (!confirm(`Delete interface “${active.name}”?`)) return; await deleteInterfaceAction(active.id); router.push(`/base/${meta.base.id}/interfaces`); router.refresh(); }}><Trash2 size={14} /></button>}
              </div>
              {widgets.length ? (
                <div className="if-grid">
                  {widgets.map((w, i) => (
                    <section key={w.id} className="if-card" style={{ gridColumn: `span ${w.width ?? 1}` }} aria-label={w.title}>
                      <h3>{(() => { const I = TYPE_ICON[w.type]; return <I size={13} />; })()}<span style={{ flex: 1 }}>{w.title || "Untitled"}</span>
                        {editing && <>
                          <button type="button" className="g-hmenu" style={{ opacity: 1 }} aria-label="Move earlier" disabled={i === 0} onClick={() => { const n = [...widgets]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; persist(n); }}>←</button>
                          <button type="button" className="g-hmenu" style={{ opacity: 1 }} aria-label="Edit widget" onClick={() => setDlg(w)}><Pencil size={12} /></button>
                          <button type="button" className="g-hmenu" style={{ opacity: 1 }} aria-label="Remove widget" onClick={() => persist(widgets.filter((x) => x.id !== w.id))}><Trash2 size={12} /></button>
                        </>}
                      </h3>
                      <WidgetBody w={w} d={data[w.id]} />
                    </section>
                  ))}
                </div>
              ) : (
                <div style={{ display: "grid", placeItems: "center", flex: 1 }}>
                  <EmptyState title="No widgets yet" description={meta.canEdit ? "Choose Edit → Add widget to add numbers, bar, line and donut charts, or record lists." : "An owner or creator hasn't added widgets yet."} />
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "grid", placeItems: "center", flex: 1 }}>
              <EmptyState title="No interfaces yet" description="Interfaces turn tables into live dashboards — totals, pipelines, trends and lists — that respect everyone's permissions." />
              {meta.canEdit && <Button label="Create an interface" variant="primary" onClick={create} />}
            </div>
          )}
        </main>
      </div>
      {dlg && <WidgetDialog meta={meta} initial={dlg} onClose={() => setDlg(null)} onSave={(w) => { const exists = widgets.some((x) => x.id === w.id); persist(exists ? widgets.map((x) => (x.id === w.id ? w : x)) : [...widgets, w]); setDlg(null); }} />}
    </div>
  );
}

function WidgetDialog({ meta, initial, onClose, onSave }: { meta: BaseMeta; initial: Widget; onClose: () => void; onSave: (w: Widget) => void }) {
  const [w, setW] = useState<Widget>(initial);
  const set = (p: Partial<Widget>) => setW((x) => ({ ...x, ...p }));
  const fields = meta.fields.filter((f) => f.tableId === w.tableId);
  const numeric = fields.filter((f) => ["number", "currency", "percent", "rating", "duration", "count", "rollup", "formula", "autonumber"].includes(f.type));
  const groupable = fields.filter((f) => ["singleSelect", "multipleSelects", "checkbox", "user", "singleLineText", "date", "dateTime", "createdTime", "link", "lookup", "formula"].includes(f.type));
  const dateFields = fields.filter((f) => ["date", "dateTime", "createdTime", "lastModifiedTime"].includes(f.type));
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={480} padding={6} purpose="form">
      <h2 style={{ fontSize: 17, fontWeight: 700 }}>Widget</h2>
      <label style={lbl}>Type</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["number", "bar", "line", "pie", "list"] as const).map((t) => { const I = TYPE_ICON[t]; return <button key={t} type="button" className={`p-tbtn ${w.type === t ? "on-blue" : ""}`} onClick={() => set({ type: t, groupFieldId: t === "line" ? dateFields[0]?.id : w.groupFieldId })}><I size={14} />{t === "pie" ? "Donut" : t[0].toUpperCase() + t.slice(1)}</button>; })}
      </div>
      <label style={lbl} htmlFor="w-title">Title</label>
      <input id="w-title" style={sel} value={w.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Pipeline by stage" />
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}><label style={lbl} htmlFor="w-table">Table</label><select id="w-table" style={sel} value={w.tableId} onChange={(e) => set({ tableId: e.target.value, viewId: undefined, fieldId: undefined, groupFieldId: undefined })}>{meta.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div style={{ flex: 1 }}><label style={lbl} htmlFor="w-view">Records from view</label><select id="w-view" style={sel} value={w.viewId ?? ""} onChange={(e) => set({ viewId: e.target.value || undefined })}><option value="">All records</option>{meta.views.filter((v) => v.tableId === w.tableId).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
      </div>
      {w.type !== "list" && (
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label style={lbl} htmlFor="w-agg">Measure</label><select id="w-agg" style={sel} value={w.agg ?? "count"} onChange={(e) => set({ agg: e.target.value as Widget["agg"] })}><option value="count">Count of records</option><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Minimum</option><option value="max">Maximum</option></select></div>
          {w.agg && w.agg !== "count" && <div style={{ flex: 1 }}><label style={lbl} htmlFor="w-field">Of field</label><select id="w-field" style={sel} value={w.fieldId ?? ""} onChange={(e) => set({ fieldId: e.target.value })}><option value="">Choose…</option>{numeric.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>}
        </div>
      )}
      {(w.type === "bar" || w.type === "pie" || w.type === "line") && (
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label style={lbl} htmlFor="w-group">{w.type === "line" ? "Over time (date field)" : "Group by"}</label><select id="w-group" style={sel} value={w.groupFieldId ?? ""} onChange={(e) => set({ groupFieldId: e.target.value })}><option value="">Choose…</option>{(w.type === "line" ? dateFields : groupable).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
          {w.type === "line" && <div style={{ width: 130 }}><label style={lbl} htmlFor="w-unit">Per</label><select id="w-unit" style={sel} value={w.dateUnit ?? "month"} onChange={(e) => set({ dateUnit: e.target.value as Widget["dateUnit"] })}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></div>}
        </div>
      )}
      {w.type === "list" && <><label style={lbl} htmlFor="w-limit">Rows</label><input id="w-limit" type="number" min={1} max={50} style={sel} value={w.limit ?? 10} onChange={(e) => set({ limit: Number(e.target.value) })} /></>}
      <label style={lbl}>Width</label>
      <div style={{ display: "flex", gap: 6 }}>{([1, 2, 3] as const).map((n) => <button key={n} type="button" className={`p-tbtn ${(w.width ?? 1) === n ? "on-blue" : ""}`} onClick={() => set({ width: n })}>{n === 1 ? "⅓" : n === 2 ? "⅔" : "Full"}</button>)}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Button label="Cancel" onClick={onClose} />
        <Button label="Save widget" variant="primary" isDisabled={!w.tableId || (w.type !== "number" && w.type !== "list" && !w.groupFieldId) || (!!w.agg && w.agg !== "count" && !w.fieldId)} onClick={() => onSave(w)} />
      </div>
    </Dialog>
  );
}

function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const on = (text: string) => ({ onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX + 12, y: e.clientY + 12, text }), onMouseLeave: () => setTip(null), onFocus: (e: React.FocusEvent) => { const r = (e.target as Element).getBoundingClientRect(); setTip({ x: r.right + 6, y: r.top, text }); }, onBlur: () => setTip(null), tabIndex: 0, role: "img", "aria-label": text });
  const node = tip ? <div className="if-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div> : null;
  return { on, node };
}

function WidgetBody({ w, d }: { w: Widget; d?: WidgetData }) {
  const [table, setTable] = useState(false);
  const tip = useTip();
  if (!d) return <div style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>Loading…</div>;
  if (d.error) return <div style={{ color: "var(--color-text-error)", fontSize: 13 }}>{d.error}</div>;
  if (w.type === "number") return <div className="if-num">{fmt(d.value ?? 0)}</div>;
  if (w.type === "list") return (
    <div style={{ overflow: "auto" }}>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <thead><tr>{d.columns?.map((c) => <th key={c} style={{ textAlign: "left", fontWeight: 600, color: "var(--color-text-secondary)", padding: "4px 6px", borderBottom: "1px solid var(--color-border)", whiteSpace: "nowrap" }}>{c}</th>)}</tr></thead>
        <tbody>{d.rows?.map((r) => <tr key={r.id}>{r.cells.map((c, i) => <td key={i} style={{ padding: "5px 6px", borderBottom: "1px solid var(--color-border)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c}</td>)}</tr>)}</tbody>
      </table>
      {!d.rows?.length && <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No records.</p>}
    </div>
  );
  const s = d.series ?? [];
  if (!s.length) return <div style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>No data yet.</div>;
  const toggle = <button type="button" className="p-tbtn" style={{ alignSelf: "flex-end", height: 22, fontSize: 11 }} onClick={() => setTable((t) => !t)}>{table ? "Chart" : "Table"}</button>;
  if (table) return <>{toggle}<table style={{ fontSize: 13, width: "100%" }}><tbody>{s.map((x) => <tr key={x.label}><td style={{ padding: "3px 4px" }}>{x.label}</td><td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(x.value)}</td></tr>)}</tbody></table></>;

  if (w.type === "bar") {
    // Single measure across categories → one hue; values direct-labelled in text ink.
    const max = Math.max(...s.map((x) => x.value), 0) || 1; const rowH = 26, labelW = 110, W = 340;
    return <>{toggle}
      <svg viewBox={`0 0 ${W} ${s.length * rowH}`} width="100%" role="img" aria-label={`${w.title}: bar chart`} style={{ overflow: "visible" }}>
        {s.map((x, i) => { const bw = Math.max(2, ((W - labelW - 56) * x.value) / max); return (
          <g key={x.label} transform={`translate(0 ${i * rowH})`}>
            <text x={labelW - 8} y={rowH / 2 + 4} textAnchor="end" fontSize="12" fill="var(--color-text-secondary)">{x.label.length > 18 ? `${x.label.slice(0, 17)}…` : x.label}</text>
            <rect className="if-bar" x={labelW} y={5} width={bw} height={rowH - 10} rx={4} fill="var(--viz-1)" {...tip.on(`${x.label}: ${fmt(x.value)}`)} />
            <text x={labelW + bw + 6} y={rowH / 2 + 4} fontSize="12" fill="var(--color-text-primary)" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(x.value)}</text>
          </g>); })}
      </svg>{tip.node}</>;
  }
  if (w.type === "line") {
    const W = 440, H = 170, P = { l: 40, r: 10, t: 10, b: 24 };
    const max = Math.max(...s.map((x) => x.value), 0) || 1;
    const x = (i: number) => P.l + (s.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (s.length - 1));
    const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / max);
    const ticks = [0, max / 2, max];
    return <>{toggle}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${w.title}: line chart`}>
        {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" /><text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--color-text-secondary)">{fmt(Math.round(t * 100) / 100)}</text></g>)}
        <polyline fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" points={s.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
        {s.map((p, i) => <circle key={p.label} cx={x(i)} cy={y(p.value)} r={4} fill="var(--viz-1)" stroke="var(--color-background-card)" strokeWidth={2} {...tip.on(`${p.label}: ${fmt(p.value)}`)} />)}
        {s.map((p, i) => (s.length <= 8 || i % Math.ceil(s.length / 8) === 0) && <text key={`l${p.label}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-text-secondary)">{p.label}</text>)}
      </svg>{tip.node}</>;
  }
  // Donut: categorical hues in fixed order; > 8 groups fold into "Other".
  const top = s.length > SLOTS ? [...s.slice(0, SLOTS - 1), { label: "Other", value: s.slice(SLOTS - 1).reduce((a, b) => a + b.value, 0) }] : s;
  const total = top.reduce((a, b) => a + b.value, 0) || 1; const R = 60, r = 38, C = 70; let a0 = -Math.PI / 2;
  return <>{toggle}
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <svg viewBox="0 0 140 140" width={140} height={140} role="img" aria-label={`${w.title}: donut chart`}>
        {top.map((p, i) => { const a1 = a0 + (2 * Math.PI * p.value) / total; const large = a1 - a0 > Math.PI ? 1 : 0;
          const pt = (rad: number, ang: number) => `${C + rad * Math.cos(ang)} ${C + rad * Math.sin(ang)}`;
          const d = p.value >= total ? `M ${pt(R, 0)} A ${R} ${R} 0 1 1 ${pt(R, Math.PI)} A ${R} ${R} 0 1 1 ${pt(R, 0)} M ${pt(r, 0)} A ${r} ${r} 0 1 0 ${pt(r, Math.PI)} A ${r} ${r} 0 1 0 ${pt(r, 0)}` : `M ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} L ${pt(r, a1)} A ${r} ${r} 0 ${large} 0 ${pt(r, a0)} Z`;
          a0 = a1;
          return <path key={p.label} className="if-arc" d={d} fill={p.label === "Other" && s.length > SLOTS ? "var(--viz-other)" : vizColor(i)} stroke="var(--color-background-card)" strokeWidth={2} fillRule="evenodd" {...tip.on(`${p.label}: ${fmt(p.value)} (${Math.round((p.value / total) * 100)}%)`)} />; })}
        <text x={C} y={C + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--color-text-primary)">{fmt(total)}</text>
      </svg>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12, display: "grid", gap: 4 }}>
        {top.map((p, i) => <li key={p.label} style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: p.label === "Other" && s.length > SLOTS ? "var(--viz-other)" : vizColor(i) }} /><span>{p.label}</span><span style={{ color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{fmt(p.value)}</span></li>)}
      </ul>
    </div>{tip.node}</>;
}
