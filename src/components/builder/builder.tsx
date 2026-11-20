"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@/components/ui/modal";
import { Monitor, Tablet, Smartphone, Play, Upload, History, Grid2x2, Trash2, Copy, ArrowLeft, ArrowRight, Plus, Gauge, BarChart3, Table2, Kanban, Activity, Heading, Text, Minus, FormInput, MousePointerClick, FileText, Search, CalendarDays, LayoutGrid, Target, ChevronUp, ChevronDown, Settings } from "lucide-react";
import { defaultProps, newId, PALETTE, slugify, type AppConfig, type Component, type ComponentType, type Page } from "@/lib/apps/types";
import type { ComponentData } from "@/server/apps/data";
import { listVersionsAction, previewDataAction, publishAppAction, rollbackAppAction, sampleRecordsAction, saveDraftAction, updateAppMetaAction } from "@/app/apps-actions";
import { PageGrid } from "@/components/apps/renderer";
import { PAGE_ICONS } from "@/components/apps/shell";
import { ComponentInspector, PageInspector, type Meta } from "./inspector";
import { confirmDialog } from "@/components/ui/dialogs";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const TILE_ICONS: Record<string, React.ComponentType<{ size?: number }>> = { gauge: Gauge, chart: BarChart3, table: Table2, kanban: Kanban, activity: Activity, heading: Heading, text: Text, divider: Minus, form: FormInput, button: MousePointerClick, record: FileText, calendar: CalendarDays, gallery: LayoutGrid, progress: Target };
type AppInfo = { id: string; name: string; slug: string; audience: string; baseId: string; published: boolean; revision: number };

export function Builder({ app, initial, meta }: { app: AppInfo; initial: AppConfig; meta: Meta }) {
  const [config, setConfig] = useState<AppConfig>(initial);
  const [pageId, setPageId] = useState<string | undefined>(initial.homePageId ?? initial.pages[0]?.id);
  const [sel, setSel] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [left, setLeft] = useState<"components" | "pages" | "app">("components");
  const [right, setRight] = useState<"props" | "data" | "visibility">("props");
  const [revision, setRevision] = useState(app.revision);
  const [save, setSave] = useState<"saved" | "saving" | "dirty" | "conflict" | "error">("saved");
  const [saveErr, setSaveErr] = useState("");
  const [data, setData] = useState<Record<string, ComponentData>>({});
  const [samples, setSamples] = useState<Record<string, { id: string; title: string }[]>>({});
  const [sample, setSample] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<null | "publish" | "versions">(null);
  const [toast, setToast] = useState("");
  const first = useRef(true);
  const canvasRef = useRef<HTMLDivElement>(null);
  const page = config.pages.find((p) => p.id === pageId) ?? config.pages[0];
  const selected = page?.components.find((c) => c.id === sel) ?? null;
  const defaultTable = meta.tables[0]?.id;

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };
  const updatePage = useCallback((fn: (p: Page) => Page) => setConfig((c) => ({ ...c, pages: c.pages.map((p) => (p.id === pageId ? fn(p) : p)) })), [pageId]);
  const updateComp = (comp: Component) => updatePage((p) => ({ ...p, components: p.components.map((c) => (c.id === comp.id ? comp : c)) }));

  // Autosave (debounced) with optimistic revision check.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSave("dirty");
    const t = setTimeout(async () => {
      setSave("saving");
      const r = await saveDraftAction(app.id, config, revision);
      if (r.ok) { setRevision(r.data.revision); setSave("saved"); setSaveErr(""); }
      else { setSave(r.code === "conflict" ? "conflict" : "error"); setSaveErr(r.error); }
    }, 900);
    return () => clearTimeout(t);
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detail pages need a sample record to preview with.
  useEffect(() => {
    if (page?.kind !== "detail" || !page.tableId || samples[page.tableId]) return;
    sampleRecordsAction(app.id, page.tableId).then((r) => { if (r.ok) { setSamples((s) => ({ ...s, [page.tableId!]: r.data })); if (r.data[0]) setSample((s) => ({ ...s, [page.id]: r.data[0].id })); } });
  }, [page?.id, page?.kind, page?.tableId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live data for the canvas from the draft config.
  const dataKey = useMemo(() => JSON.stringify({ c: page?.components.map((c) => ({ id: c.id, type: c.type, props: c.props })), k: page?.kind, t: page?.tableId, r: page ? sample[page.id] : undefined }), [page, sample]);
  useEffect(() => {
    if (!page) return;
    const t = setTimeout(async () => {
      const r = await previewDataAction(app.id, page, page.components, page.kind === "detail" ? sample[page.id] : undefined);
      if (r.ok) setData(r.data as Record<string, ComponentData>);
    }, 350);
    return () => clearTimeout(t);
  }, [dataKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const insert = (type: ComponentType, beforeId?: string) => {
    const item = PALETTE.flatMap((g) => g.items).find((i) => i.type === type)!;
    const used = page?.components.map((c) => c.props.data?.tableId).filter(Boolean) as string[] | undefined;
    const pageTable = used?.length ? used.sort((a, b) => used.filter((x) => x === b).length - used.filter((x) => x === a).length)[0] : defaultTable;
    const props = defaultProps(type, page?.kind === "detail" && type !== "record" ? undefined : pageTable);
    // Smart defaults: pre-pick the obvious field so a dropped component shows real data straight away.
    const tf = meta.fields.filter((f) => f.tableId === props.data?.tableId);
    const first = (types: string[]) => tf.find((f) => types.includes(f.type))?.id;
    if (type === "calendar") props.dateFieldId = first(["date", "dateTime"]) ?? first(["createdTime"]);
    if (type === "gallery") props.imageFieldId = first(["attachment"]);
    if (type === "kanban" || type === "chart") props.groupFieldId = first(["singleSelect"]) ?? (type === "chart" ? first(["date", "dateTime", "checkbox", "multipleSelects"]) : undefined);
    if (["table", "kanban", "activity", "calendar", "gallery"].includes(type)) { const d = page && config.pages.find((x) => x.kind === "detail" && x.tableId === props.data?.tableId); if (d) props.detailPageId = d.id; }
    const comp: Component = { id: newId(), type, w: item.w, props };
    updatePage((p) => { const list = [...p.components]; const i = beforeId ? list.findIndex((c) => c.id === beforeId) : -1; list.splice(i < 0 ? list.length : i, 0, comp); return { ...p, components: list }; });
    setSel(comp.id); setRight(["heading", "text", "divider", "button"].includes(type) ? "props" : "data");
  };
  const move = (id: string, beforeId?: string) => updatePage((p) => {
    const list = p.components.filter((c) => c.id !== id); const comp = p.components.find((c) => c.id === id)!;
    const i = beforeId ? list.findIndex((c) => c.id === beforeId) : -1; list.splice(i < 0 ? list.length : i, 0, comp); return { ...p, components: list };
  });
  const shift = (id: string, d: number) => updatePage((p) => { const l = [...p.components]; const i = l.findIndex((c) => c.id === id); const j = i + d; if (j < 0 || j >= l.length) return p; [l[i], l[j]] = [l[j], l[i]]; return { ...p, components: l }; });
  const remove = (id: string) => { updatePage((p) => ({ ...p, components: p.components.filter((c) => c.id !== id) })); setSel(null); };
  const duplicate = (id: string) => updatePage((p) => { const i = p.components.findIndex((c) => c.id === id); const copy = { ...structuredClone(p.components[i]), id: newId() }; const l = [...p.components]; l.splice(i + 1, 0, copy); return { ...p, components: l }; });

  const startResize = (comp: Component, e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const grid = canvasRef.current?.querySelector(".ap-grid") as HTMLElement | null; if (!grid) return;
    const colW = grid.clientWidth / 12; const x0 = e.clientX; const w0 = comp.w;
    const mv = (ev: PointerEvent) => { const w = Math.max(1, Math.min(12, Math.round(w0 + (ev.clientX - x0) / colW))); if (w !== comp.w) updateComp({ ...comp, w }); comp = { ...comp, w }; };
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };

  const onDropAt = (e: React.DragEvent, beforeId?: string) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(null);
    const t = e.dataTransfer.getData("text/x-new"); const m = e.dataTransfer.getData("text/x-move");
    if (t) insert(t as ComponentType, beforeId); else if (m && m !== beforeId) move(m, beforeId);
  };

  const addPage = (kind: "dashboard" | "detail") => {
    const title = kind === "detail" ? `${meta.tables[0]?.name ?? "Record"} detail` : `Page ${config.pages.length + 1}`;
    let slug = slugify(title); while (config.pages.some((p) => p.slug === slug)) slug = `${slug}-2`;
    const pg: Page = kind === "detail"
      ? { id: newId("p"), title, slug, kind, tableId: meta.tables[0]?.id, hidden: true, icon: "file", components: [{ id: newId(), type: "record", w: 12, props: defaultProps("record") }] }
      : { id: newId("p"), title, slug, kind, icon: "dashboard", components: [] };
    setConfig((c) => ({ ...c, pages: [...c.pages, pg] })); setPageId(pg.id); setSel(null); setLeft("pages");
  };

  const width = device === "desktop" ? "100%" : device === "tablet" ? 820 : 400;
  const rc = { slug: app.slug, pageId: page?.id ?? "", preview: true, role: "creator", design: true, recordId: page && page.kind === "detail" ? sample[page.id] : undefined, pages: config.pages.map((p) => ({ id: p.id, slug: p.slug, kind: p.kind, tableId: p.tableId })) };
  const tiles = PALETTE.map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())) })).filter((g) => g.items.length);

  return (
    <div className="bd-root">
      <header className="bd-top">
        <Link href="/" className="ap-brand" style={{ padding: 0, textDecoration: "none", color: "inherit", fontSize: 16 }}><span className="ap-logo" aria-hidden><Grid2x2 size={16} /></span>Bang On OS</Link>
        <div className="bd-mode" role="group" aria-label="Mode"><span className="on">Builder</span>{app.published ? <Link href={`/a/${app.slug}`}>App</Link> : <span title="Publish to open App mode" style={{ opacity: .5 }}>App</span>}</div>
        <span className="ap-strong">{app.name}</span>
        <span className="ap-muted" style={{ fontSize: 13 }}>Builder › Pages › {page?.title}</span>
        <span style={{ flex: 1 }} />
        <span role="status" className="ap-muted" style={{ fontSize: 12, color: save === "conflict" || save === "error" ? "var(--color-text-red)" : undefined }}>
          {save === "saved" ? "Draft saved" : save === "saving" ? "Saving…" : save === "dirty" ? "Unsaved changes" : saveErr}
        </span>
        {save === "conflict" && <button type="button" className="ap-outline-btn" onClick={() => window.location.reload()}>Reload</button>}
        <ThemeToggle />
      </header>
      <div className="bd-sub">
        <div>
          <div className="ap-strong" style={{ fontSize: 16 }}>{app.name} <span className="ap-muted" style={{ fontWeight: 400 }}>(Draft)</span></div>
          <div className="ap-muted" style={{ fontSize: 13 }}>Data from “{meta.baseName}”. Changes save automatically as a draft until you publish.</div>
        </div>
        <span style={{ flex: 1 }} />
        <div className="bd-mode" role="group" aria-label="Device preview">
          {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([d, I]) => <button key={d} type="button" className={device === d ? "on" : ""} aria-pressed={device === d} aria-label={d} onClick={() => setDevice(d)} style={{ border: 0, background: device === d ? "var(--color-accent)" : "transparent", color: device === d ? "#fff" : "inherit", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}><I size={16} /></button>)}
        </div>
        <a href={`/a/${app.slug}/${page?.kind === "detail" && rc.recordId ? `${page.slug}/${rc.recordId}` : page?.slug ?? ""}?preview=1`} target="_blank" rel="noopener" className="ap-outline-btn" style={{ borderColor: "var(--color-border)", color: "inherit" }}><Play size={14} />Preview</a>
        <Button label="Versions" icon={<History size={15} />} onClick={() => setDialog("versions")} />
        <Button label="Publish" variant="primary" icon={<Upload size={15} />} onClick={() => setDialog("publish")} isDisabled={save === "saving" || save === "dirty" || save === "conflict"} />
      </div>
      <div className="bd-body">
        <aside className="bd-left" aria-label="Builder panels">
          <div className="bd-tabs" role="tablist" style={{ margin: "-12px -12px 10px" }}>
            {(["components", "pages", "app"] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={left === t} onClick={() => setLeft(t)}>{t === "components" ? "Components" : t === "pages" ? "Pages" : "App"}</button>)}
          </div>
          {left === "components" && <>
            <label style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--color-border)", borderRadius: 8, padding: "0 8px" }}><Search size={14} /><input aria-label="Search components" placeholder="Search components…" value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 0, outline: 0, background: "transparent", font: "inherit", fontSize: 13, height: 32, flex: 1, color: "inherit" }} /></label>
            {tiles.map((g) => (
              <div key={g.group}>
                <div className="bd-sect">{g.group}</div>
                <div className="bd-palette">
                  {g.items.filter((i) => i.type !== "record" || page?.kind === "detail").map((i) => { const I = TILE_ICONS[i.icon] ?? Grid2x2; return (
                    <button key={i.type} type="button" className="bd-tile" draggable onDragStart={(e) => { e.dataTransfer.setData("text/x-new", i.type); e.dataTransfer.effectAllowed = "copy"; }} onClick={() => insert(i.type)} aria-label={`Add ${i.label}`}>
                      <I size={20} />{i.label}
                    </button>
                  ); })}
                </div>
              </div>
            ))}
            <p className="ap-muted" style={{ fontSize: 12, marginTop: 12 }}>Drag onto the canvas, or click to add at the end.</p>
          </>}
          {left === "pages" && <>
            <div className="bd-pagelist" role="list">
              {config.pages.map((p, i) => { const I = PAGE_ICONS[p.icon ?? "dashboard"] ?? FileText; return (
                <div key={p.id} role="listitem" style={{ display: "flex", alignItems: "center", paddingLeft: p.parentId ? 14 : 0 }}>
                  <button type="button" aria-current={p.id === page?.id} onClick={() => { setPageId(p.id); setSel(null); }} style={{ flex: 1 }}><I size={15} />{p.title}{p.kind === "detail" && <span className="ap-muted" style={{ fontSize: 11 }}>detail</span>}{p.hidden && p.kind !== "detail" && <span className="ap-muted" style={{ fontSize: 11 }}>hidden</span>}</button>
                  <button type="button" className="ap-icon-btn" aria-label={`Move ${p.title} up`} disabled={i === 0} onClick={() => setConfig((c) => { const l = [...c.pages]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; return { ...c, pages: l }; })}><ChevronUp size={14} /></button>
                  <button type="button" className="ap-icon-btn" aria-label={`Move ${p.title} down`} disabled={i === config.pages.length - 1} onClick={() => setConfig((c) => { const l = [...c.pages]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; return { ...c, pages: l }; })}><ChevronDown size={14} /></button>
                </div>
              ); })}
            </div>
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              <button type="button" className="ap-outline-btn" onClick={() => addPage("dashboard")}><Plus size={14} />Add page</button>
              <button type="button" className="ap-outline-btn" onClick={() => addPage("detail")}><Plus size={14} />Add record detail page</button>
            </div>
            <p className="ap-muted" style={{ fontSize: 12, marginTop: 10 }}>Navigation follows this order. Nest pages and hide them from navigation in page settings (select a page, click empty canvas).</p>
          </>}
          {left === "app" && <AppSettings app={app} config={config} meta={meta} setConfig={setConfig} notify={notify} />}
        </aside>

        <main className="bd-canvas-wrap" onClick={() => setSel(null)}>
          <div className="bd-pages"><div role="tablist" aria-label="Pages" style={{ display: "contents" }}>
            {config.pages.filter((p) => !p.hidden || p.kind === "detail" || p.id === page?.id).map((p) => { const I = PAGE_ICONS[p.icon ?? "dashboard"] ?? FileText; return <button key={p.id} type="button" role="tab" className="bd-pagetab" aria-selected={p.id === page?.id} onClick={(e) => { e.stopPropagation(); setPageId(p.id); setSel(null); }}><I size={15} />{p.title}</button>; })}
            </div>
            <button type="button" className="bd-pagetab" aria-label="Add page" onClick={(e) => { e.stopPropagation(); addPage("dashboard"); }}><Plus size={15} /></button>
          </div>
          {page?.kind === "detail" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, fontSize: 13 }} onClick={(e) => e.stopPropagation()}>
              <span className="ap-muted">Previewing with record</span>
              <select aria-label="Sample record" className="bd-input" style={{ width: 260 }} value={sample[page.id] ?? ""} onChange={(e) => setSample((s) => ({ ...s, [page.id]: e.target.value }))}>{(samples[page.tableId ?? ""] ?? []).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
            </div>
          )}
          <div className="bd-canvas" ref={canvasRef} style={{ maxWidth: width }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropAt(e)}>
            <div className="ap-page-head"><h1 style={{ fontSize: device === "mobile" ? 22 : 28 }}>{page?.heading || page?.title}</h1>{page?.subtitle && <p>{page.subtitle}</p>}</div>
            {page && <div className={device === "mobile" ? "bd-force-mobile" : device === "tablet" ? "bd-force-tablet" : undefined}>
              <PageGrid page={page} data={data} rc={rc} wrap={(c, node) => (
                <div className={`bd-frame ${sel === c.id ? "sel" : ""} ${dragOver === c.id ? "drop-before" : ""}`} draggable tabIndex={0} role="button" aria-label={`${c.type} component${c.props.title ? `: ${c.props.title}` : ""}`}
                  onClick={(e) => { e.stopPropagation(); setSel(c.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter") setSel(c.id); if ((e.key === "Delete" || e.key === "Backspace") && sel === c.id) remove(c.id); }}
                  onDragStart={(e) => { e.dataTransfer.setData("text/x-move", c.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(c.id); }} onDragLeave={() => setDragOver(null)} onDrop={(e) => onDropAt(e, c.id)}>
                  <div className="bd-frame-tools" onClick={(e) => e.stopPropagation()}>
                    <button type="button" aria-label="Move earlier" onClick={() => shift(c.id, -1)}><ArrowLeft size={13} /></button>
                    <button type="button" aria-label="Move later" onClick={() => shift(c.id, 1)}><ArrowRight size={13} /></button>
                    <button type="button" aria-label="Duplicate" onClick={() => duplicate(c.id)}><Copy size={13} /></button>
                    <button type="button" aria-label="Delete component" onClick={() => remove(c.id)}><Trash2 size={13} /></button>
                  </div>
                  <span className="bd-resize" role="slider" aria-label="Width" aria-valuemin={1} aria-valuemax={12} aria-valuenow={c.w} tabIndex={-1} onPointerDown={(e) => startResize(c, e)} />
                  {node}
                </div>
              )} />
              <div className={`bd-dropzone ${dragOver === "__end" ? "on" : ""}`} style={{ marginTop: 14 }} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver("__end"); }} onDragLeave={() => setDragOver(null)} onDrop={(e) => onDropAt(e)}>Drop components here</div>
            </div>}
          </div>
        </main>

        <aside className="bd-right" aria-label="Inspector">
          {selected && page ? <>
            <div className="bd-tabs" role="tablist">
              {(["props", "data", "visibility"] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={right === t} onClick={() => setRight(t)}>{t === "props" ? "Properties" : t === "data" ? "Data" : "Visibility"}</button>)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><strong style={{ textTransform: "capitalize", flex: 1 }}>{selected.type === "kpi" ? "KPI card" : selected.type}</strong><button type="button" className="ap-icon-btn" aria-label="Delete component" onClick={() => remove(selected.id)}><Trash2 size={15} /></button></div>
            <ComponentInspector comp={selected} page={page} config={config} meta={meta} onChange={updateComp} tab={right} />
          </> : page ? <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><Settings size={15} /><strong>Page settings</strong></div>
            <PageInspector page={page} config={config} meta={meta} onChange={(p) => updatePage(() => p)} onDelete={async () => { if (!(await confirmDialog(`Delete page “${page.title}”?`, { danger: true, confirmLabel: "Delete" }))) return; setConfig((c) => ({ ...c, pages: c.pages.filter((x) => x.id !== page.id), homePageId: c.homePageId === page.id ? undefined : c.homePageId })); setPageId(config.pages.find((x) => x.id !== page.id)?.id); }} />
          </> : null}
        </aside>
      </div>
      {dialog === "publish" && <PublishDialog appId={app.id} onClose={() => setDialog(null)} onDone={(v) => { setDialog(null); notify(`Published v${v}. App mode now shows this version.`); }} />}
      {dialog === "versions" && <VersionsDialog appId={app.id} onClose={() => setDialog(null)} />}
      {toast && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "var(--color-text-primary)", color: "var(--color-background-surface)", padding: "10px 16px", borderRadius: 8, zIndex: 100, fontSize: 13 }}>{toast}</div>}
    </div>
  );
}

function AppSettings({ app, config, meta, setConfig, notify }: { app: AppInfo; config: AppConfig; meta: Meta; setConfig: React.Dispatch<React.SetStateAction<AppConfig>>; notify: (m: string) => void }) {
  const [name, setName] = useState(app.name);
  return (
    <div>
      <div className="bd-field"><label htmlFor="app-name">App name</label><input id="app-name" className="bd-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={async () => { if (name.trim() && name !== app.name) { const r = await updateAppMetaAction(app.id, { name }); notify(r.ok ? "Renamed" : r.error); } }} /></div>
      <div className="bd-field"><label htmlFor="app-home">Home page</label><select id="app-home" className="bd-input" value={config.homePageId ?? ""} onChange={(e) => setConfig((c) => ({ ...c, homePageId: e.target.value || undefined }))}><option value="">First page</option>{config.pages.filter((p) => p.kind !== "detail").map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
      <div className="bd-field"><label>Audience</label><span style={{ fontSize: 13 }}>{app.audience === "portal" ? "Client portal — visitors with the Portal role only see records linked to their email." : "Workspace members (by their base role)."}</span></div>
      {app.audience === "portal" && <>
        <div className="bd-field"><label htmlFor="pt-t">Portal client table</label><select id="pt-t" className="bd-input" value={config.portal?.tableId ?? ""} onChange={(e) => setConfig((c) => ({ ...c, portal: { tableId: e.target.value, emailFieldId: "" } }))}>{meta.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div className="bd-field"><label htmlFor="pt-e">Match visitors by email field</label><select id="pt-e" className="bd-input" value={config.portal?.emailFieldId ?? ""} onChange={(e) => setConfig((c) => ({ ...c, portal: { tableId: c.portal!.tableId, emailFieldId: e.target.value } }))}><option value="">Choose…</option>{meta.fields.filter((f) => f.tableId === config.portal?.tableId && f.type === "email").map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
      </>}
      <p className="ap-muted" style={{ fontSize: 12 }}>App URL: <code>/a/{app.slug}</code></p>
    </div>
  );
}

function PublishDialog({ appId, onClose, onDone }: { appId: string; onClose: () => void; onDone: (v: number) => void }) {
  const [note, setNote] = useState(""); const [err, setErr] = useState("");
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={460} padding={6} purpose="form">
      <div style={{ display: "block", flex: "none" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Publish this version</h2>
        <p className="ap-muted" style={{ margin: "6px 0 12px" }}>Creates an immutable version. Everyone using the app sees it immediately; you can roll back at any time.</p>
        <label className="bd-field"><span style={{ fontSize: 12, fontWeight: 600 }}>What changed? (optional)</span><input className="bd-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {err && <p role="alert" className="ap-error">{err}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}><Button label="Cancel" onClick={onClose} /><Button label="Publish" variant="primary" clickAction={async () => { const r = await publishAppAction(appId, note); if (!r.ok) setErr(r.error); else onDone(r.data.version); }} /></div>
      </div>
    </Dialog>
  );
}

function VersionsDialog({ appId, onClose }: { appId: string; onClose: () => void }) {
  const [rows, setRows] = useState<{ id: string; version: number; note: string | null; publishedAt: string }[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { listVersionsAction(appId).then((r) => (r.ok ? setRows(r.data) : setErr(r.error))); }, [appId]);
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={560} padding={6} purpose="info">
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Published versions</h2>
      {err && <p role="alert" className="ap-error">{err}</p>}
      {!rows ? <p className="ap-muted">Loading…</p> : !rows.length ? <p className="ap-muted">Not published yet.</p> : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((v, i) => (
            <li key={v.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--color-border)" }}>
              <strong>v{v.version}</strong>{i === 0 && <span className="ap-badge">Live</span>}
              <span style={{ flex: 1, fontSize: 13 }}>{v.note ?? ""} <span className="ap-muted">{new Date(v.publishedAt).toLocaleString("en-GB")}</span></span>
              {i > 0 && <Button label="Roll back" size="sm" clickAction={async () => { if (!(await confirmDialog(`Republish v${v.version} as the live version? The draft is reset to it too.`))) return; const r = await rollbackAppAction(appId, v.id); if (!r.ok) setErr(r.error); else window.location.reload(); }} />}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
