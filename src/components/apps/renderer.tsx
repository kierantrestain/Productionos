"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Layers, Gauge, TrendingUp, CircleCheck, CalendarClock, Users, PoundSterling, Activity, ChevronRight, FileText, Clock } from "lucide-react";
import type { Component, Page } from "@/lib/apps/types";
import type { ComponentData, FieldLite } from "@/server/apps/data";
import { CellView } from "@/components/platform/cells";
import { cellText } from "@/lib/platform/cell-text";
import { appButtonAction, appCommentAction, appFormAction, appUpdateAction } from "@/app/apps-actions";
import { BarChart, DonutChart, LineChart } from "./charts";

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
    case "chart": {
      const { fmt, short } = formatter(p.format);
      return (
        <Card title={p.title} subtitle={p.subtitle}>
          {data?.kind === "series" ? (data.series.length ? (p.chart === "line" ? <LineChart data={data.series} fmt={fmt} short={short} /> : p.chart === "donut" ? <DonutChart data={data.series} fmt={fmt} short={short} /> : <BarChart data={data.series} fmt={fmt} short={short} />) : <div className="ap-muted">No data yet.</div>) : <State d={data} />}
        </Card>
      );
    }
    case "table": return <TableComp comp={comp} data={data} rc={rc} />;
    case "kanban": return <KanbanComp comp={comp} data={data} rc={rc} />;
    case "activity": return <ActivityComp comp={comp} data={data} rc={rc} />;
    case "record": return <RecordComp comp={comp} data={data} rc={rc} />;
    case "form": return <FormComp comp={comp} data={data} rc={rc} />;
    case "button": return <ButtonComp comp={comp} rc={rc} />;
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
  if (data?.kind !== "rows") return <Card title={p.title}><State d={data} /></Card>;
  const cols = pickFields(data.fields, p.fieldIds);
  return (
    <Card title={p.title} subtitle={p.subtitle} action={<span className="ap-muted" style={{ fontSize: 12 }}>{data.total} {data.total === 1 ? "record" : "records"}</span>}>
      <div className="ap-table-wrap">
        <table className="ap-table">
          <thead><tr>{cols.map((f) => <th key={f.id} scope="col">{f.name}</th>)}</tr></thead>
          <tbody>
            {data.rows.map((r) => {
              const href = p.detailPageId ? detailHref(rc, p.detailPageId, r.id) : null;
              return (
                <tr key={r.id} className={href ? "ap-click" : undefined} onClick={() => href && !rc.design && router.push(href)} tabIndex={href ? 0 : undefined} onKeyDown={(e) => { if (e.key === "Enter" && href && !rc.design) router.push(href); }}>
                  {cols.map((f) => <td key={f.id} className={f.isPrimary ? "ap-strong" : undefined}><span className="ap-cell-in"><CellView f={asField(f)} v={r.values[f.id]} /></span></td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.rows.length && <div className="ap-muted" style={{ padding: 16 }}>No records.</div>}
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
      <div className="ap-kanban">
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
          if (p.action?.confirm && !confirm(p.action.confirm)) return;
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
