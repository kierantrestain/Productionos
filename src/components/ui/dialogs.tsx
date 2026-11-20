"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "./modal";

/**
 * In-app replacements for window.confirm / prompt / alert. Native browser pop-ups block the page,
 * ignore the theme and can't be styled or tested reliably; these render as themed dialogs and
 * resolve a promise. Mount <DialogHost/> once (in Providers).
 */
type Req =
  | { kind: "confirm"; title: string; message?: string; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: "prompt"; title: string; message?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string; multiline?: boolean; resolve: (v: string | null) => void }
  | { kind: "alert"; title: string; message?: string; resolve: (v: void) => void };

// Requests travel as a window event so every bundle that imports this module reaches the single host
// mounted in Providers (module-level singletons can be duplicated across code-split chunks).
const EVT = "bangon:dialog";
let hostMounted = false;
function open(r: Req) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __bangonDialogHost?: boolean };
  if (!w.__bangonDialogHost && !hostMounted) { // no host (should not happen): fall back to the browser's own dialog
    if (r.kind === "confirm") r.resolve(window.confirm(r.message ? `${r.title}\n\n${r.message}` : r.title));
    else if (r.kind === "prompt") r.resolve(window.prompt(r.title, r.defaultValue));
    else { window.alert(r.message ? `${r.title}\n\n${r.message}` : r.title); r.resolve(); }
    return;
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: r }));
}

export function confirmDialog(title: string, opts: { message?: string; confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => open({ kind: "confirm", title, ...opts, resolve }));
}
export function promptDialog(title: string, defaultValue = "", opts: { message?: string; placeholder?: string; confirmLabel?: string; multiline?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => open({ kind: "prompt", title, defaultValue, ...opts, resolve }));
}
export function alertDialog(title: string, message?: string): Promise<void> {
  return new Promise((resolve) => open({ kind: "alert", title, message, resolve }));
}

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [val, setVal] = useState("");
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const queue = useRef<Req[]>([]);
  const show = (r: Req) => { setReq(r); setVal(r.kind === "prompt" ? r.defaultValue ?? "" : ""); };
  const current = useRef<Req | null>(null);
  current.current = req;
  useEffect(() => {
    const w = window as unknown as { __bangonDialogHost?: boolean };
    w.__bangonDialogHost = true; hostMounted = true;
    // setTimeout: callers often run inside a React transition (e.g. Astryx Button clickAction). State set
    // synchronously there is held until the transition ends — which is waiting on this dialog. Deadlock.
    const on = (e: Event) => { const r = (e as CustomEvent<Req>).detail; if (current.current) queue.current.push(r); else { current.current = r; setTimeout(() => show(r), 0); } };
    window.addEventListener(EVT, on);
    return () => { window.removeEventListener(EVT, on); w.__bangonDialogHost = false; hostMounted = false; };
  }, []);
  useEffect(() => { if (req?.kind === "prompt") setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 30); }, [req]);
  if (!req) return null;
  const done = (v: unknown) => { const r = req; current.current = null; setReq(null); (r.resolve as (x: unknown) => void)(v); const q = queue.current.shift(); if (q) setTimeout(() => { current.current = q; show(q); }, 0); };
  const cancel = () => done(req.kind === "confirm" ? false : req.kind === "prompt" ? null : undefined);
  const ok = () => done(req.kind === "confirm" ? true : req.kind === "prompt" ? val : undefined);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) cancel(); }} width={440} padding={6} purpose={req.kind === "prompt" ? "form" : undefined}>
      <form onSubmit={(e) => { e.preventDefault(); if (req.kind !== "prompt" || val.trim()) ok(); }} style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, paddingRight: 28 }}>{req.title}</h2>
        {req.message && <p style={{ margin: 0, color: "var(--color-text-secondary)", fontSize: 14, whiteSpace: "pre-line" }}>{req.message}</p>}
        {req.kind === "prompt" && (req.multiline
          ? <textarea ref={ref} className="ui-input" rows={4} aria-label={req.title} value={val} placeholder={req.placeholder} onChange={(e) => setVal(e.target.value)} />
          : <input ref={ref} className="ui-input" aria-label={req.title} value={val} placeholder={req.placeholder} onChange={(e) => setVal(e.target.value)} />)}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          {req.kind !== "alert" && <Button label="Cancel" onClick={cancel} />}
          <Button type="submit" label={req.kind === "alert" ? "OK" : req.confirmLabel ?? (req.kind === "prompt" ? "Save" : "Confirm")} variant={req.kind === "confirm" && req.danger ? "destructive" : "primary"} isDisabled={req.kind === "prompt" && !val.trim()} />
        </div>
      </form>
    </Dialog>
  );
}
