"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { FieldDef } from "@/lib/entities";
import { humanize } from "@/lib/format";
import { refOptionsAction } from "@/app/actions";
import type { ActionResult } from "@/server/errors";
import { Icon } from "./icons";

// ───────────── Toasts ─────────────

type Toast = { id: number; msg: string; tone?: "bad" };
const ToastCtx = createContext<(msg: string, tone?: "bad") => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((msg: string, tone?: "bad") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.tone ?? ""}`} role={t.tone ? "alert" : "status"}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Run a server action, surface errors as toasts and return data or undefined. */
export function useRun() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const run = useCallback(async <T,>(p: Promise<ActionResult<T>>, success?: string): Promise<T | undefined> => {
    setPending(true);
    try {
      const r = await p;
      if (!r.ok) {
        const details = r.details && typeof r.details === "object" && !Array.isArray(r.details) ? Object.entries(r.details as Record<string, unknown>).filter(([, v]) => typeof v === "string").map(([k, v]) => `${humanize(k)}: ${v}`).join("; ") : "";
        toast(details ? `${r.error} ${details}` : r.error, "bad");
        return undefined;
      }
      if (success) toast(success);
      return r.data;
    } finally { setPending(false); }
  }, [toast]);
  return { run, pending };
}

// ───────────── Dialogs ─────────────

export function Drawer({ open, onClose, title, children, footer, modal }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; modal?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={modal ? "modal" : "drawer"} onClose={onClose} onCancel={onClose} aria-label={title}>
      {open && <>
        <div className="dialog-head"><h2>{title}</h2><button className="btn btn-quiet icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </>}
    </dialog>
  );
}

// ───────────── Field inputs ─────────────

const refCache = new Map<string, Promise<{ id: string; label: string }[]>>();
export function useRefOptions(entity: string | undefined, productionId?: string, enabled = true) {
  const [opts, setOpts] = useState<{ id: string; label: string }[] | null>(null);
  useEffect(() => {
    if (!entity || !enabled) return;
    const key = `${entity}:${productionId ?? ""}`;
    if (!refCache.has(key)) refCache.set(key, refOptionsAction(entity, productionId).then((r) => (r.ok ? r.data : [])));
    let live = true;
    refCache.get(key)!.then((o) => live && setOpts(o));
    return () => { live = false; };
  }, [entity, productionId, enabled]);
  return opts;
}
export function invalidateRefCache() { refCache.clear(); }

export function RefSelect({ entity, value, onChange, productionId, id, autoFocus, className = "select", onBlur, required }: { entity: string; value: string | null; onChange: (v: string | null) => void; productionId?: string; id?: string; autoFocus?: boolean; className?: string; onBlur?: () => void; required?: boolean }) {
  const opts = useRefOptions(entity, productionId);
  return (
    <select id={id} className={className} value={value ?? ""} autoFocus={autoFocus} onBlur={onBlur} required={required} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{opts ? "—" : "Loading…"}</option>
      {value && opts && !opts.some((o) => o.id === value) && <option value={value}>(current)</option>}
      {opts?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}

/** Convert between stored value and input string for a field type. */
export function toInput(f: FieldDef, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (f.type === "money") return (Number(v) / 100).toFixed(2);
  if (f.type === "bp") return String(Number(v) / 100);
  if (f.type === "datetime") { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? "" : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  if (f.type === "time") return String(v).slice(0, 5);
  return String(v);
}
export function fromInput(f: FieldDef, s: string | boolean): unknown {
  if (f.type === "bool") return !!s;
  const str = String(s).trim();
  if (str === "") return null;
  if (f.type === "money") { const n = Math.round(parseFloat(str.replace(/[£,\s]/g, "")) * 100); return Number.isNaN(n) ? str : n; }
  if (f.type === "bp") { const n = Math.round(parseFloat(str) * 100); return Number.isNaN(n) ? str : n; }
  if (f.type === "int") { const n = Number(str); return Number.isNaN(n) ? str : n; }
  if (f.type === "datetime") return new Date(str).toISOString();
  return str;
}

export function FieldInput({ f, value, onChange, productionId, id, autoFocus, compact, onBlur, onKeyDown }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void; productionId?: string; id?: string; autoFocus?: boolean; compact?: boolean; onBlur?: () => void; onKeyDown?: (e: React.KeyboardEvent) => void }) {
  const cls = compact ? "input cell-edit" : "input";
  const common = { id, autoFocus, onBlur, onKeyDown, "aria-label": f.label };
  switch (f.type) {
    case "textarea": return <textarea {...common} className="textarea" value={toInput(f, value)} onChange={(e) => onChange(fromInput(f, e.target.value))} />;
    case "bool": return <input {...common} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case "select": return (
      <select {...common} className={compact ? "select cell-edit" : "select"} value={toInput(f, value)} onChange={(e) => onChange(fromInput(f, e.target.value))}>
        <option value="">—</option>
        {f.options!.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}
      </select>
    );
    case "ref": return <RefSelect id={id} entity={f.ref!} value={(value as string) ?? null} onChange={onChange} productionId={productionId} autoFocus={autoFocus} onBlur={onBlur} className={compact ? "select cell-edit" : "select"} />;
    case "date": return <input {...common} className={cls} type="date" value={toInput(f, value)} onChange={(e) => onChange(fromInput(f, e.target.value))} />;
    case "time": return <input {...common} className={cls} type="time" value={toInput(f, value)} onChange={(e) => onChange(fromInput(f, e.target.value))} />;
    case "datetime": return <input {...common} className={cls} type="datetime-local" value={toInput(f, value)} onChange={(e) => onChange(fromInput(f, e.target.value))} />;
    case "int": case "money": case "bp": return <input {...common} className={cls} inputMode="decimal" value={toInput(f, value)} onChange={(e) => onChange(e.target.value === "" ? null : f.type === "int" ? fromInput(f, e.target.value) : e.target.value)} placeholder={f.type === "money" ? "0.00" : f.type === "bp" ? "%" : ""} />;
    default: return <input {...common} className={cls} type={f.type === "email" ? "email" : f.type === "url" ? "url" : "text"} value={toInput(f, value)} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Normalise raw state strings (money/bp typed as text) before sending. */
export function finalise(f: FieldDef, v: unknown) {
  if ((f.type === "money" || f.type === "bp") && typeof v === "string") return fromInput(f, v);
  return v;
}
