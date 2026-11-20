"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Inbox, ShieldCheck, UserRound } from "lucide-react";
import type { WorkItem } from "@/server/hub/hub";
import { HEAD_BG } from "@/components/platform/base-header";

type Data = { items: WorkItem[]; counts: Record<"overdue" | "today" | "soon" | "assigned" | "approvals", number>; approvals: { id: string; baseId: string; baseName: string; summary: string; kind: string; source: string; createdAt: string }[]; recentBases: { id: string; name: string; color: string }[]; scannedTables: number };
const fmt = (d?: string) => d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";
const greet = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const TABS = [
  { key: "focus", label: "Focus", icon: AlertTriangle, match: (i: WorkItem) => i.reason === "overdue" || i.reason === "today" },
  { key: "soon", label: "This week", icon: CalendarClock, match: (i: WorkItem) => i.reason === "soon" },
  { key: "assigned", label: "Assigned to me", icon: UserRound, match: (i: WorkItem) => i.reason === "assigned" },
  { key: "all", label: "Everything", icon: Inbox, match: () => true },
] as const;

/** The daily command centre: what needs me, across every base, in priority order. */
export function MyWorkView({ name, data }: { name: string; data: Data }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>(data.counts.overdue + data.counts.today ? "focus" : data.counts.soon ? "soon" : "all");
  const list = useMemo(() => data.items.filter(TABS.find((t) => t.key === tab)!.match), [data.items, tab]);
  const groups = useMemo(() => { const m = new Map<string, WorkItem[]>(); for (const i of list) { const k = `${i.baseName} › ${i.tableName}`; m.set(k, [...(m.get(k) ?? []), i]); } return [...m.entries()]; }, [list]);
  const c = data.counts;
  return (
    <div className="mw">
      <header className="mw-head">
        <div><h1>{greet()}, {name}</h1><p>{c.overdue + c.today + c.approvals ? `${c.overdue} overdue, ${c.today} due today and ${c.approvals} approval${c.approvals === 1 ? "" : "s"} waiting on you.` : "Nothing urgent. Here's what's coming up."}</p></div>
      </header>
      <div className="mw-stats">
        <Stat icon={<AlertTriangle size={18} />} tone="red" label="Overdue" n={c.overdue} onClick={() => setTab("focus")} />
        <Stat icon={<Clock size={18} />} tone="amber" label="Due today" n={c.today} onClick={() => setTab("focus")} />
        <Stat icon={<CalendarClock size={18} />} tone="blue" label="Due this week" n={c.soon} onClick={() => setTab("soon")} />
        <Stat icon={<UserRound size={18} />} tone="violet" label="Assigned to me" n={c.assigned} onClick={() => setTab("assigned")} />
        <Stat icon={<ShieldCheck size={18} />} tone="green" label="Approvals" n={c.approvals} href="#approvals" />
      </div>
      <div className="mw-cols">
        <section className="mw-main" aria-label="Work items">
          <div className="mw-tabs" role="tablist" aria-label="Filter">
            {TABS.map((t) => { const n = data.items.filter(t.match).length; return <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}><t.icon size={14} />{t.label}<span>{n}</span></button>; })}
          </div>
          {!groups.length && <div className="mw-empty"><CheckCircle2 size={28} /><strong>All clear</strong><span>{data.scannedTables ? "Nothing here. Items appear when records have a due date or are assigned to you with a person field." : "Your bases have no person or due-date fields yet. Add an “Assignee” (person) or “Due date” field to any table and its records show up here."}</span></div>}
          {groups.map(([g, items]) => (
            <div key={g} className="mw-group">
              <h2><span className="ws-dot" style={{ background: HEAD_BG[items[0].color] ?? HEAD_BG.blue, width: 10, height: 10 }} />{g}<small>{items.length}</small></h2>
              <ul>
                {items.map((i) => (
                  <li key={i.recordId}>
                    <Link href={`/base/${i.baseId}/${i.tableId}?record=${i.recordId}`} className="mw-item">
                      <span className={`mw-flag ${i.reason}`} aria-hidden />
                      <span className="mw-title">{i.title}</span>
                      {i.status && <span className="mw-status">{i.status}</span>}
                      {i.due && <span className={`mw-due ${i.reason}`}>{i.reason === "overdue" ? "Overdue · " : i.reason === "today" ? "Today · " : ""}{fmt(i.due)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
        <aside className="mw-side">
          <section id="approvals" aria-label="Approvals waiting on you" className="mw-card">
            <h2><ShieldCheck size={15} />Waiting for your approval</h2>
            {!data.approvals.length && <p className="mw-muted">No pending approvals. Agent and automation actions that leave the workspace wait here for a person to approve.</p>}
            <ul>{data.approvals.map((a) => <li key={a.id}><Link href={`/base/${a.baseId}/automations`}><strong>{a.summary}</strong><span>{a.baseName} · {a.source} · {new Date(a.createdAt).toLocaleDateString("en-GB")}</span></Link></li>)}</ul>
          </section>
          <section aria-label="Jump back in" className="mw-card">
            <h2>Jump back in</h2>
            <ul>{data.recentBases.map((b) => <li key={b.id}><Link href={`/base/${b.id}`} className="mw-base"><span className="ws-dot" style={{ background: HEAD_BG[b.color] ?? HEAD_BG.blue }} />{b.name}</Link></li>)}</ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Stat({ icon, label, n, tone, onClick, href }: { icon: React.ReactNode; label: string; n: number; tone: string; onClick?: () => void; href?: string }) {
  const body = <><span className={`mw-stat-ic ${tone}`}>{icon}</span><span><strong>{n}</strong><small>{label}</small></span></>;
  return href ? <a href={href} className="mw-stat">{body}</a> : <button type="button" className="mw-stat" onClick={onClick}>{body}</button>;
}
