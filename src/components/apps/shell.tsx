"use client";
import Link from "next/link";
import { useState } from "react";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Avatar } from "@astryxdesign/core/Avatar";
import { LayoutDashboard, Users, Filter, Briefcase, FileText, Folder, CheckSquare, BarChart3, Zap, Database, Settings, Calendar, Clapperboard, Home, ChevronDown, Menu, X, Sparkles, LogOut, Grid2x2, Receipt, MessageSquare, Eye, Film, ListChecks, Package, MapPin, Search } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { CommandPalette, openCommandPalette } from "@/components/hub/command-palette";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export const PAGE_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  dashboard: LayoutDashboard, users: Users, funnel: Filter, briefcase: Briefcase, file: FileText, folder: Folder, check: CheckSquare, chart: BarChart3,
  zap: Zap, database: Database, settings: Settings, calendar: Calendar, film: Film, clapper: Clapperboard, home: Home, receipt: Receipt, message: MessageSquare,
  list: ListChecks, package: Package, map: MapPin,
};
export const PAGE_ICON_NAMES = Object.keys(PAGE_ICONS);

type NavItem = { id: string; title: string; slug: string; icon?: string; parentId?: string };

export function AppRuntimeShell({ app, version, preview, canBuild, nav, currentPageId, user, apps, header, children }: {
  app: { id: string; name: string; slug: string; description: string | null; audience: string }; version: string; preview: boolean; canBuild: boolean;
  nav: NavItem[]; currentPageId: string; user: { name: string; role: string }; apps: { slug: string; name: string }[];
  header: { title: string; heading?: string; subtitle?: string }; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const q = preview ? "?preview=1" : "";
  const top = nav.filter((n) => !n.parentId || !nav.some((p) => p.id === n.parentId));
  const children_ = (id: string) => nav.filter((n) => n.parentId === id);
  const Item = ({ n, depth }: { n: NavItem; depth: number }) => {
    const I = PAGE_ICONS[n.icon ?? "dashboard"] ?? LayoutDashboard;
    return (
      <>
        <Link href={`/a/${app.slug}/${n.slug}${q}`} className="ap-nav-item" aria-current={n.id === currentPageId ? "page" : undefined} style={{ paddingLeft: 12 + depth * 18 }} onClick={() => setOpen(false)}>
          <I size={19} strokeWidth={1.8} />{n.title}
        </Link>
        {children_(n.id).map((c) => <Item key={c.id} n={c} depth={depth + 1} />)}
      </>
    );
  };
  return (
    <div className="ap-root">
      {preview && <div className="ap-preview-bar" role="status"><Eye size={15} /> Previewing the unpublished draft. <Link href={`/builder/${app.id}`}>Back to builder</Link></div>}
      <div className="ap-frame">
        <aside className={`ap-side ${open ? "open" : ""}`} aria-label="App navigation">
          <div className="ap-brand"><span className="ap-logo" aria-hidden><Grid2x2 size={18} /></span><span>Bang On OS</span><button type="button" className="ap-icon-btn ap-only-mobile" aria-label="Close menu" onClick={() => setOpen(false)}><X size={18} /></button></div>
          <div className="ap-appcard"><span className="ap-appcard-ic" aria-hidden><LayoutDashboard size={16} /></span><span className="ap-strong" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{app.name}</span><span className="ap-badge">{app.audience === "portal" ? "Portal" : version}</span></div>
          <nav className="ap-nav" aria-label="App pages">{top.map((n) => <Item key={n.id} n={n} depth={0} />)}</nav>
          {canBuild && (
            <div className="ap-buildcard">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Sparkles size={18} color="var(--color-accent)" /><strong>Build your own app</strong></div>
              <p>Create, customise and launch any operating system.</p>
              <Link href={`/builder/${app.id}`} className="ap-outline-btn">Go to Builder →</Link>
            </div>
          )}
        </aside>
        <div className="ap-main">
          <header className="ap-top">
            <button type="button" className="ap-icon-btn ap-only-mobile" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={20} /></button>
            {apps.length > 1 ? (
              <DropdownMenu menuWidth={220} items={apps.map((a) => ({ label: a.name, href: `/a/${a.slug}` }))}
                renderTrigger={(t) => <button type="button" {...t} className="ap-switch">{app.name}<ChevronDown size={15} /></button>} />
            ) : <span className="ap-switch" style={{ cursor: "default" }}>{app.name}</span>}
            <span className="ap-sep" aria-hidden />
            <span className="ap-strong ap-crumb">{header.title}</span>
            <span style={{ flex: 1 }} />
            <ThemeToggle />
            {user.role !== "portal" && <Link href="/" className="ap-top-link">Workspace</Link>}
            <DropdownMenu menuWidth={200} items={[{ label: `${user.name} · ${user.role}`, isDisabled: true }, ...(user.role !== "portal" ? [{ label: "Settings", icon: <Settings size={14} />, href: "/workspace/settings" }, { label: "Search  ⌘K", icon: <Search size={14} />, onClick: () => openCommandPalette() }] : []), { label: "Sign out", icon: <LogOut size={14} />, onClick: () => logoutAction() }]}
              renderTrigger={(t) => <button type="button" {...t} className="ap-avatar-btn" aria-label="Account"><Avatar name={user.name} size="sm" /></button>} />
          </header>
          <main className="ap-content" id="main">
            <div className="ap-page-head"><h1>{header.heading || header.title}</h1>{header.subtitle && <p>{header.subtitle}</p>}</div>
            {children}
          </main>
        </div>
      </div>
      {open && <div className="ap-scrim" onClick={() => setOpen(false)} aria-hidden />}
      {user.role !== "portal" && <CommandPalette />}
    </div>
  );
}
