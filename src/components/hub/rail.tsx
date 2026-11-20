"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Grid2x2, Home, Inbox, LayoutTemplate, Search, Settings } from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { myWorkCountsAction } from "@/app/hub-actions";
import { openCommandPalette, CommandPalette } from "./command-palette";

type Counts = { overdue: number; today: number; soon: number; assigned: number; approvals: number };
let inflight: Promise<Counts | null> | null = null;
/** My-work counts, shared by the sidebar badge and Home, cached for a minute so navigation stays instant. */
export function useWorkCounts() {
  const [c, setC] = useState<Counts | null>(null);
  useEffect(() => {
    let cached: { at: number; c: Counts } | null = null;
    try { cached = JSON.parse(sessionStorage.getItem("bangon:work") ?? "null"); } catch { /* storage blocked */ }
    if (cached && Date.now() - cached.at < 60_000) { setC(cached.c); return; }
    inflight ??= myWorkCountsAction().then((r) => { inflight = null; if (!r.ok) return null; try { sessionStorage.setItem("bangon:work", JSON.stringify({ at: Date.now(), c: r.data })); } catch { /* ignore */ } return r.data; });
    inflight.then((v) => v && setC(v));
  }, []);
  return c;
}
export function useAttentionCount() { const c = useWorkCounts(); return c ? c.overdue + c.today + c.approvals : null; }

/** Slim workspace rail shown beside full-screen base pages: the same destinations everywhere. */
export function WorkspaceRail({ userName }: { userName: string }) {
  const path = usePathname();
  const n = useAttentionCount();
  const item = (href: string, label: string, icon: React.ReactNode, active: boolean, badge?: number | null) => (
    <Link href={href} className="ws-rail-btn" aria-label={label} title={label} aria-current={active ? "page" : undefined}>{icon}{!!badge && <span className="ws-badge" aria-label={`${badge} need attention`}>{badge > 99 ? "99+" : badge}</span>}<span className="ws-rail-l">{label}</span></Link>
  );
  return (
    <nav className="ws-rail" aria-label="Workspace">
      <Link href="/" className="ws-rail-logo" aria-label="Bang On OS home" title="Bang On OS"><Grid2x2 size={18} /></Link>
      {item("/", "Home", <Home size={19} />, path === "/")}
      {item("/my-work", "My work", <Inbox size={19} />, path.startsWith("/my-work"), n)}
      <button type="button" className="ws-rail-btn" aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)" onClick={openCommandPalette}><Search size={19} /><span className="ws-rail-l">Search</span></button>
      {item("/templates", "Templates", <LayoutTemplate size={19} />, path.startsWith("/templates"))}
      <span className="ws-rail-gap" />
      <ThemeToggle className="ws-rail-btn ws-rail-hide-m" />
      {item("/workspace/settings", "Settings", <Settings size={19} />, path.startsWith("/workspace/settings"))}
      <span className="ws-rail-me ws-rail-hide-m" title={userName} aria-hidden>{userName.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase()}</span>
      <CommandPalette />
    </nav>
  );
}
