"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppWindow, Database, FileText, Home, Inbox, LayoutTemplate, Moon, Plus, PlusCircle, Search, Settings, Table2, Users } from "lucide-react";
import { quickAddAction, searchEverythingAction } from "@/app/hub-actions";
import type { SearchHit } from "@/server/hub/hub";
import { useThemeMode } from "@/components/ui/theme-toggle";

/** Open the palette from anywhere (buttons, rail, sidebar). */
export const openCommandPalette = () => window.dispatchEvent(new Event("bangon:palette"));

type Cmd = { id: string; title: string; subtitle?: string; icon: React.ReactNode; run: () => void; keywords?: string };
const KIND_ICON = { base: <Database size={16} />, table: <Table2 size={16} />, app: <AppWindow size={16} />, record: <FileText size={16} />, create: <PlusCircle size={16} /> };

/** ⌘K / Ctrl+K: jump to any base, table, app or record, or run a command. */
export function CommandPalette() {
  const router = useRouter();
  const currentBase = usePathname().match(/^\/base\/([0-9a-f-]{36})/)?.[1];
  const { mode, setMode } = useThemeMode();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey); window.addEventListener("bangon:palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("bangon:palette", onOpen); };
  }, []);
  useEffect(() => { if (open) { setQ(""); setHits([]); setI(0); setTimeout(() => input.current?.focus(), 10); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const s = ++seq.current;
    if (!q.trim()) { setHits([]); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(async () => { const r = await searchEverythingAction(q, currentBase); if (s === seq.current) { setHits(r.ok ? r.data : []); setBusy(false); setI(0); } }, 140);
    return () => clearTimeout(t);
  }, [q, open, currentBase]);

  const go = (href: string) => { setOpen(false); router.push(href); };
  const commands: Cmd[] = useMemo(() => [
    { id: "home", title: "Go to Home", icon: <Home size={16} />, run: () => go("/") },
    { id: "work", title: "Go to My work", subtitle: "Overdue, due soon, assigned to you, approvals", icon: <Inbox size={16} />, run: () => go("/my-work"), keywords: "inbox tasks today" },
    { id: "new-base", title: "Create a base", icon: <Plus size={16} />, run: () => go("/?new=base"), keywords: "new" },
    { id: "templates", title: "Browse templates", icon: <LayoutTemplate size={16} />, run: () => go("/templates") },
    { id: "members", title: "Members & roles", icon: <Users size={16} />, run: () => go("/workspace/members"), keywords: "invite people team" },
    { id: "settings", title: "Settings", subtitle: "Profile, password, appearance, workspace, integrations", icon: <Settings size={16} />, run: () => go("/workspace/settings"), keywords: "preferences account" },
    { id: "theme", title: `Switch to ${mode === "dark" ? "light" : "dark"} mode`, icon: <Moon size={16} />, run: () => { setMode(mode === "dark" ? "light" : "dark"); setOpen(false); }, keywords: "theme appearance light dark" },
  ], [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = q.trim().toLowerCase();
  const cmds = commands.filter((c) => !n || `${c.title} ${c.keywords ?? ""}`.toLowerCase().includes(n));
  const [err, setErr] = useState("");
  const quick = async (h: SearchHit) => { setErr(""); const r = await quickAddAction(h.id, h.text ?? ""); if (!r.ok) { setErr(r.error); return; } go(`/base/${r.data.baseId}/${r.data.tableId}?record=${r.data.recordId}`); };
  const list: Cmd[] = [...hits.map((h) => ({ id: `${h.kind}:${h.id}`, title: h.title, subtitle: h.subtitle, icon: KIND_ICON[h.kind], run: () => (h.kind === "create" ? quick(h) : go(h.href)) })), ...cmds];

  if (!open) return null;
  return (
    <div className="cp-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="cp" role="dialog" aria-modal="true" aria-label="Search and commands">
        <div className="cp-in"><Search size={18} aria-hidden />
          <input ref={input} value={q} placeholder="Search, run a command, or quick-add (Tasks: call Sam Friday)…" aria-label="Search" role="combobox" aria-expanded aria-controls="cp-list" aria-activedescendant={list[i] ? `cp-${list[i].id}` : undefined}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(list.length - 1, x + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); list[i]?.run(); }
            }} />
          <kbd>esc</kbd>
        </div>
        <ul className="cp-list" id="cp-list" role="listbox">
          {err && <li className="cp-empty" role="alert" style={{ color: "#d93025" }}>{err}</li>}
          {busy && !hits.length && <li className="cp-empty">Searching…</li>}
          {!busy && n && !list.length && <li className="cp-empty">Nothing matches “{q}”.</li>}
          {list.map((c, k) => (
            <li key={c.id} id={`cp-${c.id}`} role="option" aria-selected={k === i} className={k === i ? "on" : ""} onMouseEnter={() => setI(k)} onMouseDown={(e) => { e.preventDefault(); c.run(); }}>
              <span className="cp-ic">{c.icon}</span><span className="cp-t">{c.title}{c.subtitle && <small>{c.subtitle}</small>}</span>
            </li>
          ))}
        </ul>
        <div className="cp-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>⌘</kbd><kbd>K</kbd> toggle</span></div>
      </div>
    </div>
  );
}
