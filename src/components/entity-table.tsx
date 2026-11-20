"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getEntity, type FieldDef } from "@/lib/entities";
import { date, dateTime, humanize, money, pct, time, tone } from "@/lib/format";
import { archiveRecords, batchUpdateRecords, deleteViewAction, saveViewAction, setCustomValueAction, updateRecord } from "@/app/actions";
import { customAsField, useEntityConfig } from "./org-config";
import type { CustomFieldDefShape } from "@/lib/customise";
import { Drawer, FieldInput, finalise, useRun, useToast } from "./client";
import { RecordForm } from "./record-form";
import { Icon } from "./icons";
import { confirmDialog, promptDialog } from "@/components/ui/dialogs";

export type TableRow = Record<string, unknown> & { id: string; version: number };
export interface TableState { q?: string; sort?: string; dir?: "asc" | "desc"; filters: Record<string, string>; archived?: boolean; page: number; pageSize: number }

function display(f: FieldDef, v: unknown, refs: Record<string, Record<string, string>>): React.ReactNode {
  if (v === null || v === undefined || v === "") return <span className="subtle">—</span>;
  switch (f.type) {
    case "money": return money(Number(v));
    case "bp": return pct(Number(v));
    case "date": return date(String(v));
    case "datetime": return dateTime(String(v));
    case "time": return <span className="mono">{time(String(v))}</span>;
    case "bool": return v ? "Yes" : "No";
    case "select": return /status|stage|priority|clearance/i.test(f.key + f.label) ? <span className={`badge ${tone(String(v))}`}>{humanize(String(v))}</span> : humanize(String(v));
    case "ref": return refs[f.ref!]?.[String(v)] ?? <span className="subtle">(restricted)</span>;
    case "url": return <a href={String(v)} target="_blank" rel="noreferrer noopener">{String(v).replace(/^https?:\/\//, "").slice(0, 40)}</a>;
    default: return String(v);
  }
}

export function EntityTable({ entity, rows, refs, total, state, canWrite, fixed = {}, columns, savedViews = [], redacted = [], title, hideCreate, emptyHint, recordBase, customValues = {} }: {
  entity: string; rows: TableRow[]; refs: Record<string, Record<string, string>>; total: number; state: TableState; canWrite: boolean;
  fixed?: Record<string, string>; columns?: string[]; savedViews?: { id: string; name: string; config: Record<string, unknown>; mine: boolean }[];
  redacted?: string[]; title?: string; hideCreate?: boolean; emptyHint?: string; recordBase?: string; customValues?: Record<string, Record<string, unknown>>;
}) {
  const cfg = useEntityConfig(entity);
  const d = useMemo(() => ({ ...getEntity(entity)!, fields: cfg.fields, label: cfg.labels.label, plural: cfg.labels.plural }), [entity, cfg]);
  const customCols = cfg.custom.filter((c) => c.showInList);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const toast = useToast();
  const { run, pending } = useRun();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [q, setQ] = useState(state.q ?? "");

  const cols = useMemo(() => {
    const keys = columns ?? d.fields.filter((f) => f.list).map((f) => f.key);
    return keys.map((k) => d.fields.find((f) => f.key === k)!).filter((f) => f && !(f.key in fixed) && !redacted.includes(f.key));
  }, [columns, d, fixed, redacted]);
  const filterable = d.fields.filter((f) => f.type === "select" && f.list && !(f.key in fixed)).slice(0, 3);
  const statusField = d.fields.find((f) => f.type === "select" && !f.readOnly && /^(status|stage)$/.test(f.key));
  const productionId = fixed.productionId;

  const setParams = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") p.delete(k); else p.set(k, v); }
    if (!("page" in patch)) p.delete("page");
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  useEffect(() => {
    const t = setTimeout(() => { if ((state.q ?? "") !== q) setParams({ q }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function commit(row: TableRow, f: FieldDef, value: unknown) {
    setEditing(null);
    const v = finalise(f, value);
    if (JSON.stringify(v ?? null) === JSON.stringify(row[f.key] ?? null)) return;
    const r = await run(updateRecord(entity, row.id, { [f.key]: v }, row.version));
    if (r) router.refresh();
  }

  async function batch(kind: "archive" | "restore" | "status", value?: string) {
    const ids = [...selected];
    if (!ids.length) return;
    if (kind === "archive" && !(await confirmDialog(`Archive ${ids.length} record(s)? They can be restored from “Show archived”.`, { danger: true, confirmLabel: "Archive" }))) return;
    const res = kind === "status" ? await run(batchUpdateRecords(entity, ids, { [statusField!.key]: value }), `Updated ${ids.length}`) : await run(archiveRecords(entity, ids, kind === "restore"), kind === "restore" ? "Restored" : "Archived");
    if (res !== undefined) { setSelected(new Set()); router.refresh(); }
  }

  async function saveView() {
    const name = (await promptDialog("Name this view"));
    if (!name) return;
    const config = { q: state.q, filters: state.filters, sort: state.sort, dir: state.dir, productionId };
    const shared = (await confirmDialog("Share this view with your organisation? (Cancel = only you)"));
    if (await run(saveViewAction(entity, name, config, shared), "View saved")) router.refresh();
  }
  const applyView = (cfg: Record<string, unknown>) => {
    const p = new URLSearchParams();
    const tab = sp.get("tab"); if (tab) p.set("tab", tab);
    if (cfg.q) p.set("q", String(cfg.q));
    if (cfg.sort) { p.set("sort", String(cfg.sort)); p.set("dir", String(cfg.dir ?? "asc")); }
    for (const [k, v] of Object.entries((cfg.filters as Record<string, string>) ?? {})) if (v) p.set(`f_${k}`, v);
    router.replace(`${pathname}?${p.toString()}`);
  };
  const exportHref = `/api/export/${entity}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(state.filters).map(([k, v]) => [`f_${k}`, v])), ...Object.fromEntries(Object.entries(fixed).map(([k, v]) => [`f_${k}`, v])), ...(state.q ? { q: state.q } : {}) }).toString()}`;
  const recHref = (id: string) => `${recordBase ?? `/data/${entity}`}/${id}`;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));

  return (
    <div>
      <div className="toolbar" role="toolbar" aria-label={`${d.plural} tools`}>
        {title && <h2 style={{ marginRight: 8 }}>{title}</h2>}
        <label className="sr-only" htmlFor={`q-${entity}`}>Search {d.plural}</label>
        <input id={`q-${entity}`} className="input search" placeholder={`Search ${d.plural.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        {filterable.map((f) => (
          <select key={f.key} className="select" style={{ width: "auto" }} aria-label={`Filter by ${f.label}`} value={state.filters[f.key] ?? ""} onChange={(e) => setParams({ [`f_${f.key}`]: e.target.value })}>
            <option value="">{f.label}: all</option>
            {f.options!.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}
          </select>
        ))}
        {cfg.custom.filter((c) => c.type === "select" || c.type === "bool").map((c) => (
          <select key={c.key} className="select" style={{ width: "auto" }} aria-label={`Filter by ${c.label}`} value={state.filters[`cf.${c.key}`] ?? ""} onChange={(e) => setParams({ [`f_cf.${c.key}`]: e.target.value })}>
            <option value="">{c.label}: all</option>
            {(c.type === "bool" ? ["true", "false"] : c.options).map((o) => <option key={o} value={o}>{c.type === "bool" ? (o === "true" ? "Yes" : "No") : o}</option>)}
          </select>
        ))}
        <select className="select" style={{ width: "auto" }} aria-label="Saved views" value="" onChange={(e) => { const v = savedViews.find((x) => x.id === e.target.value); if (v) applyView(v.config); }}>
          <option value="">Views{savedViews.length ? ` (${savedViews.length})` : ""}</option>
          {savedViews.map((v) => <option key={v.id} value={v.id}>{v.name}{v.mine ? "" : " · shared"}</option>)}
        </select>
        <button className="btn btn-quiet btn-sm" onClick={saveView}>Save view</button>
        {savedViews.some((v) => v.mine) && <button className="btn btn-quiet btn-sm" onClick={async () => { const v = savedViews.filter((x) => x.mine); const name = (await promptDialog(`Delete which view? ${v.map((x) => x.name).join(", ")}`)); const m = v.find((x) => x.name === name); if (m && await run(deleteViewAction(m.id), "View deleted")) router.refresh(); }}>Manage</button>}
        <div className="spacer" />
        <label className="check" style={{ fontSize: 12 }}><input type="checkbox" checked={!!state.archived} onChange={(e) => setParams({ archived: e.target.checked ? "1" : null })} /> Show archived</label>
        <a className="btn btn-quiet btn-sm" href={exportHref} download>Export CSV</a>
        {canWrite && !hideCreate && <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> New {d.label.toLowerCase()}</button>}
      </div>

      {rows.length === 0 ? (
        <div className="panel"><div className="empty">
          <h3>{state.q || Object.keys(state.filters).length ? "No matching records" : `No ${d.plural.toLowerCase()} yet`}</h3>
          <p className="muted">{state.q || Object.keys(state.filters).length ? "Try clearing the search or filters." : emptyHint ?? (canWrite ? `Create the first ${d.label.toLowerCase()} to get started.` : "Nothing has been added here yet.")}</p>
          {canWrite && !hideCreate && !state.q && <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setCreating(true)}><Icon name="plus" /> New {d.label.toLowerCase()}</button>}
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="data" aria-label={d.plural} aria-rowcount={total}>
            <thead>
              <tr>
                {canWrite && <th className="sel"><input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} /></th>}
                {cols.map((f) => {
                  const active = (state.sort ?? d.defaultSort.key) === f.key;
                  const dir = active ? (state.sort ? state.dir : d.defaultSort.dir) : undefined;
                  return (
                    <th key={f.key} className={["money", "int", "bp"].includes(f.type) ? "num" : ""} aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : "none"}>
                      <button onClick={() => setParams({ sort: f.key, dir: active && dir === "asc" ? "desc" : "asc" })}>{f.label}{active && <span aria-hidden>{dir === "desc" ? "↓" : "↑"}</span>}</button>
                    </th>
                  );
                })}
                {customCols.map((c) => <th key={`cf-${c.key}`} className={["number", "money"].includes(c.type) ? "num" : ""} title="Custom field">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} aria-selected={selected.has(row.id)}>
                  {canWrite && <td className="sel"><input type="checkbox" aria-label="Select row" checked={selected.has(row.id)} onChange={() => toggle(row.id)} /></td>}
                  {cols.map((f, i) => {
                    const isTitle = f.key === d.titleField || (i === 0 && !cols.some((c) => c.key === d.titleField));
                    const editable = canWrite && !f.readOnly && !f.system && !isTitle;
                    const isEditing = editing?.id === row.id && editing.key === f.key;
                    return (
                      <td key={f.key} className={`${["money", "int", "bp"].includes(f.type) ? "num" : ""} ${isTitle ? "title-cell" : ""}`}>
                        {isTitle ? <Link href={recHref(row.id)}>{display(f, row[f.key], refs) ?? "(untitled)"}</Link>
                          : isEditing ? (
                            <FieldInput f={f} value={draft} compact autoFocus productionId={productionId ?? (row.productionId as string)}
                              onChange={(v) => { setDraft(v); if (f.type === "select" || f.type === "ref" || f.type === "bool" || f.type === "date") commit(row, f, v); }}
                              onBlur={() => commit(row, f, draft)}
                              onKeyDown={(e) => { if (e.key === "Enter" && f.type !== "textarea") commit(row, f, draft); if (e.key === "Escape") setEditing(null); }} />
                          ) : editable ? (
                            <button className="cell-btn" onClick={() => { setEditing({ id: row.id, key: f.key }); setDraft(row[f.key]); }} aria-label={`Edit ${f.label}`}>{display(f, row[f.key], refs)}</button>
                          ) : display(f, row[f.key], refs)}
                      </td>
                    );
                  })}
                  {customCols.map((c) => <CustomCell key={`cf-${c.key}`} c={c} entity={entity} row={row} value={customValues[row.id]?.[c.key]} canWrite={canWrite} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pager">
        <span>{total} {total === 1 ? "record" : "records"}</span>
        {pages > 1 && <>
          <button className="btn btn-sm" disabled={state.page <= 1} onClick={() => setParams({ page: String(state.page - 1) })}>Previous</button>
          <span>Page {state.page} of {pages}</span>
          <button className="btn btn-sm" disabled={state.page >= pages} onClick={() => setParams({ page: String(state.page + 1) })}>Next</button>
        </>}
      </div>

      {selected.size > 0 && canWrite && (
        <div className="batch-bar" role="region" aria-label="Batch actions">
          <strong>{selected.size} selected</strong>
          {statusField && (
            <select className="select" aria-label={`Set ${statusField.label}`} value="" disabled={pending} onChange={(e) => e.target.value && batch("status", e.target.value)}>
              <option value="">Set {statusField.label.toLowerCase()}…</option>
              {statusField.options!.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}
            </select>
          )}
          {state.archived ? <button className="btn btn-sm" onClick={() => batch("restore")}>Restore</button> : <button className="btn btn-sm" onClick={() => batch("archive")}>Archive</button>}
          <button className="btn btn-sm btn-quiet" style={{ color: "inherit" }} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <Drawer open={creating} onClose={() => setCreating(false)} title={`New ${d.label.toLowerCase()}`}>
        {creating && <RecordForm entity={entity} fixed={fixed} onDone={() => { setCreating(false); toast(`${d.label} saved to database`); }} />}
      </Drawer>
    </div>
  );
}

function CustomCell({ c, entity, row, value, canWrite }: { c: CustomFieldDefShape; entity: string; row: TableRow; value: unknown; canWrite: boolean }) {
  const router = useRouter();
  const { run } = useRun();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<unknown>(value);
  const saving = useRef(false);
  const latest = useRef<unknown>(value); // read by Enter/blur so a stale render closure can't drop the edit
  const [optimistic, setOptimistic] = useState<{ v: unknown } | null>(null);
  useEffect(() => setOptimistic(null), [value]);
  const f = customAsField(c);
  const save = async (v: unknown) => {
    if (saving.current) return; // Enter then blur would otherwise save twice and race the refresh.
    saving.current = true;
    setEditing(false);
    const fv = finalise(f, v);
    try {
      if (JSON.stringify(fv ?? null) === JSON.stringify(value ?? null)) return;
      setOptimistic({ v: fv });
      if (await run(setCustomValueAction(entity, row.id, c.key, fv)) !== undefined) router.refresh();
      else setOptimistic(null);
    } finally { saving.current = false; }
  };
  const v0 = optimistic ? optimistic.v : value;
  const shown = v0 === null || v0 === undefined || v0 === "" ? <span className="subtle">—</span>
    : c.type === "money" ? money(Number(v0)) : c.type === "date" ? date(String(v0)) : c.type === "bool" ? (v0 ? "Yes" : "No")
    : c.type === "url" ? <a href={String(v0)} target="_blank" rel="noreferrer noopener">{String(v0).replace(/^https?:\/\//, "").slice(0, 30)}</a> : String(v0);
  return (
    <td className={["number", "money"].includes(c.type) ? "num" : ""}>
      {editing ? <FieldInput f={f} value={draft} compact autoFocus onChange={(v) => { latest.current = v; setDraft(v); if (["select", "bool", "date"].includes(c.type)) save(v); }} onBlur={() => save(latest.current)} onKeyDown={(e) => { if (e.key === "Enter") save(latest.current); if (e.key === "Escape") setEditing(false); }} />
        : canWrite ? <button className="cell-btn" aria-label={`Edit ${c.label}`} onClick={() => { latest.current = value; setDraft(value); setEditing(true); }}>{shown}</button> : shown}
    </td>
  );
}
