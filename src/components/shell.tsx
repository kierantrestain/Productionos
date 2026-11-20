"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavItem } from "@/lib/nav";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { logoutAction, switchOrgAction } from "@/app/actions";
import { Drawer, ToastProvider } from "./client";
import { OrgConfigProvider } from "./org-config";
import type { CustomFieldDefShape, OrgSettingsShape } from "@/lib/customise";
import { Icon } from "./icons";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export function Shell({ nav, user, children, orgs = [], orgId, config = { settings: {}, customFields: [] } }: { nav: NavItem[]; user: { name: string; role: Role; orgName: string; isDemo: boolean }; children: React.ReactNode; orgs?: { id: string; name: string; isDemo: boolean }[]; orgId?: string; config?: { settings: OrgSettingsShape; customFields: CustomFieldDefShape[] } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(true); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const sections = [...new Set(nav.map((n) => n.section))];
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  return (
    <ToastProvider>
      <OrgConfigProvider value={config}>
      <a href="#main" className="sr-only">Skip to content</a>
      <div className="shell" data-nav-open={open}>
        <aside className="sidebar" aria-label="Primary">
          <Link href="/" className="brand" style={{ color: "inherit", textDecoration: "none" }}><span className="brand-mark">B</span><div>Bang On OS<small>Production Suite · {user.orgName}</small></div></Link>
          <nav className="nav">
            {sections.map((s) => (
              <div key={s} style={{ display: "contents" }}>
                <div className="nav-section">{s}</div>
                {nav.filter((n) => n.section === s).map((n) => (
                  <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? "page" : undefined}><Icon name={n.icon} />{n.label}</Link>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div style={{ fontWeight: 600 }}>{user.name}</div>
            <div className="subtle">{ROLE_LABELS[user.role]}</div>
            {orgs.length > 1 && <select className="select" style={{ marginTop: 8, height: 30, fontSize: 12 }} aria-label="Switch organisation" value={orgId} onChange={(e) => switchOrgAction(e.target.value)}>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}{o.isDemo ? " (demo)" : ""}</option>)}
            </select>}
            <form action={logoutAction} style={{ marginTop: 8 }}><button className="btn btn-quiet btn-sm" style={{ paddingLeft: 0 }}><Icon name="logout" /> Sign out</button></form>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="btn btn-quiet icon-btn menu-toggle" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="menu" /></button>
            <button className="btn search-trigger" onClick={() => setPalette(true)} aria-label="Search (Ctrl+K)">
              <Icon name="search" /> <span className="label-long">Search productions, scenes, people…</span><span className="spacer" /><kbd className="mono subtle">⌘K</kbd>
            </button>
            <div className="spacer" />
            <ThemeToggle />
            {user.isDemo && <span className="badge tone-warn" title="This organisation contains clearly labelled demonstration data, not imported source records.">Demo workspace</span>}
          </header>
          <main id="main" className="content" tabIndex={-1}>{children}</main>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} nav={nav} />
      </OrgConfigProvider>
    </ToastProvider>
  );
}

function CommandPalette({ open, onClose, nav }: { open: boolean; onClose: () => void; nav: NavItem[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ href: string; label: string; kind: string }[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(""); setActive(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  useEffect(() => {
    const navHits = nav.filter((n) => n.label.toLowerCase().includes(q.toLowerCase())).map((n) => ({ href: n.href, label: n.label, kind: "Go to" }));
    if (q.trim().length < 2) { setResults(navHits); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }).then((r) => r.json()).then((j) => setResults([...navHits, ...(j.results ?? [])])).catch(() => {});
    }, 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, nav]);
  const go = (href: string) => { onClose(); router.push(href); };
  return (
    <Drawer open={open} onClose={onClose} title="Search" modal>
      <input ref={input} className="input" style={{ height: 40 }} placeholder="Type to search…" value={q} aria-label="Search everything"
        onChange={(e) => { setQ(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter" && results[active]) go(results[active].href);
        }} />
      <ul className="palette-list" role="listbox" aria-label="Results">
        {results.map((r, i) => (
          <li key={r.href + i} role="option" aria-selected={i === active}><a href={r.href} data-active={i === active} onClick={(e) => { e.preventDefault(); go(r.href); }}><span>{r.label}</span><span className="subtle" style={{ fontSize: 12 }}>{r.kind}</span></a></li>
        ))}
        {!results.length && <li className="subtle" style={{ padding: 10 }}>No results</li>}
      </ul>
    </Drawer>
  );
}
