"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Building2, KeyRound, Keyboard, Palette, Plug, ScrollText, ShieldCheck, SlidersHorizontal, UserRound, Users, Code2 } from "lucide-react";

type Item = { href: string; label: string; icon: React.ComponentType<{ size?: number }>; tab?: string; show: boolean };
/** One Settings area for everything personal and workspace-wide, with a single navigation. */
export function SettingsFrame({ role, orgName, children }: { role: string; orgName: string; children: React.ReactNode }) {
  const path = usePathname(); const params = useSearchParams();
  const owner = role === "owner"; const manager = owner || role === "creator";
  const tab = params.get("tab") ?? "profile";
  const groups: [string, Item[]][] = [
    ["Your account", [
      { href: "/workspace/settings?tab=profile", tab: "profile", label: "Profile", icon: UserRound, show: true },
      { href: "/workspace/settings?tab=security", tab: "security", label: "Password & sign-in", icon: KeyRound, show: true },
      { href: "/workspace/settings?tab=appearance", tab: "appearance", label: "Appearance", icon: Palette, show: true },
      { href: "/workspace/settings?tab=shortcuts", tab: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard, show: true },
      { href: "/workspace/settings?tab=apps", tab: "apps", label: "Connected apps", icon: Plug, show: true },
    ]],
    [orgName, [
      { href: "/workspace/members", label: "Members & roles", icon: Users, show: manager },
      { href: "/workspace/security", label: "Security & single sign-on", icon: ShieldCheck, show: owner },
      { href: "/workspace/api", label: "API & access tokens", icon: Code2, show: manager },
      { href: "/workspace/audit", label: "Audit log", icon: ScrollText, show: owner },
      { href: "/workspace/settings?tab=integrations", tab: "integrations", label: "Integrations & status", icon: SlidersHorizontal, show: owner },
      { href: "/workspace/settings?tab=workspace", tab: "workspace", label: "About this workspace", icon: Building2, show: true },
    ]],
  ];
  const isActive = (i: Item) => i.tab ? path === "/workspace/settings" && tab === i.tab : path.startsWith(i.href);
  return (
    <div className="st">
      <h1>Settings</h1>
      <div className="st-grid">
        <nav className="st-nav" aria-label="Settings sections">
          {groups.map(([g, items]) => { const vis = items.filter((i) => i.show); return vis.length ? <div key={g} className="st-group"><div className="st-gl">{g}</div>
            {vis.map((i) => <Link key={i.href} href={i.href} aria-current={isActive(i) ? "page" : undefined}><i.icon size={16} />{i.label}</Link>)}</div> : null; })}
        </nav>
        <div className="st-body">{children}</div>
      </div>
    </div>
  );
}
