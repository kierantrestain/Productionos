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
import { AppShell } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Home, LogOut, Search, Settings } from "lucide-react";
import { Assistant } from "@/components/hub/assistant";

/** Stable icon components for the Astryx side navigation (one per icon name). */
type SvgIcon = (p: React.SVGProps<SVGSVGElement>) => React.ReactElement;
const ICONS = new Map<string, SvgIcon>();
function iconFor(name: string) {
  let C = ICONS.get(name);
  if (!C) { const Named: SvgIcon = (p) => <Icon name={name} size={Number(p.width ?? p.height ?? 18) || 18} />; ICONS.set(name, Named); C = Named; }
  return C;
}

export function Shell({ nav, user, children, orgs = [], orgId, config = { settings: {}, customFields: [] } }: { nav: NavItem[]; user: { name: string; role: Role; orgName: string; isDemo: boolean }; children: React.ReactNode; orgs?: { id: string; name: string; isDemo: boolean }[]; orgId?: string; config?: { settings: OrgSettingsShape; customFields: CustomFieldDefShape[] } }) {
  const pathname = usePathname();
  const [palette, setPalette] = useState(false);
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
      <div className="p-root suite-root">
      <AppShell variant="elevated" contentPadding={0}
        sideNav={
          <SideNav collapsible
            header={<SideNavHeading heading={user.orgName} subheading="Production Suite" icon={<span className="p-tile p-c-red" style={{ width: 28, height: 28, borderRadius: 8, fontWeight: 800, fontSize: 13 }}>B</span>}
              menu={orgs.length > 1 ? <div style={{ display: "grid", gap: 4, minWidth: 220 }}>{orgs.map((o) => <button key={o.id} className="p-viewitem" onClick={() => switchOrgAction(o.id)} aria-current={o.id === orgId ? "page" : undefined}>{o.name}{o.isDemo ? " (demo)" : ""}</button>)}</div> : undefined} />}
            footer={<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px" }}>
              <Avatar name={user.name} size="sm" />
              <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</div><div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{ROLE_LABELS[user.role]}</div></div>
              <ThemeToggle />
              <form action={logoutAction}><button className="p-tbtn" aria-label="Sign out" title="Sign out"><LogOut size={15} /></button></form>
            </div>}>
            {sections.map((s) => (
              <SideNavSection key={s} title={s}>
                {nav.filter((n) => n.section === s).map((n) => <SideNavItem key={n.href} label={n.label} href={n.href} icon={iconFor(n.icon)} isSelected={isActive(n.href)} />)}
              </SideNavSection>
            ))}
            <SideNavSection title="Bang On OS">
              <SideNavItem label="Workspace home" href="/" icon={Home} />
              <SideNavItem label="Settings" href="/workspace/settings" icon={Settings} />
            </SideNavSection>
          </SideNav>
        }>
        <header className="suite-top">
          <button className="suite-search" onClick={() => setPalette(true)} aria-label="Search (Ctrl+K)">
            <Search size={16} aria-hidden /><span className="label-long">Search productions, scenes, people…</span><span style={{ flex: 1 }} /><kbd>⌘K</kbd>
          </button>
          <span style={{ flex: 1 }} />
          {user.isDemo && <span className="badge tone-warn" title="This organisation contains clearly labelled demonstration data, not imported source records.">Demo workspace</span>}
        </header>
        <main id="main" className="content suite-content" tabIndex={-1}>{children}</main>
      </AppShell>
      <Assistant />
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
