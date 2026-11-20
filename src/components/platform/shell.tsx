"use client";
import { usePathname } from "next/navigation";
import { AppShell } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Clapperboard, Home, LayoutTemplate, LogOut, Settings, ShieldCheck, Users } from "lucide-react";
import { logoutAction, switchOrgAction } from "@/app/actions";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export function PlatformShell({ user, org, orgs, children }: { user: { name: string; email: string; role: string }; org: { id: string; name: string; isDemo: boolean }; orgs: { id: string; name: string; isDemo: boolean }[]; children: React.ReactNode }) {
  const path = usePathname();
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
              <SideNavItem label="Templates" href="/templates" icon={LayoutTemplate} isSelected={path === "/templates"} />
            </SideNavSection>
            <SideNavSection title="Administration">
              <SideNavItem label="Members & roles" href="/workspace/members" icon={Users} isSelected={path.startsWith("/workspace/members")} />
              {isAdmin && <SideNavItem label="Security & SSO" href="/workspace/security" icon={ShieldCheck} isSelected={path.startsWith("/workspace/security")} />}
              {isAdmin && <SideNavItem label="Audit log" href="/workspace/audit" icon={Settings} isSelected={path.startsWith("/workspace/audit")} />}
            </SideNavSection>
            <SideNavSection title="Apps">
              <SideNavItem label="Production Suite" href="/production" icon={Clapperboard} />
            </SideNavSection>
          </SideNav>
        }>
        {children}
      </AppShell>
    </div>
  );
}
