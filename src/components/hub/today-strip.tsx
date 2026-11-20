"use client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Clock, ShieldCheck } from "lucide-react";
import { useWorkCounts } from "./rail";

/** Home's "needs you today" strip — loads after the page so Home stays instant. */
export function TodayStrip() {
  const c = useWorkCounts();
  if (!c) return <div className="ts ts-loading" aria-busy="true"><span className="skeleton" style={{ width: 260 }} /></div>;
  const urgent = c.overdue + c.today + c.approvals;
  return (
    <Link href="/my-work" className={`ts ${urgent ? "urgent" : ""}`}>
      <strong>{urgent ? "Needs you today" : "You're on top of things"}</strong>
      <span><AlertTriangle size={14} />{c.overdue} overdue</span>
      <span><Clock size={14} />{c.today} due today · {c.soon} this week</span>
      <span><ShieldCheck size={14} />{c.approvals} approval{c.approvals === 1 ? "" : "s"}</span>
      <em>Open My work <ArrowRight size={14} /></em>
    </Link>
  );
}
