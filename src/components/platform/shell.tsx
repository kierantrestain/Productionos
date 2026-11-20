"use client";
import { usePathname } from "next/navigation";
import { AppShell } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Avatar } from "@astryxdesign/core/Avatar";
import { AppWindow, Clapperboard, Home, Inbox, LayoutTemplate, LogOut, ScrollText, Search, Settings, ShieldCheck, Users } from "lucide-react";
import { CommandPalette, openCommandPalette } from "@/components/hub/command-palette";
import { useAttentionCount } from "@/components/hub/rail";
import { BaseIcon } from "./icons";
import { HEAD_BG } from "./base-header";
import { logoutAction, switchOrgAction } from "@/app/actions";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Assistant } from "@/components/hub/assistant";

export function PlatformShell({ user, org, orgs, bases = [], apps = [], children }: { user: { name: string; email: string; role: string }; org: { id: string; name: string; isDemo: boolean }; orgs: { id: string; name: string; isDemo: boolean }[]; bases?: { id: string; name: string; color: string; icon: string }[]; apps?: { id: string; name: string; href: string }[]; children: React.ReactNode }) {
  const path = usePathname();
  const attention = useAttentionCount();
  const isAdmin = user.role === "owner";
  return (
    <div className="p-root">
      <AppShell variant="elevated" contentPadding={0}
        sideNav={
          <SideNav collapsible
            header={<SideNavHeading heading={org.name} subheading={org.isDemo ? "Demo workspace" : "Workspace"} icon={<span className="p-tile p-c-red" style={{ width: 28, height: 28, borderRadius: 8, fontWeight: 800, fontSize: 13 }}>B</span>}
              menu={orgs.length > 1 ? <div style={{ display: "grid", gap: 4, minWidth: 220 }}>{orgs.map((o) => <button key={o.id} className="p-viewitem" onClick={() => switchOrgAction(o.id)} aria-current={o.id === org.id ? "page" : undefined}>{o.name}{o.isDemo ? " (demo)" : ""}</button>)}</div> : undefined} />}
            footer={<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px" }}>
              <Avatar name={user.name} size="sm" />
              <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</div><div style={{ fontSize: 11, color: "var(--color-text-secondary)", textTransform: "capitalize" }}>{user.role}</div></div>
              <ThemeToggle />
              <form action={logoutAction}><button className="p-tbtn" aria-label="Sign out" title="Sign out"><LogOut size={15} /></button></form>
            </div>}>
            <SideNavSection title="Workspace" isHeaderHidden>
              <SideNavItem label="Home" href="/" icon={Home} isSelected={path === "/"} />
              <SideNavItem label="My work" href="/my-work" icon={Inbox} isSelected={path.startsWith("/my-work")} endContent={attention ? <span className="ws-count" aria-label={`${attention} need attention`}>{attention}</span> : undefined} />
              <SideNavItem label="Search" icon={Search} onClick={() => openCommandPalette()} endContent={<kbd className="ws-kbd">⌘K</kbd>} />
              <SideNavItem label="Templates" href="/templates" icon={LayoutTemplate} isSelected={path === "/templates"} />
            </SideNavSection>
            {bases.length > 0 && <SideNavSection title="Bases">
              {bases.slice(0, 12).map((b) => <SideNavItem key={b.id} label={b.name} href={`/base/${b.id}`} icon={() => <span className="ws-dot" style={{ background: HEAD_BG[b.color] ?? HEAD_BG.blue }}><BaseIcon name={b.icon} size={11} /></span>} />)}
            </SideNavSection>}
            {apps.length > 0 && <SideNavSection title="Apps">
              {apps.slice(0, 10).map((a) => <SideNavItem key={a.id} label={a.name} href={a.href} icon={AppWindow} />)}
            </SideNavSection>}
            <SideNavSection title="Workspace">
              <SideNavItem label="Production Suite" href="/production" icon={Clapperboard} />
              <SideNavItem label="Settings" href="/workspace/settings" icon={Settings} isSelected={path.startsWith("/workspace")} />
            </SideNavSection>
          </SideNav>
        }>
        {children}
      </AppShell>
      <CommandPalette />
      <Assistant />
    </div>
  );
}
