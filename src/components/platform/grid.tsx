"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
type MenuItems = NonNullable<Extract<React.ComponentProps<typeof DropdownMenu>, { items: unknown }>["items"]>;
import { ChevronDown, ChevronRight, Maximize2, MessageSquare, Plus, Lock } from "lucide-react";
import type { ViewConfig } from "@/db/schema";
import { COLORS, ROW_HEIGHTS, isComputed } from "@/lib/platform/fields";
import { CellEditor, CellView, cellText, NUMERIC, AiCellButton } from "./cells";
import { FieldIcon } from "./icons";
import type { ClientField, ClientRow } from "./types";

export type CellEdit = { recordId: string; fieldId: string; value: unknown; before?: unknown };
type Item = { kind: "group"; key: string; label: string; count: number; depth: number; top: number; h: number } | { kind: "row"; row: ClientRow; idx: number; top: number; h: number };

export const SUMMARY_FNS: Record<string, string> = { none: "None", filled: "Filled", empty: "Empty", unique: "Unique", percentFilled: "% filled", sum: "Sum", avg: "Average", min: "Min", max: "Max", range: "Range", checked: "Checked", earliest: "Earliest", latest: "Latest" };
export function summaryFnsFor(f: ClientField) {
  const base = ["none", "filled", "empty", "unique", "percentFilled"];
  if (NUMERIC.has(f.type) || (f.type === "rollup" || f.type === "formula")) return [...base, "sum", "avg", "min", "max", "range"];
  if (f.type === "checkbox") return ["none", "checked"];
  if (["date", "dateTime", "createdTime", "lastModifiedTime"].includes(f.type)) return [...base, "earliest", "latest"];
  return base;
}
export function summarise(f: ClientField, rows: ClientRow[], fn: string): string {
  const vals = rows.map((r) => r.values[f.id]);
  const filled = vals.filter((v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length) && v !== false);
  const nums = filled.map(Number).filter((n) => Number.isFinite(n));
  const fmt = (n: number) => (f.type === "currency" ? `${f.options.symbol ?? "£"}${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}` : f.type === "percent" ? `${Math.round(n * 1000) / 10}%` : n.toLocaleString("en-GB", { maximumFractionDigits: 2 }));
  const dates = filled.map((v) => new Date(String(v)).getTime()).filter((n) => Number.isFinite(n));
  switch (fn) {
    case "filled": return `${filled.length} filled`;
    case "empty": return `${vals.length - filled.length} empty`;
    case "unique": return `${new Set(filled.map((v) => cellText(f, v))).size} unique`;
    case "percentFilled": return vals.length ? `${Math.round((filled.length / vals.length) * 100)}% filled` : "–";
    case "sum": return `Sum ${fmt(nums.reduce((a, b) => a + b, 0))}`;
    case "avg": return nums.length ? `Avg ${fmt(nums.reduce((a, b) => a + b, 0) / nums.length)}` : "–";
    case "min": return nums.length ? `Min ${fmt(Math.min(...nums))}` : "–";
    case "max": return nums.length ? `Max ${fmt(Math.max(...nums))}` : "–";
    case "range": return nums.length ? `Range ${fmt(Math.max(...nums) - Math.min(...nums))}` : "–";
    case "checked": return `${filled.length} checked`;
    case "earliest": return dates.length ? new Date(Math.min(...dates)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–";
    case "latest": return dates.length ? new Date(Math.max(...dates)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–";
    default: return "";
  }
}

export interface GridProps {
  fields: ClientField[]; rows: ClientRow[]; config: ViewConfig; allFields: ClientField[];
  commentCounts: Record<string, number>; collaborators: { id: string; name: string }[];
  can: { create: boolean; edit: boolean; delete: boolean; schema: boolean; viewEdit: boolean };
  onEdit: (cells: CellEdit[]) => Promise<boolean>;
  onAddRow: (afterId?: string, values?: Record<string, unknown>) => void;
  onExpand: (id: string) => void;
  onDeleteRows: (ids: string[]) => void;
  onDuplicate: (id: string) => void;
  onSetColor: (ids: string[], color: string | null) => void;
  onFieldAction: (f: ClientField, action: string) => void;
  onAddField: (anchor?: DOMRect) => void;
  onConfig: (patch: ViewConfig) => void;
  onAiFill: (fieldId: string, ids: string[]) => void;
  onReload?: () => void;
  onButton?: (f: ClientField, recordId: string) => void;
  notify: (msg: string) => void;
}

const NUM_W = 72, HEAD_H = 32, GROUP_H = 36, ADD_H = 32, DEFAULT_W = 180, PRIMARY_W = 240;

export function Grid(p: GridProps) {
  const { fields, rows, config } = p;
  const rowH = ROW_HEIGHTS[config.rowHeight ?? "short"];
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0, h: 800 });
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ initial?: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; rowId: string } | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>(config.widths ?? {});
  const [drag, setDrag] = useState<string | null>(null);
  const undo = useRef<CellEdit[][]>([]); const redo = useRef<CellEdit[][]>([]);
  useEffect(() => setWidths(config.widths ?? {}), [config.widths]);

  const width = (f: ClientField) => widths[f.id] ?? (f.isPrimary ? PRIMARY_W : DEFAULT_W);
  const lefts = useMemo(() => { let x = NUM_W; return fields.map((f) => { const l = x; x += width(f); return l; }); }, [fields, widths]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalW = NUM_W + fields.reduce((a, f) => a + width(f), 0) + 96;

  // Flatten rows + group headers into positioned items.
  const groupFields = (config.groups ?? []).map((g) => p.allFields.find((f) => f.id === g.fieldId)).filter(Boolean) as ClientField[];
  const items = useMemo(() => {
    const out: Item[] = []; let y = 0;
    const keyOf = (r: ClientRow, d: number) => groupFields.slice(0, d + 1).map((g) => cellText(g, r.values[g.id]) || "(Empty)").join(" › ");
    let prev: string[] = [];
    const counts = new Map<string, number>();
    for (const r of rows) for (let d = 0; d < groupFields.length; d++) counts.set(keyOf(r, d), (counts.get(keyOf(r, d)) ?? 0) + 1);
    rows.forEach((r, idx) => {
      const keys = groupFields.map((_, d) => keyOf(r, d));
      for (let d = 0; d < keys.length; d++) {
        if (keys[d] !== prev[d]) {
          if (!keys.slice(0, d).some((k) => collapsed.has(k))) { out.push({ kind: "group", key: keys[d], label: cellText(groupFields[d], r.values[groupFields[d].id]) || "(Empty)", count: counts.get(keys[d]) ?? 0, depth: d, top: y, h: GROUP_H }); y += GROUP_H; }
          prev = [...keys.slice(0, d + 1)];
        }
      }
      prev = keys;
      if (keys.some((k) => collapsed.has(k))) return;
      out.push({ kind: "row", row: r, idx, top: y, h: rowH }); y += rowH;
    });
    return { list: out, height: y };
  }, [rows, groupFields.map((g) => g.id).join(), collapsed, rowH]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowItems = useMemo(() => items.list.filter((i): i is Extract<Item, { kind: "row" }> => i.kind === "row"), [items]);

  const visible = items.list.filter((i) => i.top + i.h >= scroll.top - 400 && i.top <= scroll.top + scroll.h + 400);
  useLayoutEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setScroll((s) => ({ ...s, h: el.clientHeight }))); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cellAt = (r: number, c: number) => ({ row: rowItems[r]?.row, f: fields[c] });
  const editableCell = (f?: ClientField) => !!f && p.can.edit && f.editable && !isComputed(f.type) && f.type !== "button";
  const range = active && anchor ? { r0: Math.min(active.r, anchor.r), r1: Math.max(active.r, anchor.r), c0: Math.min(active.c, anchor.c), c1: Math.max(active.c, anchor.c) } : active ? { r0: active.r, r1: active.r, c0: active.c, c1: active.c } : null;

  const scrollIntoView = useCallback((r: number, c: number) => {
    const el = wrapRef.current; const it = rowItems[r]; if (!el || !it) return;
    const top = it.top + HEAD_H; if (top < el.scrollTop + HEAD_H) el.scrollTop = top - HEAD_H * 2; else if (top + it.h > el.scrollTop + el.clientHeight - 30) el.scrollTop = top + it.h - el.clientHeight + 40;
    const f = fields[c]; if (!f || f.isPrimary) return; const l = lefts[c], stickyW = NUM_W + (fields[0]?.isPrimary ? width(fields[0]) : 0);
    if (l < el.scrollLeft + stickyW) el.scrollLeft = l - stickyW; else if (l + width(f) > el.scrollLeft + el.clientWidth) el.scrollLeft = l + width(f) - el.clientWidth + 8;
  }, [rowItems, fields, lefts]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (dr: number, dc: number, extend = false) => {
    const cur = active ?? { r: 0, c: 0 };
    const next = { r: Math.max(0, Math.min(rowItems.length - 1, cur.r + dr)), c: Math.max(0, Math.min(fields.length - 1, cur.c + dc)) };
    if (!extend) setAnchor(null); else if (!anchor) setAnchor(cur);
    setActive(next); scrollIntoView(next.r, next.c);
  };

  const commitEdits = async (cells: CellEdit[], record = true) => {
    if (!cells.length) return;
    const ok = await p.onEdit(cells);
    if (ok && record) { undo.current.push(cells); redo.current = []; if (undo.current.length > 100) undo.current.shift(); }
  };
  const doUndo = async (isRedo: boolean) => {
    const stack = isRedo ? redo.current : undo.current; const batch = stack.pop(); if (!batch) return;
    const inverse = batch.map((c) => ({ ...c, value: isRedo ? c.value : c.before, before: isRedo ? c.before : c.value }));
    const ok = await p.onEdit(inverse.map((c) => ({ recordId: c.recordId, fieldId: c.fieldId, value: c.value })));
    if (ok) (isRedo ? undo.current : redo.current).push(batch);
    p.notify(isRedo ? "Redone" : "Undone");
  };

  const toggleCheckbox = (r: number, c: number) => {
    const { row, f } = cellAt(r, c); if (!row || !f || !editableCell(f)) return;
    commitEdits([{ recordId: row.id, fieldId: f.id, value: !row.values[f.id], before: row.values[f.id] ?? false }]);
  };

  const onCopy = (e: ClipboardEvent) => {
    if (editing || !range) return;
    const lines: string[] = [];
    for (let r = range.r0; r <= range.r1; r++) { const row = rowItems[r]?.row; if (!row) continue; const cols: string[] = []; for (let c = range.c0; c <= range.c1; c++) cols.push(cellText(fields[c], row.values[fields[c].id]).replace(/[\t\n]/g, " ")); lines.push(cols.join("\t")); }
    e.clipboardData?.setData("text/plain", lines.join("\n")); e.preventDefault();
    p.notify(`Copied ${(range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1)} cells`);
  };
  const onPaste = async (e: ClipboardEvent) => {
    if (editing || !active) return;
    const text = e.clipboardData?.getData("text/plain"); if (!text) return; e.preventDefault();
    const grid = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    const cells: CellEdit[] = []; let skipped = 0;
    const fill = range && grid.length === 1 && grid[0].length === 1; // single value fills the selection
    const rN = fill ? range!.r1 - range!.r0 + 1 : grid.length, cN = fill ? range!.c1 - range!.c0 + 1 : grid[0].length;
    const r0 = fill ? range!.r0 : active.r, c0 = fill ? range!.c0 : active.c;
    for (let i = 0; i < rN; i++) for (let j = 0; j < cN; j++) {
      const { row, f } = cellAt(r0 + i, c0 + j); if (!row || !f) continue;
      if (!editableCell(f) || ["link", "user", "attachment"].includes(f.type)) { skipped++; continue; }
      const raw = fill ? grid[0][0] : grid[i][j];
      cells.push({ recordId: row.id, fieldId: f.id, value: f.type === "multipleSelects" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : raw === "" ? null : raw, before: row.values[f.id] ?? null });
    }
    await commitEdits(cells);
    if (skipped) p.notify(`${skipped} cells skipped (read-only, linked or calculated)`);
  };
  useEffect(() => {
    const c = (e: ClipboardEvent) => { if (wrapRef.current?.contains(document.activeElement)) onCopy(e); };
    const v = (e: ClipboardEvent) => { if (wrapRef.current?.contains(document.activeElement)) onPaste(e); };
    document.addEventListener("copy", c); document.addEventListener("paste", v);
    return () => { document.removeEventListener("copy", c); document.removeEventListener("paste", v); };
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(e.shiftKey); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); doUndo(true); return; }
    if (!active) { if (["ArrowDown", "ArrowRight", "Enter"].includes(e.key) && rowItems.length) { e.preventDefault(); setActive({ r: 0, c: 0 }); } return; }
    const { row, f } = cellAt(active.r, active.c);
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); move(mod ? -1e9 : -1, 0, e.shiftKey); return;
      case "ArrowDown": e.preventDefault(); move(mod ? 1e9 : 1, 0, e.shiftKey); return;
      case "ArrowLeft": e.preventDefault(); move(0, mod ? -1e9 : -1, e.shiftKey); return;
      case "ArrowRight": e.preventDefault(); move(0, mod ? 1e9 : 1, e.shiftKey); return;
      case "Tab": e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return;
      case "Escape": setAnchor(null); setSelected(new Set()); return;
      case "Enter":
        e.preventDefault();
        if (e.shiftKey && row) { p.onExpand(row.id); return; }
        if (f?.type === "checkbox") toggleCheckbox(active.r, active.c); else if (editableCell(f)) setEditing({});
        else if (f && !isComputed(f.type)) p.notify("You don't have permission to edit this field");
        return;
      case " ":
        e.preventDefault();
        if (f?.type === "checkbox") toggleCheckbox(active.r, active.c); else if (row) p.onExpand(row.id);
        return;
      case "Backspace": case "Delete": {
        e.preventDefault(); if (!range) return;
        const cells: CellEdit[] = [];
        for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) { const x = cellAt(r, c); if (x.row && editableCell(x.f)) cells.push({ recordId: x.row.id, fieldId: x.f.id, value: x.f.type === "checkbox" ? false : null, before: x.row.values[x.f.id] ?? null }); }
        commitEdits(cells); return;
      }
    }
    if (e.key.length === 1 && !mod && !e.altKey && editableCell(f) && !["checkbox", "rating", "link", "user", "date", "dateTime"].includes(f!.type)) { e.preventDefault(); setEditing({ initial: e.key }); }
  };

  const startResize = (f: ClientField, e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = width(f); let w = w0;
    const mv = (ev: PointerEvent) => { w = Math.max(60, Math.min(800, w0 + ev.clientX - x0)); setWidths((ws) => ({ ...ws, [f.id]: w })); };
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); if (p.can.viewEdit) p.onConfig({ widths: { ...(config.widths ?? {}), [f.id]: w } }); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  const dropOn = (target: ClientField) => {
    if (!drag || drag === target.id || target.isPrimary) return;
    const order = (config.order?.length ? config.order : p.allFields.map((f) => f.id)).filter((id) => id !== drag);
    for (const f of p.allFields) if (!order.includes(f.id) && f.id !== drag) order.push(f.id);
    order.splice(order.indexOf(target.id), 0, drag);
    p.onConfig({ order }); setDrag(null);
  };

  const activeItem = active ? rowItems[active.r] : undefined;
  const activeField = active ? fields[active.c] : undefined;
  const sticky = (c: number) => fields[c]?.isPrimary && c === 0;
  const allSelected = rows.length > 0 && selected.size === rows.length;

  const headerItems = (f: ClientField) => [
    ...(p.can.schema ? [{ label: "Edit field", onClick: () => p.onFieldAction(f, "edit") }, ...(f.isPrimary ? [] : [{ label: "Set as primary field", onClick: () => p.onFieldAction(f, "primary") }]), { label: "Duplicate field", onClick: () => p.onFieldAction(f, "duplicate") }, { label: "Insert right", onClick: () => p.onFieldAction(f, "insertRight") }, { type: "divider" as const }] : []),
    ...(f.type === "aiText" && p.can.edit ? [{ label: "Generate AI for empty cells", onClick: () => p.onAiFill(f.id, rows.filter((r) => !r.values[f.id]).map((r) => r.id)) }, { type: "divider" as const }] : []),
    { label: "Sort A → Z", onClick: () => p.onConfig({ sorts: [{ fieldId: f.id, dir: "asc" }] }) },
    { label: "Sort Z → A", onClick: () => p.onConfig({ sorts: [{ fieldId: f.id, dir: "desc" }] }) },
    { label: "Filter by this field", onClick: () => p.onFieldAction(f, "filter") },
    { label: "Group by this field", onClick: () => p.onConfig({ groups: [{ fieldId: f.id, dir: "asc" }] }) },
    ...(f.isPrimary ? [] : [{ label: "Hide field", onClick: () => p.onConfig({ hidden: [...(config.hidden ?? []), f.id] }) }]),
    ...(p.can.schema && !f.isPrimary ? [{ type: "divider" as const }, { label: "Delete field", variant: "destructive" as const, onClick: () => p.onFieldAction(f, "delete") }] : []),
  ];

  const editorPos = activeItem && activeField && active ? { top: HEAD_H + activeItem.top, left: sticky(active.c) ? scroll.left + NUM_W : lefts[active.c], minWidth: width(activeField) } : null;

  return (
    <div className="g-wrap" ref={wrapRef} tabIndex={0} role="region" aria-label="Records — arrow keys move, Enter edits, Space expands" onKeyDown={onKeyDown}
      onScroll={(e) => { const t = e.currentTarget; setScroll({ top: t.scrollTop, left: t.scrollLeft, h: t.clientHeight }); setMenu(null); }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
      {/* Header */}
      <div className="g-head" style={{ width: totalW }}>
        <div className="g-sticky">
          <div className="g-num" style={{ background: "var(--color-background-muted)" }}>
            <input type="checkbox" aria-label="Select all records" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} />
          </div>
          {fields[0]?.isPrimary && <HeaderCell f={fields[0]} w={width(fields[0])} items={headerItems(fields[0])} onResize={startResize} sort={config.sorts?.find((s) => s.fieldId === fields[0].id)?.dir} />}
        </div>
        {fields.map((f, c) => (sticky(c) ? null :
          <HeaderCell key={f.id} f={f} w={width(f)} items={headerItems(f)} onResize={startResize} sort={config.sorts?.find((s) => s.fieldId === f.id)?.dir}
            draggable={p.can.viewEdit} onDragStart={() => setDrag(f.id)} onDrop={() => dropOn(f)} />))}
        {p.can.schema && <button type="button" className="g-addcol" aria-label="Add field" onClick={(e) => p.onAddField(e.currentTarget.getBoundingClientRect())}><Plus size={16} /></button>}
      </div>

      {/* Body */}
      <div className="g-rows" style={{ height: items.height + (p.can.create ? ADD_H : 0) + 40, width: totalW }}>
        {visible.map((it) => it.kind === "group" ? (
          <div key={`g:${it.key}`} className="g-group" style={{ top: it.top, height: it.h, paddingLeft: 10 + it.depth * 18 }} onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(it.key)) n.delete(it.key); else n.add(it.key); return n; })}>
            {collapsed.has(it.key) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            <span style={{ fontWeight: 400, color: "var(--color-text-secondary)", fontSize: 12 }}>{groupFields[it.depth]?.name}</span>
            <span>{it.label}</span><span style={{ fontWeight: 400, color: "var(--color-text-secondary)", fontSize: 12 }}>{it.count}</span>
          </div>
        ) : (() => {
          const r = rowItems.indexOf(it); const sel = selected.has(it.row.id);
          return (
            <div key={it.row.id} className={`g-row ${sel ? "sel" : ""} ${it.row.color ? `rowtint-${it.row.color}` : ""}`} style={{ top: it.top, height: it.h, width: totalW }}
              onContextMenu={(e) => { e.preventDefault(); const b = wrapRef.current!.getBoundingClientRect(); setMenu({ x: e.clientX - b.left + scroll.left, y: e.clientY - b.top + scroll.top, rowId: it.row.id }); }}>
              <div className="g-sticky">
                <div className="g-num">
                  {it.row.color && <span className={`bar rowbar-${it.row.color}`} />}
                  <input type="checkbox" aria-label={`Select record ${it.idx + 1}`} checked={sel} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(it.row.id)) n.delete(it.row.id); else n.add(it.row.id); return n; })} style={{ display: sel ? undefined : "none" }} className="g-check" />
                  <span className="g-idx">{it.idx + 1}</span>
                  {p.commentCounts[it.row.id] ? <span className="cc" title={`${p.commentCounts[it.row.id]} comments`}><MessageSquare size={11} />{p.commentCounts[it.row.id]}</span> : null}
                  <button type="button" className="exp" aria-label="Expand record" onClick={() => p.onExpand(it.row.id)}><Maximize2 size={13} /></button>
                </div>
                {fields[0]?.isPrimary && <Cell f={fields[0]} row={it.row} w={width(fields[0])} wrap={rowH > 40} active={active?.r === r && active.c === 0} inRange={!!range && r >= range.r0 && r <= range.r1 && range.c0 === 0}
                  onClick={(ev) => { if (ev.shiftKey && active) { if (!anchor) setAnchor(active); } else setAnchor(null); setActive({ r, c: 0 }); }} onDouble={() => editableCell(fields[0]) && setEditing({})} readonly={!editableCell(fields[0])} />}
              </div>
              {fields.map((f, c) => (sticky(c) ? null :
                <Cell key={f.id} f={f} row={it.row} w={width(f)} wrap={rowH > 40} active={active?.r === r && active.c === c} inRange={!!range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1}
                  readonly={!editableCell(f)}
                  onClick={(ev) => {
                    if (ev.shiftKey && active) { if (!anchor) setAnchor(active); } else setAnchor(null);
                    if (active?.r === r && active.c === c && f.type === "checkbox") toggleCheckbox(r, c);
                    if (f.type === "rating" && editableCell(f)) { const t = (ev.target as HTMLElement).closest(".stars span"); if (t) { const i = [...t.parentElement!.children].indexOf(t) + 1; commitEdits([{ recordId: it.row.id, fieldId: f.id, value: i === it.row.values[f.id] ? 0 : i, before: it.row.values[f.id] ?? null }]); } }
                    if (f.type === "button") p.onButton?.(f, it.row.id);
                    setActive({ r, c });
                  }}
                  onDouble={() => { if (f.type === "checkbox") return; if (editableCell(f)) setEditing({}); else if (f.type === "attachment" || isComputed(f.type)) p.onExpand(it.row.id); }}
                  extra={f.type === "aiText" && p.can.edit && f.editable ? <AiCellButton onRun={() => p.onAiFill(f.id, [it.row.id])} /> : undefined} />))}
            </div>
          );
        })())}
        {p.can.create && (
          <div className="g-addrow" style={{ top: items.height, width: totalW }} role="button" tabIndex={-1} onClick={() => p.onAddRow(rows.at(-1)?.id)}>
            <Plus size={14} /> Add record
          </div>
        )}
        {!rows.length && <div style={{ position: "absolute", top: items.height + ADD_H + 24, left: 24, color: "var(--color-text-secondary)" }}>No records match this view.</div>}

        {editing && editorPos && activeItem && activeField && (
          <div className="g-editor" style={{ top: editorPos.top - HEAD_H, left: editorPos.left, minWidth: editorPos.minWidth }} onMouseDown={(e) => e.stopPropagation()}>
            <CellEditor f={activeField} value={activeItem.row.values[activeField.id]} initial={editing.initial} collaborators={p.collaborators} canSchema={p.can.schema} recordId={activeItem.row.id} onRefresh={p.onReload}
              onCancel={() => { setEditing(null); wrapRef.current?.focus(); }}
              onCommit={(v, mv) => {
                setEditing(null); wrapRef.current?.focus();
                const before = activeItem.row.values[activeField.id] ?? null;
                if (JSON.stringify(v) !== JSON.stringify(before)) commitEdits([{ recordId: activeItem.row.id, fieldId: activeField.id, value: v, before }]);
                if (mv === "down") move(1, 0); else if (mv === "right") move(0, 1);
              }} />
          </div>
        )}
        {menu && (
          <RowMenu x={menu.x} y={menu.y - HEAD_H} onClose={() => setMenu(null)} items={[
            { label: "Expand record", run: () => p.onExpand(menu.rowId) },
            ...(p.can.create ? [{ label: "Insert record below", run: () => p.onAddRow(menu.rowId) }, { label: "Duplicate record", run: () => p.onDuplicate(menu.rowId) }] : []),
            { label: "Copy record URL", run: () => { navigator.clipboard?.writeText(`${location.origin}${location.pathname}?record=${menu.rowId}`); p.notify("Record URL copied"); } },
            ...(p.can.edit ? [{ label: "Row colour", colors: true, run: () => {} }] : []),
            ...(p.can.delete ? [{ label: selected.size > 1 && selected.has(menu.rowId) ? `Delete ${selected.size} records` : "Delete record", danger: true, run: () => { p.onDeleteRows(selected.has(menu.rowId) ? [...selected] : [menu.rowId]); setSelected(new Set()); } }] : []),
          ]} onColor={(c) => p.onSetColor(selected.has(menu.rowId) ? [...selected] : [menu.rowId], c)} />
        )}
      </div>

      {/* Summary footer */}
      <div className="g-foot" style={{ width: totalW }}>
        <div className="g-sticky" style={{ background: "var(--color-background-muted)" }}>
          <div className="g-fcell" style={{ width: NUM_W, justifyContent: "flex-start" }}>{rows.length} {rows.length === 1 ? "record" : "records"}</div>
          {fields[0]?.isPrimary && <Summary f={fields[0]} w={width(fields[0])} rows={rows} fn={config.summaries?.[fields[0].id]} onPick={(fn) => p.onConfig({ summaries: { ...(config.summaries ?? {}), [fields[0].id]: fn } })} />}
        </div>
        {fields.map((f, c) => (sticky(c) ? null : <Summary key={f.id} f={f} w={width(f)} rows={rows} fn={config.summaries?.[f.id]} onPick={(fn) => p.onConfig({ summaries: { ...(config.summaries ?? {}), [f.id]: fn } })} />))}
        {selected.size > 0 && (
          <div style={{ position: "sticky", right: 8, marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", background: "var(--color-background-card)", padding: "0 8px", borderRadius: 6 }}>
            {selected.size} selected
            {p.can.delete && <button type="button" className="p-tbtn" style={{ color: "var(--color-text-red)" }} onClick={() => { p.onDeleteRows([...selected]); setSelected(new Set()); }}>Delete</button>}
            <button type="button" className="p-tbtn" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>
    </div>
  );
}

function HeaderCell({ f, w, items, onResize, sort, draggable, onDragStart, onDrop }: { f: ClientField; w: number; items: MenuItems; onResize: (f: ClientField, e: React.PointerEvent) => void; sort?: string; draggable?: boolean; onDragStart?: () => void; onDrop?: () => void }) {
  return (
    <div className="g-hcell" data-field-id={f.id} style={{ width: w }} title={f.description ?? f.name} draggable={draggable} onDragStart={onDragStart} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <span className="ic"><FieldIcon type={f.type} /></span>
      <span className="nm">{f.name}</span>
      {!f.editable && !isComputed(f.type) && <Lock size={11} aria-label="Read-only for you" />}
      {sort && <span style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{sort === "asc" ? "↑" : "↓"}</span>}
      <DropdownMenu items={items} menuWidth={220} renderTrigger={(t) => <button type="button" {...t} className="g-hmenu" aria-label={`${f.name} field menu`}><ChevronDown size={14} /></button>} />
      <span className="g-resize" onPointerDown={(e) => onResize(f, e)} aria-hidden />
    </div>
  );
}

function Cell({ f, row, w, wrap, active, inRange, readonly, onClick, onDouble, extra }: { f: ClientField; row: ClientRow; w: number; wrap: boolean; active: boolean; inRange: boolean; readonly: boolean; onClick: (e: React.MouseEvent) => void; onDouble: () => void; extra?: React.ReactNode }) {
  const right = NUMERIC.has(f.type) || ((f.type === "rollup" || f.type === "formula") && typeof row.values[f.id] === "number");
  return (
    <div className={`g-cell ${wrap ? "wrap" : ""} ${f.isPrimary ? "primary" : ""} ${active ? "active" : ""} ${inRange && !active ? "inrange" : ""} ${readonly ? "readonly" : ""}`}
      style={{ width: w, justifyContent: right ? "flex-end" : undefined }} aria-current={active ? "true" : undefined} onMouseDown={onClick} onDoubleClick={onDouble}>
      <CellView f={f} v={row.values[f.id]} />
      {active && extra}
    </div>
  );
}

function Summary({ f, w, rows, fn, onPick }: { f: ClientField; w: number; rows: ClientRow[]; fn?: string; onPick: (fn: string) => void }) {
  return (
    <DropdownMenu menuWidth={180} items={summaryFnsFor(f).map((k) => ({ label: SUMMARY_FNS[k], onClick: () => onPick(k) }))}
      renderTrigger={(t) => <button type="button" {...t} className="g-fcell" style={{ width: w, border: 0, background: "transparent", font: "inherit", color: "inherit" }} aria-label={`Summary for ${f.name}`}>{fn && fn !== "none" ? summarise(f, rows, fn) : ""}</button>} />
  );
}

function RowMenu({ x, y, items, onClose, onColor }: { x: number; y: number; items: { label: string; run: () => void; danger?: boolean; colors?: boolean }[]; onClose: () => void; onColor: (c: string | null) => void }) {
  useEffect(() => { const h = () => onClose(); window.addEventListener("mousedown", h); window.addEventListener("keydown", h); return () => { window.removeEventListener("mousedown", h); window.removeEventListener("keydown", h); }; }, [onClose]);
  return (
    <div className="g-editor" role="menu" style={{ top: y, left: x, width: 220, padding: 4, border: "1px solid var(--color-border)" }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((i) => i.colors ? (
        <div key="colors" style={{ padding: "6px 8px" }}>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>Row colour</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {COLORS.map((c) => <button key={c} type="button" aria-label={c} className={`rowbar-${c}`} style={{ width: 18, height: 18, borderRadius: 4, border: 0, cursor: "pointer" }} onClick={() => { onColor(c); onClose(); }} />)}
            <button type="button" className="p-tbtn" style={{ height: 18, fontSize: 11 }} onClick={() => { onColor(null); onClose(); }}>None</button>
          </div>
        </div>
      ) : <div key={i.label} role="menuitem" tabIndex={0} className="g-opt" style={i.danger ? { color: "var(--color-text-red)" } : undefined} onClick={() => { i.run(); onClose(); }}>{i.label}</div>)}
    </div>
  );
}
