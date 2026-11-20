"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Layers, Gauge, TrendingUp, CircleCheck, CalendarClock, Users, PoundSterling, Activity, ChevronRight, ChevronLeft, FileText, Clock, Search, ArrowUp, ArrowDown, ImageIcon } from "lucide-react";
import type { Component, Page } from "@/lib/apps/types";
import type { ComponentData, FieldLite } from "@/server/apps/data";
import { CellView } from "@/components/platform/cells";
import { cellText } from "@/lib/platform/cell-text";
import { appButtonAction, appCommentAction, appFormAction, appUpdateAction } from "@/app/apps-actions";
import { BarChart, DonutChart, LineChart } from "./charts";
import { confirmDialog, promptDialog } from "@/components/ui/dialogs";

export type RuntimeInfo = { slug: string; pageId: string; preview: boolean; recordId?: string; role: string; pages: { id: string; slug: string; kind: string; tableId?: string }[]; design?: boolean };
export const KPI_ICONS: Record<string, React.ComponentType<{ size?: number }>> = { layers: Layers, gauge: Gauge, trend: TrendingUp, check: CircleCheck, calendar: CalendarClock, users: Users, money: PoundSterling, activity: Activity, file: FileText, clock: Clock };

const asField = (f: FieldLite) => ({ ...f, tableId: "", editable: false, isPrimary: !!f.isPrimary, options: f.options as never, type: f.type as never });
function money(n: number, symbol = "£") { return `${n < 0 ? "-" : ""}${symbol}${Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`; }
export function formatter(format?: string, field?: FieldLite) {
  const sym = String(field?.options?.symbol ?? "£");
  const fmt = (n: number) => format === "currency" || field?.type === "currency" ? money(n, sym) : format === "percent" ? `${Math.round(n * 1000) / 10}%` : format === "days" ? `${Math.round(n)} days` : n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  const short = (n: number) => { const c = format === "currency" || field?.type === "currency"; const s = Math.abs(n) >= 1e6 ? `${Math.round(n / 1e5) / 10}m` : Math.abs(n) >= 1e3 ? `${Math.round(n / 100) / 10}k` : `${Math.round(n * 10) / 10}`; return c ? `${sym}${s}` : s; };
  return { fmt, short };
}
const detailHref = (rc: RuntimeInfo, pageId: string | undefined, recordId: string) => {
  const p = rc.pages.find((x) => x.id === pageId); if (!p) return null;
  return `/a/${rc.slug}/${p.slug}/${recordId}${rc.preview ? "?preview=1" : ""}`;
};

export function PageGrid({ page, data, rc, wrap }: { page: Page; data: Record<string, ComponentData | undefined>; rc: RuntimeInfo; wrap?: (c: Component, node: React.ReactNode) => React.ReactNode }) {
  return (
    <div className="ap-grid">
      {page.components.map((c) => {
        const node = <AppComponent key={c.id} comp={c} data={data[c.id]} rc={rc} />;
        return <div key={c.id} className="ap-cell" style={{ "--w": c.w } as React.CSSProperties} data-type={c.type}>{wrap ? wrap(c, node) : node}</div>;
      })}
      {!page.components.length && <div className="ap-cell ap-empty" style={{ "--w": 12 } as React.CSSProperties}>This page is empty.{rc.design ? " Drag components from the left onto the canvas." : ""}</div>}
    </div>
  );
}

function Card({ title, subtitle, action, children, className }: { title?: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`ap-card ${className ?? ""}`} aria-label={title}>
      {(title || action) && <header className="ap-card-h"><div style={{ minWidth: 0 }}><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</header>}
      {children}
    </section>
  );
}
function State({ d }: { d?: ComponentData }) {
  if (!d) return <div className="ap-muted">Loading…</div>;
  if (d.kind === "error") return <div className="ap-error" role="alert">{d.message}</div>;
  return <div className="ap-muted">Connect this component to a table in the inspector.</div>;
}

export function AppComponent({ comp, data, rc }: { comp: Component; data?: ComponentData; rc: RuntimeInfo }) {
  const p = comp.props;
  switch (comp.type) {
    case "heading": return <div className="ap-heading"><h2>{p.title}</h2>{p.subtitle && <p>{p.subtitle}</p>}</div>;
    case "text": return <p className="ap-text">{p.text}</p>;
    case "divider": return <hr className="ap-divider" />;
    case "kpi": {
      const I = KPI_ICONS[p.icon ?? "layers"] ?? Layers;
      const { fmt } = formatter(p.format);
      return (
        <section className="ap-card ap-kpi" aria-label={p.title}>
          <span className="ap-kpi-ic" aria-hidden><I size={22} /></span>
          <div><div className="ap-kpi-t">{p.title}</div><div className="ap-kpi-v">{data?.kind === "kpi" ? fmt(data.value) : "—"}</div>{data?.kind === "kpi" && p.agg && p.agg !== "count" && <div className="ap-kpi-s">from {data.count} record{data.count === 1 ? "" : "s"}</div>}</div>
          {data && data.kind !== "kpi" && <State d={data} />}
        </section>
      );
    }
    case "chart": return <ChartComp comp={comp} data={data} rc={rc} />;
    case "table": return <TableComp comp={comp} data={data} rc={rc} />;
    case "kanban": return <KanbanComp comp={comp} data={data} rc={rc} />;
    case "activity": return <ActivityComp comp={comp} data={data} rc={rc} />;
    case "record": return <RecordComp comp={comp} data={data} rc={rc} />;
    case "form": return <FormComp comp={comp} data={data} rc={rc} />;
    case "button": return <ButtonComp comp={comp} rc={rc} />;
    case "calendar": return <CalendarComp comp={comp} data={data} rc={rc} />;
    case "filter": return <FilterBar comp={comp} data={data} rc={rc} />;
    case "gallery": return <GalleryComp comp={comp} data={data} rc={rc} />;
    case "progress": {
      const { fmt } = formatter(p.format);
      const v = data?.kind === "kpi" ? data.value : 0; const t = p.target || 1; const pct = Math.max(0, Math.min(100, Math.round((v / t) * 100)));
      return (
        <Card title={p.title} subtitle={p.subtitle}>
          {data?.kind === "kpi" ? <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span className="ap-kpi-v">{fmt(v)}</span><span className="ap-muted">of {fmt(t)}</span><span style={{ flex: 1 }} /><span className="ap-strong">{pct}%</span></div>
            <div className="ap-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${p.title}: ${pct}% of goal`}><span style={{ width: `${pct}%` }} /></div>
          </> : <State d={data} />}
        </Card>
      );
    }
  }
}

function pickFields(fields: FieldLite[], ids?: string[], n = 6) {
  if (ids?.length) return ids.map((id) => fields.find((f) => f.id === id)).filter(Boolean) as FieldLite[];
  const primary = fields.find((f) => f.isPrimary); const rest = fields.filter((f) => !f.isPrimary && f.type !== "longText");
  return [...(primary ? [primary] : []), ...rest].slice(0, n);
}

function TableComp({ comp, data, rc }: { comp: Component; data?: ComponentData; rc: RuntimeInfo }) {
  const router = useRouter();
  const p = comp.props;
  const [q, setQ] = useState(""); const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    if (data?.kind !== "rows") return [];
    const fs = pickFields(data.fields, p.fieldIds);
    let out = data.rows;
    if (q.trim()) { const n = q.trim().toLowerCase(); out = out.filter((r) => fs.some((f) => cellText(f as never, r.values[f.id]).toLowerCase().includes(n))); }
    if (sort) { const f = fs.find((x) => x.id === sort.id); if (f) { const coll = new Intl.Collator("en-GB", { numeric: true }); out = [...out].sort((a, b) => { const x = a.values[f.id], y = b.values[f.id]; const d = typeof x === "number" && typeof y === "number" ? x - y : coll.compare(cellText(f as never, x), cellText(f as never, y)); return d * sort.dir; }); } }
    return out;
  }, [data, q, sort, p.fieldIds]);
  if (data?.kind !== "rows") return <Card title={p.title}><State d={data} /></Card>;
  const cols = pickFields(data.fields, p.fieldIds);
  const search = p.showSearch !== false;
  return (
    <Card title={p.title} subtitle={p.subtitle} action={<div style={{ display: "flex", alignItems: "center", gap: 8 }}>{search && <label className="ap-search"><Search size={14} aria-hidden /><input type="search" placeholder="Search" aria-label={`Search ${p.title ?? "records"}`} value={q} onChange={(e) => setQ(e.target.value)} /></label>}<span className="ap-muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{q ? `${rows.length} of ${data.total}` : data.total} {data.total === 1 ? "record" : "records"}</span></div>}>
      <div className="ap-table-wrap">
        <table className="ap-table">
          <thead><tr>{cols.map((f) => <th key={f.id} scope="col" aria-sort={sort?.id === f.id ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>{search ? <button type="button" className="ap-th-btn" onClick={() => setSort((s) => (s?.id === f.id ? (s.dir === 1 ? { id: f.id, dir: -1 } : null) : { id: f.id, dir: 1 }))}>{f.name}{sort?.id === f.id && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button> : f.name}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => {
              const href = p.detailPageId ? detailHref(rc, p.detailPageId, r.id) : null;
              return (
                <tr key={r.id} className={href ? "ap-click" : undefined} onClick={() => href && !rc.design && router.push(href)} tabIndex={href ? 0 : undefined} onKeyDown={(e) => { if (e.key === "Enter" && href && !rc.design) router.push(href); }}>
                  {cols.map((f) => <td key={f.id} className={f.isPrimary ? "ap-strong" : undefined}><span className="ap-cell-in"><CellView f={asField(f)} v={r.values[f.id]} /></span></td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div className="ap-muted" style={{ padding: 16 }}>{q ? "No matches." : "No records."}</div>}
      </div>
    </Card>
  );
}

/** Charts drill down: clicking a bar/slice of a select field filters the whole page (same as the filter bar). */
function ChartComp({ comp, data, rc }: { comp: Component; data?: ComponentData; rc: RuntimeInfo }) {
  const p = comp.props; const router = useRouter(); const path = usePathname(); const params = useSearchParams();
  const { fmt, short } = formatter(p.format);
  if (data?.kind !== "series") return <Card title={p.title} subtitle={p.subtitle}><State d={data} /></Card>;
  const fid = data.drillFieldId; const active = fid ? params.get(`f_${fid}`) : null;
  const setF = (v: string | null) => { if (!fid || rc.design) return; const n = new URLSearchParams(params.toString()); if (v) n.set(`f_${fid}`, v); else n.delete(`f_${fid}`); router.replace(`${path}${n.toString() ? `?${n}` : ""}`, { scroll: false }); };
  const onSelect = fid && !rc.design ? (label: string) => { const k = data.series.find((x) => x.label === label)?.key; if (k) setF(active === k ? null : k); } : undefined;
  const activeLabel = active ? data.series.find((x) => x.key === active)?.label : undefined;
  return (
    <Card title={p.title} subtitle={p.subtitle} action={activeLabel ? <button type="button" className="ap-outline-btn" style={{ height: 28, padding: "0 10px" }} onClick={() => setF(null)}>Showing {activeLabel} · Clear</button> : onSelect ? <span className="ap-muted" style={{ fontSize: 12 }}>Click to filter</span> : undefined}>
      {data.series.length ? (p.chart === "line" ? <LineChart data={data.series} fmt={fmt} short={short} /> : p.chart === "donut" ? <DonutChart data={data.series} fmt={fmt} short={short} onSelect={onSelect} /> : <BarChart data={data.series} fmt={fmt} short={short} onSelect={onSelect} />) : <div className="ap-muted">No data yet.</div>}
    </Card>
  );
}

/** Page-wide filters: choices go in the URL (shareable, back-button friendly); the server narrows every component on the same table. */
function FilterBar({ comp, data, rc }: { comp: Component; data?: ComponentData; rc: RuntimeInfo }) {
  const router = useRouter(); const path = usePathname(); const params = useSearchParams();
  const [q, setQ] = useState(params.get("f_q") ?? "");
  const [presets, setPresets] = useState<{ name: string; q: string }[]>([]);
  useEffect(() => { try { setPresets(JSON.parse(localStorage.getItem(`bangon:presets:${rc.slug}:${rc.pageId}`) ?? "[]")); } catch { /* storage blocked */ } }, [rc.slug, rc.pageId]);
  if (data?.kind !== "filter") return <Card title={comp.props.title}><State d={data} /></Card>;
  const set = (k: string, v: string) => { const n = new URLSearchParams(params.toString()); if (v) n.set(`f_${k}`, v); else n.delete(`f_${k}`); if (!rc.design) router.replace(`${path}?${n.toString()}`, { scroll: false }); };
  const any = [...params.keys()].some((k) => k.startsWith("f_"));
  // Saved filter presets: per person, per page, kept in this browser.
  const presetKey = `bangon:presets:${rc.slug}:${rc.pageId}`;
  const current = [...params.entries()].filter(([k]) => k.startsWith("f_"));
  const savePreset = async () => {
    const name = await promptDialog("Name these filters", "", { placeholder: "e.g. My open bugs", confirmLabel: "Save" }); if (!name?.trim()) return;
    const next = [...presets.filter((x) => x.name !== name.trim()), { name: name.trim(), q: new URLSearchParams(current).toString() }].slice(-12);
    setPresets(next); try { localStorage.setItem(presetKey, JSON.stringify(next)); } catch { /* storage blocked */ }
  };
  const applyPreset = (q: string) => { const n = new URLSearchParams(params.toString()); for (const k of [...n.keys()]) if (k.startsWith("f_")) n.delete(k); for (const [k, v] of new URLSearchParams(q)) n.set(k, v); setQ(n.get("f_q") ?? ""); router.replace(`${path}?${n}`, { scroll: false }); };
  const dropPreset = (name: string) => { const next = presets.filter((x) => x.name !== name); setPresets(next); try { localStorage.setItem(presetKey, JSON.stringify(next)); } catch { /* ignore */ } };
  return (
    <div className="ap-filterbar" role="search" aria-label={comp.props.title || `Filter ${data.tableName}`}>
      {presets.length > 0 && <div className="ap-presets" aria-label="Saved filters">{presets.map((x) => <span key={x.name} className={`ap-preset ${new URLSearchParams(current).toString() === x.q ? "on" : ""}`}><button type="button" onClick={() => applyPreset(x.q)}>{x.name}</button><button type="button" aria-label={`Delete saved filter ${x.name}`} onClick={() => dropPreset(x.name)}>×</button></span>)}</div>}
      {comp.props.showSearch !== false && <label className="ap-search"><Search size={14} aria-hidden /><input type="search" placeholder={`Search ${data.tableName.toLowerCase()}`} aria-label={`Search ${data.tableName}`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") set("q", q.trim()); }} onBlur={() => q.trim() !== (params.get("f_q") ?? "") && set("q", q.trim())} /></label>}
      {data.fields.map((f) => { const cur = params.get(`f_${f.id}`) ?? ""; const choices = (f.options.choices as { id: string; name: string }[] | undefined) ?? []; return (
        <label key={f.id} className="ap-filter"><span>{f.name}</span>
          <select value={cur} onChange={(e) => set(f.id, e.target.value)} aria-label={`Filter by ${f.name}`}>
            <option value="">All</option>
            {f.type === "checkbox" ? <><option value="true">Yes</option><option value="false">No</option></> : choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>); })}
      {any && !rc.design && <button type="button" className="ap-outline-btn" style={{ height: 32 }} onClick={savePreset}>Save filters</button>}
      {any && <button type="button" className="ap-outline-btn" style={{ height: 32 }} onClick={() => { const n = new URLSearchParams(params.toString()); for (const k of [...n.keys()]) if (k.startsWith("f_")) n.delete(k); setQ(""); router.replace(`${path}${n.toString() ? `?${n}` : ""}`, { scroll: false }); }}>Clear filters</button>}
    </div>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function CalendarComp({ comp, data, rc }: { comp: Component; data?: ComponentData; rc: RuntimeInfo }) {
  const p = comp.props;
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  if (data?.kind !== "rows") return <Card title={p.title}><State d={data} /></Card>;
  const df = data.fields.find((f) => f.id === p.dateFieldId);
  if (!df) return <Card title={p.title}><div className="ap-muted">Choose a date field in the inspector.</div></Card>;
  const primary = data.fields.find((f) => f.isPrimary) ?? data.fields[0];
  const byDay = new Map<string, typeof data.rows>();
  for (const r of data.rows) { const v = r.values[df.id]; if (!v) continue; const d = new Date(String(v)); if (isNaN(+d)) continue; const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; byDay.set(k, [...(byDay.get(k) ?? []), r]); }
  const start = new Date(cur); start.setDate(1 - ((cur.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const today = new Date().toDateString();
  return (
    <Card title={p.title} subtitle={p.subtitle} action={<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <button type="button" className="ap-icon-btn" aria-label="Previous month" onClick={() => setCur(new Date(cur.getFullYear(), cur.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
      <span className="ap-strong" style={{ minWidth: 130, textAlign: "center" }}>{MONTHS[cur.getMonth()]} {cur.getFullYear()}</span>
      <button type="button" className="ap-icon-btn" aria-label="Next month" onClick={() => setCur(new Date(cur.getFullYear(), cur.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
      <button type="button" className="ap-outline-btn" style={{ height: 28, padding: "0 10px" }} onClick={() => { const d = new Date(); setCur(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
    </div>}>
      <div className="ap-cal" role="grid" aria-label={`${p.title ?? "Calendar"}, ${MONTHS[cur.getMonth()]} ${cur.getFullYear()}`}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="ap-cal-h" role="columnheader">{d}</div>)}
        {days.map((d) => { const items = byDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? []; return (
          <div key={d.toISOString()} role="gridcell" className={`ap-cal-d ${d.getMonth() !== cur.getMonth() ? "out" : ""} ${d.toDateString() === today ? "today" : ""}`}>
            <span className="ap-cal-n">{d.getDate()}</span>
            {items.slice(0, 3).map((r) => { const href = p.detailPageId ? detailHref(rc, p.detailPageId, r.id) : null; const t = cellText(primary as never, r.values[primary.id]) || "Unnamed"; return href && !rc.design ? <Link key={r.id} href={href} className="ap-cal-ev" title={t}>{t}</Link> : <span key={r.id} className="ap-cal-ev" title={t}>{t}</span>; })}
            {items.length > 3 && <span className="ap-muted" style={{ fontSize: 11 }}>+{items.length - 3} more</span>}
          </div>); })}
      </div>
    </Card>
  );
}

function GalleryComp({ comp, data, rc }: { comp: Component; data?: ComponentData; rc: RuntimeInfo }) {
  const p = comp.props;
  if (data?.kind !== "rows") return <Card title={p.title}><State d={data} /></Card>;
  const primary = data.fields.find((f) => f.isPrimary) ?? data.fields[0];
  const extra = pickFields(data.fields, p.fieldIds, 4).filter((f) => f.id !== primary?.id && f.id !== p.imageFieldId).slice(0, 4);
  return (
    <Card title={p.title} subtitle={p.subtitle} action={<span className="ap-muted" style={{ fontSize: 12 }}>{data.total} {data.total === 1 ? "record" : "records"}</span>}>
      <div className="ap-gallery">
        {data.rows.map((r) => {
          const img = p.imageFieldId ? ((r.values[p.imageFieldId] as { id: string; type?: string }[] | null) ?? []).find((a) => !a.type || a.type.startsWith("image/")) : undefined;
          const href = p.detailPageId ? detailHref(rc, p.detailPageId, r.id) : null;
          const body = <>
            {p.imageFieldId && <div className="ap-gal-img">{img ? <img src={`/api/platform/attachments/${img.id}`} alt="" loading="lazy" /> : <ImageIcon size={22} aria-hidden />}</div>}
            <div style={{ padding: 12, display: "grid", gap: 4 }}>
              <div className="ap-strong">{cellText(primary as never, r.values[primary.id]) || "Unnamed"}</div>
              {extra.map((f) => <div key={f.id} style={{ fontSize: 12 }}><span className="ap-muted">{f.name}: </span><CellView f={asField(f)} v={r.values[f.id]} /></div>)}
            </div>
          </>;
          return href && !rc.design ? <Link key={r.id} href={href} className="ap-gal-card ap-click">{body}</Link> : <div key={r.id} className="ap-gal-card">{body}</div>;
        })}
        {!data.rows.length && <div className="ap-muted">No records.</div>}
      </div>
    </Card>
  );
}

function KanbanComp({ comp, data, rc }: { comp: Component; data?: ComponentData; rc: RuntimeInfo }) {
  const router = useRouter();
  const p = comp.props;
  const [drag, setDrag] = useState<string | null>(null);
  const [rows, setRows] = useState(data?.kind === "rows" ? data.rows : []);
  const [err, setErr] = useState("");
  if (data?.kind !== "rows") return <Card title={p.title}><State d={data} /></Card>;
  const g = data.fields.find((f) => f.id === p.groupFieldId);
  if (!g) return <Card title={p.title}><div className="ap-muted">Choose a single-select field to group cards by.</div></Card>;
  const choices = (g.options.choices as { id: string; name: string; color: string }[] | undefined) ?? [];
  const primary = data.fields.find((f) => f.isPrimary) ?? data.fields[0];
  const extra = pickFields(data.fields, p.fieldIds, 3).filter((f) => f.id !== primary.id && f.id !== g.id).slice(0, 2);
  const live = rows.length || !data.rows.length ? rows : data.rows;
  const canMove = p.allowMove && !rc.design && rc.role !== "portal" && ["owner", "creator", "editor"].includes(rc.role);
  return (
    <Card title={p.title} subtitle={p.subtitle}>
      {err && <div className="ap-error" role="alert">{err}</div>}
      <div className="ap-kanban" tabIndex={0} role="region" aria-label={`${p.title ?? "Board"} columns`}>
        {choices.map((ch) => {
          const items = live.filter((r) => r.values[g.id] === ch.id);
          return (
            <div key={ch.id} className={`ap-kcol tint-${ch.color}`} onDragOver={(e) => canMove && e.preventDefault()}
              onDrop={async () => {
                if (!drag || !canMove) return; const before = live;
                setRows(live.map((r) => (r.id === drag ? { ...r, values: { ...r.values, [g.id]: ch.id } } : r)));
                const res = await appUpdateAction(rc.slug, rc.pageId, comp.id, drag, { [g.id]: ch.id }, rc.preview);
                if (!res.ok) { setErr(res.error); setRows(before); } else router.refresh();
              }}>
              <div className="ap-kcol-h"><span>{ch.name}</span><span className="ap-count">{items.length}</span></div>
              {items.slice(0, 50).map((r) => {
                const href = p.detailPageId ? detailHref(rc, p.detailPageId, r.id) : null;
                return (
                  <article key={r.id} className="ap-kcard" draggable={canMove} onDragStart={() => setDrag(r.id)} onClick={() => href && !rc.design && router.push(href)}>
                    <div className="ap-strong">{cellText(primary as never, r.values[primary.id]) || "Unnamed"}</div>
                    {extra.map((f) => <div key={f.id} className="ap-muted" style={{ fontSize: 12 }}>{cellText(f as never, r.values[f.id])}</div>)}
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ago(iso: string) { const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; }
function ActivityComp({ comp, data, rc }: { comp: Component; data?: ComponentData; rc: RuntimeInfo }) {
  const p = comp.props;
  if (data?.kind !== "rows") return <Card title={p.title}><State d={data} /></Card>;
  const t = data.fields.find((f) => f.id === p.titleFieldId) ?? data.fields.find((f) => f.isPrimary) ?? data.fields[0];
  const s = data.fields.find((f) => f.id === p.subtitleFieldId);
  return (
    <Card title={p.title}>
      <ul className="ap-activity">
        {data.rows.map((r) => {
          const href = p.detailPageId ? detailHref(rc, p.detailPageId, r.id) : null;
          const inner = <><span className="ap-act-dot" aria-hidden><Activity size={14} /></span><span style={{ minWidth: 0, flex: 1 }}><span className="ap-strong" style={{ display: "block" }}>{cellText(t as never, r.values[t.id]) || "Unnamed"}</span>{s && <span className="ap-muted" style={{ fontSize: 12 }}>{cellText(s as never, r.values[s.id])}</span>}</span><span className="ap-muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{ago(r.createdAt)}</span></>;
          return <li key={r.id}>{href && !rc.design ? <Link href={href} className="ap-act-row">{inner}</Link> : <div className="ap-act-row">{inner}</div>}</li>;
        })}
        {!data.rows.length && <li className="ap-muted">Nothing yet.</li>}
      </ul>
    </Card>
  );
}

function RecordComp({ comp, data, rc }: { comp: Component; data?: ComponentData; rc: RuntimeInfo }) {
  const router = useRouter();
  const p = comp.props;
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  if (data?.kind !== "record") return <Card><State d={data} /></Card>;
  if (!data.row) return <Card><div className="ap-muted">Record not found.</div></Card>;
  const row = data.row;
  const primary = data.fields.find((f) => f.isPrimary) ?? data.fields[0];
  const editable = (f: FieldLite) => p.allowEdit && !rc.design && rc.role !== "portal" && ["singleLineText", "longText", "number", "currency", "percent", "email", "url", "phone", "date"].includes(f.type) && ["owner", "creator", "editor"].includes(rc.role);
  const detailFor = (tableId: string) => rc.pages.find((x) => x.kind === "detail" && x.tableId === tableId);
  return (
    <div className="ap-record">
      <Card title={cellText(primary as never, row.values[primary.id]) || "Unnamed"} subtitle={data.tableName}>
        {err && <div className="ap-error" role="alert">{err}</div>}
        <dl className="ap-fields">
          {data.fields.filter((f) => f.type !== "link" && !f.isPrimary).map((f) => (
            <div key={f.id} className="ap-field">
              <dt>{f.name}</dt>
              <dd>
                {editing === f.id ? (
                  <form onSubmit={async (e) => { e.preventDefault(); setErr(""); const r = await appUpdateAction(rc.slug, rc.pageId, comp.id, row.id, { [f.id]: val === "" ? null : val }, rc.preview); setEditing(null); if (!r.ok) setErr(r.error); else router.refresh(); }} style={{ display: "flex", gap: 6 }}>
                    <input autoFocus className="ap-input" aria-label={f.name} value={val} type={f.type === "date" ? "date" : "text"} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
                    <Button label="Save" variant="primary" type="submit" />
                  </form>
                ) : (
                  <span className={editable(f) ? "ap-editable" : undefined} role={editable(f) ? "button" : undefined} tabIndex={editable(f) ? 0 : undefined}
                    onClick={() => { if (editable(f)) { setVal(row.values[f.id] == null ? "" : String(f.type === "date" ? String(row.values[f.id]).slice(0, 10) : row.values[f.id])); setEditing(f.id); } }}>
                    <CellView f={asField(f)} v={row.values[f.id]} />{row.values[f.id] == null && <span className="ap-muted">—</span>}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      {data.related.map((r) => {
        const dp = detailFor(r.tableId);
        return (
          <Card key={r.fieldId} title={r.name} subtitle={`${r.rows.length} linked`}>
            <ul className="ap-related">
              {r.rows.map((x) => <li key={x.id}>{dp && !rc.design ? <Link href={`/a/${rc.slug}/${dp.slug}/${x.id}${rc.preview ? "?preview=1" : ""}`}>{x.title || "Unnamed"} <ChevronRight size={14} /></Link> : <span>{x.title || "Unnamed"}</span>}</li>)}
              {!r.rows.length && <li className="ap-muted">None linked.</li>}
            </ul>
          </Card>
        );
      })}
      {p.showComments && rc.role !== "portal" && (
        <Card title="Comments" subtitle={`${data.comments.length}`}>
          <ul className="ap-related">{data.comments.map((c) => <li key={c.id}><span><span className="ap-strong">{c.author ?? "Someone"}</span> <span className="ap-muted" style={{ fontSize: 12 }}>{ago(c.createdAt)}</span><span style={{ display: "block", whiteSpace: "pre-wrap" }}>{c.body.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, "@$1")}</span></span></li>)}</ul>
          {!rc.design && ["owner", "creator", "editor", "commenter"].includes(rc.role) && (
            <form style={{ display: "flex", gap: 8, marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (!comment.trim()) return; const r = await appCommentAction(rc.slug, rc.pageId, comp.id, row.id, comment, rc.preview); if (!r.ok) setErr(r.error); else { setComment(""); router.refresh(); } }}>
              <input className="ap-input" aria-label="Add a comment" placeholder="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} style={{ flex: 1 }} />
              <Button label="Post" type="submit" />
            </form>
          )}
        </Card>
      )}
    </div>
  );
}

function FormComp({ comp, data, rc }: { comp: Component; data?: ComponentData; rc: RuntimeInfo }) {
  const router = useRouter();
  const p = comp.props;
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (data?.kind !== "form") return <Card title={p.title}><State d={data} /></Card>;
  const shown = data.fields.filter((f) => { const c = p.conditional?.[f.id]; if (!c) return true; const v = vals[c.fieldId]; return c.op === "isNotEmpty" ? v !== undefined && v !== "" && v !== null && v !== false : c.op === "isChecked" ? v === true : String(v ?? "") === String(c.value ?? ""); });
  const set = (id: string, v: unknown) => setVals((s) => ({ ...s, [id]: v }));
  return (
    <Card title={p.title} subtitle={p.subtitle}>
      <form className="ap-form" onSubmit={async (e) => {
        e.preventDefault(); if (rc.design) return; setErr(""); setMsg(""); setBusy(true);
        const payload = Object.fromEntries(Object.entries(vals).filter(([k]) => shown.some((f) => f.id === k)));
        const r = await appFormAction(rc.slug, rc.pageId, comp.id, payload, { preview: rc.preview, recordId: rc.recordId });
        setBusy(false);
        if (!r.ok) setErr(r.error); else { setVals({}); setMsg(p.successMessage || "Saved."); router.refresh(); }
      }}>
        {shown.map((f) => {
          const id = `${comp.id}-${f.id}`; const req = p.required?.includes(f.id);
          const choices = (f.options.choices as { id: string; name: string }[] | undefined) ?? [];
          return (
            <div key={f.id} className="ap-form-row">
              <label htmlFor={id}>{f.name}{req && <span aria-label="required" style={{ color: "var(--color-text-red)" }}> *</span>}</label>
              {f.type === "longText" ? <textarea id={id} className="ap-input" rows={3} value={String(vals[f.id] ?? "")} onChange={(e) => set(f.id, e.target.value)} required={req} />
                : f.type === "singleSelect" ? <select id={id} className="ap-input" value={String(vals[f.id] ?? "")} onChange={(e) => set(f.id, e.target.value || null)} required={req}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                : f.type === "checkbox" ? <input id={id} type="checkbox" checked={!!vals[f.id]} onChange={(e) => set(f.id, e.target.checked)} />
                : f.type === "multipleSelects" ? <select id={id} className="ap-input" multiple value={(vals[f.id] as string[]) ?? []} onChange={(e) => set(f.id, [...e.target.selectedOptions].map((o) => o.value))}>{choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                : <input id={id} className="ap-input" required={req} type={f.type === "date" ? "date" : f.type === "dateTime" ? "datetime-local" : f.type === "email" ? "email" : f.type === "url" ? "url" : "text"} inputMode={["number", "currency", "percent", "rating", "duration"].includes(f.type) ? "decimal" : undefined} value={String(vals[f.id] ?? "")} onChange={(e) => set(f.id, e.target.value)} />}
            </div>
          );
        })}
        {err && <div className="ap-error" role="alert">{err}</div>}
        {msg && <div role="status" className="ap-success">{msg}</div>}
        <div><Button label={busy ? "Saving…" : p.submitLabel || "Submit"} variant="primary" type="submit" isDisabled={busy || rc.design} /></div>
      </form>
    </Card>
  );
}

function ButtonComp({ comp, rc }: { comp: Component; rc: RuntimeInfo }) {
  const router = useRouter();
  const p = comp.props;
  const [msg, setMsg] = useState("");
  return (
    <div className="ap-button">
      <Button label={p.label || "Button"} variant={p.variant === "danger" ? "destructive" : p.variant === "secondary" ? "secondary" : "primary"} isDisabled={rc.design}
        clickAction={async () => {
          if (p.action?.confirm && !(await confirmDialog(p.action.confirm))) return;
          setMsg("");
          const r = await appButtonAction(rc.slug, rc.pageId, comp.id, rc.recordId, rc.preview);
          if (!r.ok) { setMsg(r.error); return; }
          if ("navigate" in r.data && r.data.navigate) router.push(`/a/${rc.slug}/${r.data.navigate}${rc.preview ? "?preview=1" : ""}`);
          else if ("url" in r.data && r.data.url) window.open(r.data.url, "_blank", "noopener");
          else if ("message" in r.data) { setMsg(r.data.message ?? "Done."); router.refresh(); }
        }} />
      {msg && <span role="status" className="ap-muted" style={{ fontSize: 13 }}>{msg}</span>}
    </div>
  );
}
