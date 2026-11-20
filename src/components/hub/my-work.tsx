"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { markMentionsSeen } from "./rail";
import { morningBriefingAction } from "@/app/hub-actions";
import { AlertTriangle, AtSign, Sparkles, CalendarClock, CheckCircle2, Clock, Inbox, ShieldCheck, UserRound } from "lucide-react";
import type { WorkItem } from "@/server/hub/hub";
import { HEAD_BG } from "@/components/platform/base-header";

type Mention = { id: string; baseId: string; baseName: string; color: string; tableId: string; tableName: string; recordId: string; record: string; author: string; body: string; createdAt: string };
type Data = { items: WorkItem[]; mentions: Mention[]; counts: Record<"overdue" | "today" | "soon" | "assigned" | "approvals" | "mentions", number>; approvals: { id: string; baseId: string; baseName: string; summary: string; kind: string; source: string; createdAt: string }[]; recentBases: { id: string; name: string; color: string }[]; scannedTables: number };
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
  useEffect(() => { markMentionsSeen(); }, []);
  return (
    <div className="mw">
      <header className="mw-head">
        <Briefing />
        <div><h1>{greet()}, {name}</h1><p>{c.overdue + c.today + c.approvals ? `${c.overdue} overdue, ${c.today} due today and ${c.approvals} approval${c.approvals === 1 ? "" : "s"} waiting on you.` : "Nothing urgent. Here's what's coming up."}{c.mentions ? ` ${c.mentions} mention${c.mentions === 1 ? "" : "s"} in the last 30 days.` : ""}</p></div>
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
          <section aria-label="Mentions" className="mw-card">
            <h2><AtSign size={15} />Mentions</h2>
            {!data.mentions.length && <p className="mw-muted">When someone @mentions you in a record comment, it shows up here.</p>}
            <ul>{data.mentions.slice(0, 8).map((m) => <li key={m.id}><Link href={`/base/${m.baseId}/${m.tableId}?record=${m.recordId}`}><strong>{m.author} on “{m.record}”</strong><span className="mw-quote">{m.body}</span><span>{m.tableName} · {m.baseName} · {new Date(m.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></Link></li>)}</ul>
          </section>
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

/** "Brief me": an AI summary of this page's facts, cached for the day in this browser. */
function Briefing() {
  const key = `bangon:briefing:${new Date().toDateString()}`;
  const [b, setB] = useState<{ text: string; at: string } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { try { const c = sessionStorage.getItem(key); if (c) setB(JSON.parse(c)); } catch { /* ignore */ } }, [key]);
  const run = async () => { setBusy(true); setErr(""); const r = await morningBriefingAction(); setBusy(false); if (!r.ok) { setErr(r.error); return; } setB(r.data); try { sessionStorage.setItem(key, JSON.stringify(r.data)); } catch { /* ignore */ } };
  return (
    <div className="mw-brief">
      <button type="button" className="p-tbtn on-blue" onClick={run} disabled={busy}><Sparkles size={14} />{busy ? "Writing your briefing…" : b ? "Refresh briefing" : "Brief me"}</button>
      {err && <p role="alert" className="mw-muted" style={{ marginTop: 8 }}>{err}</p>}
      {b && <div className="mw-card" style={{ marginTop: 10 }} aria-label="Morning briefing" role="region"><pre className="mw-brief-text">{b.text}</pre><p className="mw-muted" style={{ fontSize: 11 }}>Written by AI from your My work items at {new Date(b.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Check before acting.</p></div>}
    </div>
  );
}
