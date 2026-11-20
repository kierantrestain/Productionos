"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { BarChart3, CalendarDays, ClipboardList, Columns3, ExternalLink, FileInput, LayoutDashboard, LayoutGrid, Pencil, Plus, Square, Table2 } from "lucide-react";
import { Dialog } from "@/components/ui/modal";
import { createInterfaceAppAction } from "@/app/apps-actions";
import { saveInterfaceAction } from "@/app/platform-actions";
import type { BaseMeta } from "@/app/(base)/base/[baseId]/load";
import { BaseHeader } from "./base-header";

export type IfaceApp = { id: string; name: string; slug: string; published: boolean; pages: number; description: string | null; updatedAt: string };
type Dash = { id: string; name: string };

const LAYOUTS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, desc: "KPIs, goal progress, charts by status and over time, recent records and a detail page." },
  { key: "records", label: "Record review", icon: Table2, desc: "Searchable, sortable list with an add form; click a row for its full record." },
  { key: "board", label: "Board", icon: Columns3, desc: "Kanban columns from a status field; drag cards to update them." },
  { key: "calendar", label: "Calendar", icon: CalendarDays, desc: "Month calendar from a date field, each entry opens its record." },
  { key: "gallery", label: "Gallery", icon: LayoutGrid, desc: "Visual cards with cover images from an attachment field." },
  { key: "form", label: "Form", icon: FileInput, desc: "A clean data-entry form that creates records." },
  { key: "blank", label: "Blank", icon: Square, desc: "Start from an empty page and drag in components." },
  { key: "quick", label: "Quick dashboard", icon: BarChart3, desc: "A single page of numbers and charts, edited right here." },
] as const;

export function InterfacesSidebar({ meta, apps, dashboards, activeId, onNew }: { meta: BaseMeta; apps: IfaceApp[]; dashboards: Dash[]; activeId?: string; onNew?: () => void }) {
  const base = `/base/${meta.base.id}/interfaces`;
  return (
    <aside className="p-views" aria-label="Interfaces">
      <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
        <Link href={base} className="p-viewitem" aria-current={!activeId ? "page" : undefined}><LayoutGrid size={15} />All interfaces</Link>
        <div className="p-sect">Apps</div>
        {apps.map((a) => <Link key={a.id} href={meta.canEdit ? `/builder/${a.id}` : `/a/${a.slug}`} className="p-viewitem"><LayoutDashboard size={15} /><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>{!a.published && <span className="if-draft">Draft</span>}</Link>)}
        {!apps.length && <p className="if-hint">Multi-page interfaces built with the page builder.</p>}
        <div className="p-sect">Quick dashboards</div>
        {dashboards.map((d) => <Link key={d.id} href={`${base}?i=${d.id}`} className="p-viewitem" aria-current={d.id === activeId ? "page" : undefined}><BarChart3 size={15} />{d.name}</Link>)}
        {!dashboards.length && <p className="if-hint">Single-page charts, edited in place.</p>}
      </div>
      {meta.canEdit && <div style={{ borderTop: "1px solid var(--color-border)", padding: 8 }}>{onNew ? <button type="button" className="p-viewitem" onClick={onNew}><Plus size={15} />New interface</button> : <Link href={`${base}?new=1`} className="p-viewitem"><Plus size={15} />New interface</Link>}</div>}
    </aside>
  );
}

export function InterfacesHome({ meta, apps, dashboards, startNew }: { meta: BaseMeta; apps: IfaceApp[]; dashboards: Dash[]; startNew?: boolean }) {
  const [open, setOpen] = useState(!!startNew && meta.canEdit);
  return (
    <div className="p-base">
      <BaseHeader base={meta.base} role={meta.role} active="interfaces" />
      <div className="p-body">
        <InterfacesSidebar meta={meta} apps={apps} dashboards={dashboards} onNew={() => setOpen(true)} />
        <main className="p-main" style={{ overflow: "auto" }}>
          <div className="if-home">
            <div className="if-home-head">
              <div><h1>Interfaces</h1><p>Turn the tables in {meta.base.name} into apps your team and clients use: dashboards, boards, calendars, galleries and forms. Every interface respects each person&apos;s access.</p></div>
              {meta.canEdit && <Button label="New interface" variant="primary" icon={<Plus size={16} />} onClick={() => setOpen(true)} />}
            </div>
            {apps.length + dashboards.length > 0 ? (
              <div className="if-cards">
                {apps.map((a) => (
                  <article key={a.id} className="if-app">
                    <div className="if-app-top"><span className="if-app-ic" aria-hidden><LayoutDashboard size={18} /></span><div style={{ minWidth: 0, flex: 1 }}><h2>{a.name}</h2><p>{a.pages} page{a.pages === 1 ? "" : "s"} · {a.published ? "Published" : "Draft — not yet published"}</p></div></div>
                    {a.description && <p className="if-app-desc">{a.description}</p>}
                    <div className="if-app-actions">
                      {a.published && <Link href={`/a/${a.slug}`} className="p-tbtn"><ExternalLink size={14} />Open</Link>}
                      {meta.canEdit && <Link href={`/builder/${a.id}`} className="p-tbtn on-blue"><Pencil size={14} />Edit in builder</Link>}
                    </div>
                  </article>
                ))}
                {dashboards.map((d) => (
                  <article key={d.id} className="if-app">
                    <div className="if-app-top"><span className="if-app-ic" aria-hidden><BarChart3 size={18} /></span><div style={{ minWidth: 0, flex: 1 }}><h2>{d.name}</h2><p>Quick dashboard</p></div></div>
                    <div className="if-app-actions"><Link href={`/base/${meta.base.id}/interfaces?i=${d.id}`} className="p-tbtn"><ExternalLink size={14} />Open</Link></div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="if-empty"><ClipboardList size={28} aria-hidden /><h2>No interfaces yet</h2><p>{meta.canEdit ? "Pick a layout and Bang On OS builds a working first version from your fields. Then change anything in the builder." : "Ask a creator of this base to build one."}</p></div>
            )}
            {meta.canEdit && <><h2 className="if-sub">Start from a layout</h2><LayoutGrid_ meta={meta} /></>}
          </div>
        </main>
      </div>
      {open && <NewInterfaceDialog meta={meta} onClose={() => setOpen(false)} />}
    </div>
  );
}

function LayoutGrid_({ meta }: { meta: BaseMeta }) {
  const [pick, setPick] = useState<string | null>(null);
  return <>
    <div className="if-layouts">{LAYOUTS.map((l) => <button key={l.key} type="button" className="if-layout" onClick={() => setPick(l.key)}><l.icon size={20} /><strong>{l.label}</strong><span>{l.desc}</span></button>)}</div>
    {pick && <NewInterfaceDialog meta={meta} initialLayout={pick} onClose={() => setPick(null)} />}
  </>;
}

function NewInterfaceDialog({ meta, onClose, initialLayout = "dashboard" }: { meta: BaseMeta; onClose: () => void; initialLayout?: string }) {
  const router = useRouter();
  const [layout, setLayout] = useState(initialLayout);
  const [tableId, setTableId] = useState(meta.tables[0]?.id ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const table = meta.tables.find((t) => t.id === tableId);
  const fields = meta.fields.filter((f) => f.tableId === tableId);
  const need = layout === "board" && !fields.some((f) => f.type === "singleSelect") ? "This table has no single-select field yet, so the board starts with one column. You can add a Status field later."
    : layout === "calendar" && !fields.some((f) => ["date", "dateTime"].includes(f.type)) ? "This table has no date field yet. Add one, then pick it in the calendar's Data tab."
    : layout === "gallery" && !fields.some((f) => f.type === "attachment") ? "No attachment field: cards show without cover images." : "";
  const create = async () => {
    setBusy(true); setErr("");
    const n = name.trim() || (layout === "blank" ? "New interface" : `${table?.name ?? "Records"} ${LAYOUTS.find((l) => l.key === layout)?.label.toLowerCase()}`);
    if (layout === "quick") {
      const r = await saveInterfaceAction(meta.base.id, { name: n, widgets: [] });
      if (!r.ok) { setErr(r.error); setBusy(false); return; }
      router.push(`/base/${meta.base.id}/interfaces?i=${r.data.id}&edit=1`); return;
    }
    const r = await createInterfaceAppAction({ baseId: meta.base.id, name: n, layout: layout as "dashboard", tableId: tableId || undefined });
    if (!r.ok) { setErr(r.error); setBusy(false); return; }
    router.push(`/builder/${r.data.id}`);
  };
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={640} padding={6} purpose="form">
      <form onSubmit={(e) => { e.preventDefault(); create(); }} style={{ display: "grid", gap: 14 }}>
        <div><h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>New interface</h2><p style={{ margin: "4px 0 0", color: "var(--color-text-secondary)", fontSize: 13 }}>Choose a layout and a table. A working first version is built from your fields; then edit anything in the builder.</p></div>
        <div className="if-layouts compact" role="radiogroup" aria-label="Layout">
          {LAYOUTS.map((l) => <button key={l.key} type="button" role="radio" aria-checked={layout === l.key} className={`if-layout ${layout === l.key ? "on" : ""}`} onClick={() => setLayout(l.key)}><l.icon size={18} /><strong>{l.label}</strong></button>)}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>{LAYOUTS.find((l) => l.key === layout)?.desc}</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label className="if-lbl">Name<input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={layout === "blank" ? "New interface" : `${table?.name ?? "Records"} ${LAYOUTS.find((l) => l.key === layout)?.label.toLowerCase()}`} /></label>
          {layout !== "blank" && layout !== "quick" && <label className="if-lbl">Table<select className="ui-input" value={tableId} onChange={(e) => setTableId(e.target.value)}>{meta.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        </div>
        {need && <p className="if-note">{need}</p>}
        {err && <p role="alert" style={{ color: "var(--color-text-error)", margin: 0, fontSize: 13 }}>{err}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button label="Cancel" onClick={onClose} />
          <Button type="submit" variant="primary" label={busy ? "Building…" : layout === "quick" ? "Create dashboard" : "Create and open builder"} isDisabled={busy || (!meta.tables.length && layout !== "blank" && layout !== "quick")} />
        </div>
      </form>
    </Dialog>
  );
}
