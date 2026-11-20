"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Dialog } from "@/components/ui/modal";
import { Button } from "@astryxdesign/core/Button";
import { ChevronDown, Plus, Search, User, Users, Table2, Lock } from "lucide-react";
import type { ViewConfig } from "@/db/schema";
import { isComputed } from "@/lib/platform/fields";
import {
  aiFillFieldAction, archiveFieldAction, clickButtonAction, archiveTableAction, archiveViewAction, createFieldAction, createRecordsAction, createTableAction, reorderTablesAction, createViewAction,
  deleteRecordsAction, loadViewAction, setRowColorAction, updateBaseAction, updateCellsAction, updateTableAction, updateViewAction, updateViewConfigAction,
} from "@/app/platform-actions";
import { VIEW_ICONS, VIEW_LABELS } from "./icons";
import { BaseHeader, HEAD_BG } from "./base-header";
import { Grid, type CellEdit } from "./grid";
import { Toolbar } from "./toolbar";
import { FieldDialog } from "./field-dialog";
import { RecordDialog } from "./record-dialog";
import { ImportDialog } from "./import-dialog";
import { AddTableMenu, FieldTypePicker, TableSwitcher } from "./table-tools";
import { AiBuilderDialog } from "./ai-builder";
import type { FieldOptions, FieldType } from "@/lib/platform/fields";
import { CalendarView, FormView, GalleryView, KanbanView, ListView, TimelineView } from "./views";
import { toServerValue } from "./cells";
import type { BaseData, ClientField, ClientRow } from "./types";
import { promptDialog } from "@/components/ui/dialogs";


export function BaseApp({ data }: { data: BaseData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [rows, setRows] = useState<ClientRow[]>(data.rows);
  const [counts, setCounts] = useState(data.commentCounts);
  const [config, setConfig] = useState<ViewConfig>(data.view.config);
  const [search, setSearch] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const [fieldDlg, setFieldDlg] = useState<{ field: ClientField | null; after?: string; type?: FieldType; linkTableId?: string; preset?: FieldOptions } | null>(null);
  const [picker, setPicker] = useState<{ anchor: DOMRect; after?: string } | null>(null);
  const [tablesPop, setTablesPop] = useState<DOMRect | null>(null);
  const [addTablePop, setAddTablePop] = useState<DOMRect | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  // Tables hidden from the tab bar: a per-person, per-browser preference (the table itself is unaffected).
  const hiddenKey = `bangon:hiddenTables:${data.base.id}`;
  const [hiddenTables, setHiddenTables] = useState<Set<string>>(new Set());
  useEffect(() => { try { setHiddenTables(new Set(JSON.parse(localStorage.getItem(hiddenKey) ?? "[]"))); } catch { /* storage blocked */ } }, [hiddenKey]);
  const toggleHidden = (id: string) => setHiddenTables((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); try { localStorage.setItem(hiddenKey, JSON.stringify([...n])); } catch { /* ignore */ } return n; });
  const addBlankTable = async () => { const r = await createTableAction(data.base.id, `Table ${data.tables.length + 1}`); if (!r.ok) notify(r.error); else { go(r.data.id); router.refresh(); } };
  const [recordId, setRecordId] = useState<string | null>(params.get("record"));
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => Promise<void> } | null>(null);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const [viewQ, setViewQ] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const view = { ...data.view, config };

  useEffect(() => { setRows(data.rows); setCounts(data.commentCounts); setConfig(data.view.config); }, [data]);
  useEffect(() => { if (window.innerWidth < 800) setSidebar(false); }, []);
  const notify = useCallback((msg: string, undo?: () => void) => {
    clearTimeout(toastTimer.current); setToast({ msg, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 8000 : 3500);
  }, []);

  const [limit, setLimit] = useState(1000);
  const [matched, setMatched] = useState(data.matched);
  useEffect(() => setMatched(data.matched), [data.matched]);
  const reload = useCallback(async (q = search, lim = limit) => {
    const r = await loadViewAction(data.view.id, q, lim);
    if (r.ok) { setRows(r.data.rows); setCounts(r.data.commentCounts); setMatched(r.data.matched); } else notify(r.error);
  }, [data.view.id, search, limit, notify]);
  useEffect(() => { const t = setTimeout(() => { if (search !== "") reload(search); }, 200); return () => clearTimeout(t); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fields in view order, minus hidden; primary always first.
  const fields = useMemo(() => {
    const order = config.order?.length ? config.order : data.allFields.map((f) => f.id);
    const pos = (id: string) => { const i = order.indexOf(id); return i < 0 ? 1e6 + data.allFields.findIndex((f) => f.id === id) : i; };
    const hidden = new Set(config.hidden ?? []);
    return [...data.allFields].filter((f) => f.isPrimary || !hidden.has(f.id)).sort((a, b) => (a.isPrimary ? -1 : b.isPrimary ? 1 : pos(a.id) - pos(b.id)));
  }, [data.allFields, config.order, config.hidden]);

  const onConfig = async (patch: ViewConfig) => {
    setConfig((c) => ({ ...c, ...patch }));
    if (!data.view.canEdit) { notify(data.view.isLocked ? "This view is locked" : "Create a personal view to customise"); return; }
    const r = await updateViewConfigAction(data.view.id, patch);
    if (!r.ok) { notify(r.error); setConfig(data.view.config); return; }
    if (patch.filters || patch.sorts || patch.groups || patch.color) reload();
  };

  const onEdit = async (cells: CellEdit[]) => {
    const byField = new Map(data.allFields.map((f) => [f.id, f]));
    setRows((rs) => rs.map((r) => { const mine = cells.filter((c) => c.recordId === r.id); if (!mine.length) return r; const v = { ...r.values }; for (const c of mine) v[c.fieldId] = c.value; return { ...r, values: v }; }));
    const r = await updateCellsAction(cells.map((c) => ({ recordId: c.recordId, fieldId: c.fieldId, value: toServerValue(byField.get(c.fieldId)!, c.value), ...("before" in c ? { expected: toServerValue(byField.get(c.fieldId)!, c.before ?? null) } : {}) })));
    if (!r.ok) { notify(r.error); reload(); return false; }
    reload(); return true;
  };

  const create = async (values: Record<string, unknown> = {}, afterId?: string, open = false) => {
    const r = await createRecordsAction(data.table.id, [values], afterId);
    if (!r.ok) { notify(r.error); return; }
    await reload();
    if (open) setRecordId((r.data as string[])[0]);
  };

  const deleteRows = async (ids: string[]) => {
    const r = await deleteRecordsAction(ids);
    if (!r.ok) { notify(r.error); return; }
    setRows((rs) => rs.filter((x) => !ids.includes(x.id)));
    notify(`Deleted ${ids.length} record${ids.length > 1 ? "s" : ""}`, async () => { await deleteRecordsAction(ids, true); reload(); notify("Restored"); });
  };

  const duplicate = async (id: string) => {
    const src = rows.find((r) => r.id === id); if (!src) return;
    const vals: Record<string, unknown> = {};
    for (const f of data.allFields) if (!isComputed(f.type) && f.editable && src.values[f.id] !== undefined && f.type !== "attachment") vals[f.id] = toServerValue(f, src.values[f.id]);
    create(vals, id);
  };

  const pressButton = async (f: ClientField, recordId: string) => {
    const r = await clickButtonAction(f.id, recordId);
    if (!r.ok) { notify(r.error); return; }
    if (r.data.url) window.open(r.data.url, "_blank", "noopener,noreferrer");
    else { notify(r.data.kind === "run_automation" ? `${f.options.label || f.name}: automation ${r.data.status}` : `${f.options.label || f.name}: done`); reload(); }
  };
  const aiFill = async (fieldId: string, ids: string[]) => {
    if (!data.aiConfigured) { notify("AI isn't configured — add ANTHROPIC_API_KEY to the deployment."); return; }
    if (!ids.length) { notify("No empty cells to generate"); return; }
    notify(`Generating ${Math.min(ids.length, 25)} cell${ids.length > 1 ? "s" : ""}…`);
    const r = await aiFillFieldAction(fieldId, ids);
    if (!r.ok) { notify(r.error); return; }
    await reload(); notify(`Generated ${r.data} cell${r.data === 1 ? "" : "s"}${ids.length > 25 ? " (25 per run)" : ""}`);
  };

  const fieldAction = async (f: ClientField, action: string) => {
    if (action === "edit") setFieldDlg({ field: f });
    else if (action === "insertRight") { const el = document.querySelector(`[data-field-id="${f.id}"]`); setPicker({ anchor: el?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2 - 200, 120, 0, 0), after: f.id }); }
    else if (action === "primary") { const r = await updateTableAction(data.table.id, { primaryFieldId: f.id }); if (!r.ok) notify(r.error); else router.refresh(); }
    else if (action === "duplicate") { const r = await createFieldAction(data.table.id, { name: `${f.name} copy`, type: f.type, options: f.options, description: f.description, afterFieldId: f.id }); if (!r.ok) notify(r.error); else router.refresh(); }
    else if (action === "filter") onConfig({ filters: { conjunction: config.filters?.conjunction ?? "and", conditions: [...(config.filters?.conditions ?? []), { fieldId: f.id, op: f.type === "checkbox" ? "isChecked" : "isNotEmpty" }] } });
    else if (action === "delete") setConfirm({ title: `Delete “${f.name}”?`, body: "The field is removed from every view. Lookups and rollups that depend on it are removed too. Values remain in record history.", run: async () => { const r = await archiveFieldAction(f.id); if (!r.ok) notify(r.error); else router.refresh(); } });
  };

  const exportView = (fmt: string) => { window.location.href = `/api/platform/export/${data.view.id}?format=${fmt}${search ? `&q=${encodeURIComponent(search)}` : ""}`; };
  const shareForm = async () => {
    const r = await updateViewAction(data.view.id, { share: true });
    if (!r.ok) { notify(r.error); return; }
    const url = `${location.origin}/form/${r.data.shareToken}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    notify(`Public form link copied: ${url}`); router.refresh();
  };

  const go = (tableId: string, viewId?: string) => router.push(`/base/${data.base.id}/${tableId}${viewId ? `/${viewId}` : ""}`);
  const newView = async (type: string, personal: boolean) => {
    const name = `${VIEW_LABELS[type]}${personal ? " (mine)" : ""} ${data.views.filter((v) => v.type === type).length + 1}`;
    const r = await createViewAction(data.table.id, { name, type, personal });
    if (!r.ok) { notify(r.error); return; }
    go(data.table.id, r.data.id); router.refresh();
  };
  const viewMenu = (v: (typeof data.views)[number]) => [
    ...(v.canEdit || (v.personal) ? [{ label: "Rename view", onClick: async () => { const n = (await promptDialog("View name", v.name)); if (n?.trim()) { const r = await updateViewAction(v.id, { name: n.trim() }); if (!r.ok) notify(r.error); else router.refresh(); } } }] : []),
    { label: "Duplicate as personal view", onClick: async () => { const r = await createViewAction(data.table.id, { name: `${v.name} (mine)`, type: v.type, personal: true, copyFromViewId: v.id }); if (!r.ok) notify(r.error); else { go(data.table.id, r.data.id); router.refresh(); } } },
    ...(data.can.collabViews ? [{ label: "Duplicate as collaborative view", onClick: async () => { const r = await createViewAction(data.table.id, { name: `${v.name} copy`, type: v.type, copyFromViewId: v.id }); if (!r.ok) notify(r.error); else { go(data.table.id, r.data.id); router.refresh(); } } }] : []),
    ...((v.personal || data.can.collabViews) && data.views.length > 1 ? [{ type: "divider" as const }, { label: "Delete view", variant: "destructive" as const, onClick: () => setConfirm({ title: `Delete view “${v.name}”?`, body: "Records are not affected — only this view's filters, sorts and layout.", run: async () => { const r = await archiveViewAction(v.id); if (!r.ok) notify(r.error); else { go(data.table.id); router.refresh(); } } }) }] : []),
  ];

  const ids = rows.map((r) => r.id);
  const viewProps = { view, fields, allFields: data.allFields, rows, canCreate: data.can.create, canEdit: data.can.edit, onExpand: setRecordId, onConfig, onEdit, onCreate: (v: Record<string, unknown>) => create(v, undefined, true) };
  const collab = data.views.filter((v) => !v.personal && v.name.toLowerCase().includes(viewQ.toLowerCase()));
  const personal = data.views.filter((v) => v.personal && v.name.toLowerCase().includes(viewQ.toLowerCase()));
  const VI = (t: string) => { const I = VIEW_ICONS[t] ?? Table2; return <I size={15} />; };

  return (
    <div className="p-base">
      <BaseHeader base={data.base} role={data.role} active="data" nameSlot={data.can.schema
        ? <input className="p-name" aria-label="Base name" defaultValue={data.base.name} onBlur={async (e) => { const n = e.target.value.trim(); if (n && n !== data.base.name) { const r = await updateBaseAction(data.base.id, { name: n }); if (!r.ok) notify(r.error); } }} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} style={{ width: `${Math.max(8, data.base.name.length + 2)}ch` }} />
        : undefined} />
      <nav className="p-tables" aria-label="Tables" style={{ background: HEAD_BG[data.base.color] ?? HEAD_BG.blue }}>
        {data.tables.filter((t) => t.id === data.table.id || !hiddenTables.has(t.id)).map((t) => t.id === data.table.id && data.can.schema ? (
          <DropdownMenu key={t.id} menuWidth={200} items={[
            { label: "Rename table", onClick: async () => { const n = (await promptDialog("Table name", t.name)); if (n?.trim()) { const r = await updateTableAction(t.id, { name: n.trim() }); if (!r.ok) notify(r.error); else router.refresh(); } } },
            { label: "Edit table permissions", onClick: () => setConfirm({ title: "Table permissions", body: "perm", run: async () => {} }) },
            ...(data.tables.length > 1 ? [{ type: "divider" as const }, { label: "Delete table", variant: "destructive" as const, onClick: () => setConfirm({ title: `Delete table “${t.name}”?`, body: "All its records, views and fields are archived, and link fields pointing to it from other tables are removed.", run: async () => { const r = await archiveTableAction(t.id); if (!r.ok) notify(r.error); else { router.push(`/base/${data.base.id}`); router.refresh(); } } }) }] : []),
          ]} renderTrigger={(tp) => <button type="button" {...tp} aria-current="page" className="p-tabletab">{t.name}<ChevronDown size={13} /></button>} />
        ) : (
          <button key={t.id} type="button" aria-current={t.id === data.table.id ? "page" : undefined} className="p-tabletab" onClick={() => go(t.id)}>{t.name}</button>
        ))}
        <span className="p-tables-more">
          <button type="button" className="p-tabletab" aria-label="All tables" title="All tables" aria-haspopup="dialog" onClick={(e) => setTablesPop(e.currentTarget.getBoundingClientRect())}><ChevronDown size={15} />{hiddenTables.size > 0 && <span style={{ fontSize: 11, opacity: .85 }}>{hiddenTables.size} hidden</span>}</button>
          {data.can.schema && <button type="button" className="p-tabletab" aria-label="Add or import a table" title="Add or import a table" aria-haspopup="dialog" onClick={(e) => setAddTablePop(e.currentTarget.getBoundingClientRect())}><Plus size={15} /></button>}
        </span>
      </nav>

      <div className="p-body">
        <aside className={`p-views ${sidebar ? "" : "collapsed"}`} aria-label="Views">
          <div style={{ padding: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 8px", height: 30, borderRadius: 6, background: "var(--color-background-muted)" }}><Search size={14} /><input aria-label="Find a view" placeholder="Find a view" value={viewQ} onChange={(e) => setViewQ(e.target.value)} style={{ border: 0, background: "transparent", outline: 0, flex: 1, font: "inherit", fontSize: 13, color: "inherit" }} /></label>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "0 8px" }}>
            <div className="p-sect"><Users size={11} /> Collaborative</div>
            {collab.map((v) => <ViewItem key={v.id} v={v} current={v.id === data.view.id} href={`/base/${data.base.id}/${data.table.id}/${v.id}`} icon={VI(v.type)} menu={viewMenu(v)} />)}
            <div className="p-sect"><User size={11} /> My personal views</div>
            {personal.map((v) => <ViewItem key={v.id} v={v} current={v.id === data.view.id} href={`/base/${data.base.id}/${data.table.id}/${v.id}`} icon={VI(v.type)} menu={viewMenu(v)} />)}
            {!personal.length && <p style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "2px 10px" }}>Only you can see your personal views.</p>}
          </div>
          {data.can.comment && (
            <div style={{ borderTop: "1px solid var(--color-border)", padding: 8 }}>
              <div className="p-sect" style={{ padding: "4px 2px" }}>Create</div>
              {Object.keys(VIEW_LABELS).map((t) => (
                <div key={t} style={{ display: "flex", alignItems: "center" }}>
                  <button type="button" className="p-viewitem" onClick={() => newView(t, !data.can.collabViews)}>{VI(t)}{VIEW_LABELS[t]}</button>
                  {data.can.collabViews && <button type="button" className="p-tbtn" title="Create as a personal view" aria-label={`Create personal ${VIEW_LABELS[t]} view`} onClick={() => newView(t, true)}><User size={13} /></button>}
                </div>
              ))}
            </div>
          )}
        </aside>

        <main className="p-main">
          <Toolbar view={view} fields={fields} allFields={data.allFields} search={search} aiConfigured={data.aiConfigured}
            onSearch={(s) => { setSearch(s); if (!s) reload(""); }} onConfig={onConfig} onToggleSidebar={() => setSidebar((s) => !s)}
            onExport={exportView} onShare={shareForm} canLock={data.can.collabViews && !data.view.personal}
            onLock={async () => { const r = await updateViewAction(data.view.id, { isLocked: !data.view.isLocked }); if (!r.ok) notify(r.error); else router.refresh(); }} notify={notify} />
          {rows.length < matched && <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 12px", fontSize: 13, borderBottom: "1px solid var(--color-border)", background: "var(--color-background-muted)" }}>Showing {rows.length.toLocaleString("en-GB")} of {matched.toLocaleString("en-GB")} records. <button type="button" className="p-tbtn on-blue" onClick={() => { const l = limit + 5000; setLimit(l); reload(search, l); }}>Load {Math.min(5000, matched - rows.length).toLocaleString("en-GB")} more</button></div>}
          {view.type === "grid" && <Grid fields={fields} allFields={data.allFields} rows={rows} config={config} commentCounts={counts} collaborators={data.collaborators}
            can={{ create: data.can.create, edit: data.can.edit, delete: data.can.delete, schema: data.can.schema, viewEdit: data.view.canEdit }}
            onEdit={onEdit} onAddRow={(after, v) => create(v ?? {}, after)} onExpand={setRecordId} onDeleteRows={deleteRows} onDuplicate={duplicate}
            onSetColor={async (ids2, c) => { setRows((rs) => rs.map((r) => (ids2.includes(r.id) ? { ...r, color: c } : r))); const r = await setRowColorAction(ids2, c); if (!r.ok) notify(r.error); else if (config.color?.mode && config.color.mode !== "none") notify("Row colours from this view's colour rules take priority"); }}
            onFieldAction={fieldAction} onAddField={(anchor) => setPicker({ anchor: anchor ?? new DOMRect(window.innerWidth - 420, 120, 0, 0) })} onConfig={onConfig} onAiFill={aiFill} notify={notify} onReload={() => reload()} onButton={pressButton} />}
          {view.type === "kanban" && <KanbanView {...viewProps} />}
          {view.type === "calendar" && <CalendarView {...viewProps} />}
          {view.type === "gallery" && <GalleryView {...viewProps} />}
          {view.type === "timeline" && <TimelineView {...viewProps} />}
          {view.type === "list" && <ListView {...viewProps} />}
          {view.type === "form" && <FormView {...viewProps} color={data.base.color} onSubmit={async (vals) => { const r = await createRecordsAction(data.table.id, [vals]); if (!r.ok) return r.error; reload(); return null; }} />}
        </main>
      </div>

      {fieldDlg && <FieldDialog data={data} field={fieldDlg.field} afterFieldId={fieldDlg.after} initialType={fieldDlg.type} initialLinkTableId={fieldDlg.linkTableId} initialOptions={fieldDlg.preset} onClose={() => setFieldDlg(null)} onSaved={() => { setFieldDlg(null); router.refresh(); }} />}
      {recordId && <RecordDialog data={data} recordId={recordId} ids={ids} onNavigate={setRecordId} onClose={() => { setRecordId(null); reload(); }}
        onEdit={(rid, fid, v, before) => onEdit([{ recordId: rid, fieldId: fid, value: v, before }])} onDelete={(id) => deleteRows([id])} onAiFill={aiFill} />}
      <ImportDialog isOpen={importOpen} onClose={() => setImportOpen(false)} baseId={data.base.id} />
      {picker && <FieldTypePicker anchor={picker.anchor} onClose={() => setPicker(null)} tables={data.tables} aiConfigured={data.aiConfigured} onPick={(type, linkTableId, preset) => { setFieldDlg({ field: null, after: picker.after, type, linkTableId, preset }); setPicker(null); }} />}
      {tablesPop && <TableSwitcher anchor={tablesPop} tables={data.tables} currentId={data.table.id} hidden={hiddenTables} onToggleHidden={toggleHidden} onPick={(id) => { setTablesPop(null); if (id !== data.table.id) go(id); }} onAdd={data.can.schema ? (r) => { setTablesPop(null); setAddTablePop(r); } : undefined} onClose={() => { setTablesPop(null); router.refresh(); }} onReorder={data.can.schema ? async (ids) => { const r = await reorderTablesAction(data.base.id, ids); if (!r.ok) notify(r.error); } : undefined} />}
      {addTablePop && <AddTableMenu anchor={addTablePop} onClose={() => setAddTablePop(null)} aiConfigured={data.aiConfigured} onBlank={addBlankTable} onImport={() => setImportOpen(true)} onSync={() => router.push(`/base/${data.base.id}/sync`)} onAi={() => setAiOpen(true)} />}
      <AiBuilderDialog isOpen={aiOpen} onClose={() => setAiOpen(false)} />
      {confirm && confirm.body === "perm" ? <TablePermsDialog data={data} onClose={() => setConfirm(null)} onSaved={() => { setConfirm(null); router.refresh(); notify("Table permissions saved"); }} /> : confirm && (
        <Dialog isOpen onOpenChange={(o) => !o && setConfirm(null)} width={440} padding={6} purpose="form">
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{confirm.title}</h2>
          <p style={{ color: "var(--color-text-secondary)" }}>{confirm.body}</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
            <Button label="Cancel" onClick={() => setConfirm(null)} />
            <Button label="Delete" variant="destructive" clickAction={async () => { await confirm.run(); setConfirm(null); }} />
          </div>
        </Dialog>
      )}
      {toast && (
        <div role="status" aria-live="polite" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "var(--color-text-primary)", color: "var(--color-background-surface)", padding: "10px 16px", borderRadius: 8, display: "flex", gap: 12, alignItems: "center", zIndex: 100, boxShadow: "0 8px 28px rgba(0,0,0,.25)", maxWidth: "calc(100vw - 32px)", fontSize: 13 }}>
          <span style={{ overflowWrap: "anywhere" }}>{toast.msg}</span>
          {toast.undo && <button type="button" onClick={() => { toast.undo!(); setToast(null); }} style={{ border: 0, background: "transparent", color: "inherit", fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}>Undo</button>}
        </div>
      )}
    </div>
  );
}

function ViewItem({ v, current, href, icon, menu }: { v: BaseData["view"]; current: boolean; href: string; icon: React.ReactNode; menu: React.ComponentProps<typeof DropdownMenu>["items"] }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }} className="p-vrow">
      <Link href={href} className="p-viewitem" aria-current={current ? "page" : undefined}>{icon}<span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>{v.isLocked && <Lock size={11} />}</Link>
      {menu && menu.length > 0 && <DropdownMenu menuWidth={240} items={menu} renderTrigger={(t) => <button type="button" {...t} className="g-hmenu p-vmenu" aria-label={`${v.name} view menu`}><ChevronDown size={13} /></button>} />}
    </div>
  );
}

function TablePermsDialog({ data, onClose, onSaved }: { data: BaseData; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState({ create: data.table.permissions.create ?? "editor", edit: data.table.permissions.edit ?? "editor", delete: data.table.permissions.delete ?? "editor" });
  const [err, setErr] = useState("");
  const roles = [["editor", "Editors and up"], ["creator", "Creators and up"], ["owner", "Owners only"]];
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={460} padding={6} purpose="form">
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Permissions for “{data.table.name}”</h2>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13, marginBottom: 12 }}>Enforced on the server for the app, forms, imports and the API. Commenters and readers (free seats) can never edit records.</p>
      {(["create", "edit", "delete"] as const).map((k) => (
        <label key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, fontSize: 14 }}>
          Who can {k} records
          <select value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} style={{ height: 32, borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", color: "inherit", font: "inherit" }}>{roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
      ))}
      {err && <p style={{ color: "var(--color-text-error)" }}>{err}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button label="Cancel" onClick={onClose} />
        <Button label="Save" variant="primary" clickAction={async () => { const r = await updateTableAction(data.table.id, { permissions: p }); if (!r.ok) setErr(r.error); else onSaved(); }} />
      </div>
    </Dialog>
  );
}
