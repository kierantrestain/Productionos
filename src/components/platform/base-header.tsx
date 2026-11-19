"use client";
import Link from "next/link";
import { Home } from "lucide-react";
import { BaseIcon } from "./icons";

export const HEAD_BG: Record<string, string> = { blue: "#1f6feb", cyan: "#0891b2", teal: "#0d9488", green: "#15803d", yellow: "#b45309", orange: "#c2410c", red: "#be123c", pink: "#be185d", purple: "#7c3aed", gray: "#475569" };
export type BaseTab = "data" | "interfaces" | "automations" | "sync" | "access";

/** Coloured base header shared by Data, Interfaces, Automations, Sync and Access pages. */
export function BaseHeader({ base, role, active, nameSlot }: { base: { id: string; name: string; color: string; icon: string }; role: string; active: BaseTab; nameSlot?: React.ReactNode }) {
  const tabs: [BaseTab, string, string][] = [["data", "Data", `/base/${base.id}`], ["interfaces", "Interfaces", `/base/${base.id}/interfaces`], ["automations", "Automations", `/base/${base.id}/automations`], ["sync", "Sync", `/base/${base.id}/sync`], ["access", "Access", `/base/${base.id}/access`]];
  return (
    <header className="p-head" style={{ background: HEAD_BG[base.color] ?? HEAD_BG.blue }}>
      <Link href="/" aria-label="All bases" className="p-ghost" style={{ display: "inline-flex", padding: 6, borderRadius: 6 }}><Home size={18} /></Link>
      <span style={{ display: "inline-grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,.18)" }}><BaseIcon name={base.icon} size={18} /></span>
      {nameSlot ?? <span className="p-name">{base.name}</span>}
      <nav aria-label="Base sections" style={{ display: "flex", gap: 2, overflowX: "auto" }}>
        {tabs.map(([k, label, href]) => <Link key={k} href={href} className="p-headtab" aria-current={k === active ? "page" : undefined}>{label}</Link>)}
      </nav>
      <span style={{ flex: 1 }} />
      <span className="chip" style={{ background: "rgba(255,255,255,.18)", color: "#fff" }} title="Your access to this base">{role}{role === "commenter" || role === "reader" ? " · free seat" : ""}</span>
    </header>
  );
}
