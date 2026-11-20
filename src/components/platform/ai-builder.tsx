"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@/components/ui/modal";
import { Sparkles, Table2, LayoutDashboard, Zap, AlertTriangle } from "lucide-react";
import { aiStatusAction } from "@/app/platform-actions";
import { applyPlanAction, planSystemAction } from "@/app/apps-actions";
import type { Plan } from "@/server/apps/ai-plan";

const IDEAS = [
  "A creative agency OS: clients, contacts, deals with stages and value, projects, tasks and invoices, with a sales dashboard",
  "A production company OS: productions, episodes, shoot days, crew bookings and budgets with a producer dashboard",
  "A coaching business: programmes, clients, sessions, payments and renewals with a client success dashboard",
  "An events company: events, venues, suppliers, run-of-show and budget vs actuals",
];

/** Describe → Claude plans the whole system (data + pages + automations) → review/revise → approve → built & published. */
export function AiBuilderDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [text, setText] = useState(""); const [change, setChange] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null); const [problems, setProblems] = useState<string[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { if (isOpen && configured === null) aiStatusAction().then((s) => setConfigured(s.configured)); }, [isOpen, configured]);
  const close = () => { setPlan(null); setErr(""); setChange(""); onClose(); };
  const run = async (prev?: Plan, ch?: string) => {
    setErr("");
    const r = await planSystemAction(text, prev, ch);
    if (!r.ok) { setErr(r.error); return; }
    setPlan(r.data.plan); setProblems(r.data.problems); setChange("");
  };
  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => !o && close()} width={860} padding={6} purpose="form">
      <div style={{ display: "block", flex: "none" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, display: "flex", gap: 8, alignItems: "center" }}><Sparkles size={18} /> Build a system with AI</h2>
        {configured === false ? (
          <p style={{ color: "var(--color-text-secondary)" }}>AI isn&apos;t configured for this workspace yet: an administrator needs to add <code>ANTHROPIC_API_KEY</code> to the deployment. Templates, import and the visual builder all work without it.</p>
        ) : !plan ? (
          <>
            <p style={{ color: "var(--color-text-secondary)", marginBottom: 12 }}>Describe the business system. Claude plans the data model, the app&apos;s pages and dashboards, and automations. You review and can ask for changes; nothing is created until you approve. Automations are created switched off.</p>
            <textarea className="p-textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. A post-production tracker for a documentary series…" aria-label="Describe your system" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>{IDEAS.map((i) => <button key={i} type="button" className="p-idea" onClick={() => setText(i)}>{i}</button>)}</div>
          </>
        ) : (
          <>
            <p style={{ marginBottom: 10 }}><strong>{plan.name}</strong> — {plan.summary}</p>
            {problems.length > 0 && <div role="alert" style={{ display: "flex", gap: 8, color: "var(--color-text-orange)", fontSize: 13, marginBottom: 10 }}><AlertTriangle size={16} /> {problems.length} issue(s) to fix before building: {problems.slice(0, 3).join(" ")} — ask for a revision.</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, maxHeight: 380, overflow: "auto" }}>
              <section className="p-basecard" style={{ display: "block", padding: 12 }} aria-label="Data model"><div className="t" style={{ display: "flex", gap: 6 }}><Table2 size={15} />Data · {plan.tables.length} tables</div>
                {plan.tables.map((t) => <div key={t.name} style={{ marginTop: 8, fontSize: 12 }}><strong>{t.name}</strong> <span className="ap-muted">({t.sampleRows.length} example rows)</span><div className="ap-muted">{t.fields.map((f) => `${f.name}${f.type === "link" ? ` → ${f.linkTo}` : ""}`).join(" · ")}</div></div>)}</section>
              <section className="p-basecard" style={{ display: "block", padding: 12 }} aria-label="Pages"><div className="t" style={{ display: "flex", gap: 6 }}><LayoutDashboard size={15} />App · {plan.pages.length} pages</div>
                {plan.pages.map((p) => <div key={p.key} style={{ marginTop: 8, fontSize: 12 }}><strong>{p.title}</strong>{p.kind === "detail" && <span className="ap-muted"> (detail of {p.table})</span>}<div className="ap-muted">{p.components.map((c) => c.title || c.type).join(" · ")}</div></div>)}</section>
              <section className="p-basecard" style={{ display: "block", padding: 12 }} aria-label="Automations"><div className="t" style={{ display: "flex", gap: 6 }}><Zap size={15} />Automations · {plan.automations.length} (off)</div>
                {plan.automations.map((a) => <div key={a.name} style={{ marginTop: 8, fontSize: 12 }}><strong>{a.name}</strong><div className="ap-muted">When a {a.table} record is {a.when === "record_created" ? "created" : "updated"} → {a.action === "create_record" ? `create in ${a.createIn}` : "comment"}</div></div>)}
                {!plan.automations.length && <p className="ap-muted" style={{ fontSize: 12 }}>None proposed.</p>}</section>
            </div>
            <label style={{ display: "grid", gap: 4, marginTop: 12 }}><span style={{ fontSize: 12, fontWeight: 600 }}>Ask for changes</span>
              <textarea className="p-textarea" rows={2} value={change} onChange={(e) => setChange(e.target.value)} placeholder="e.g. Add a Suppliers table linked to Projects, and a page for overdue invoices" /></label>
          </>
        )}
        {err && <p role="alert" style={{ color: "var(--color-text-error)", marginTop: 12 }}>{err}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          {plan && <Button label="Start over" onClick={() => setPlan(null)} />}
          <Button label="Cancel" onClick={close} />
          {configured !== false && !plan && <Button label="Plan it" variant="primary" isDisabled={text.trim().length < 8} clickAction={() => run()} />}
          {plan && <Button label="Revise" isDisabled={!change.trim()} clickAction={() => run(plan, change)} />}
          {plan && <Button label="Approve & build" variant="primary" isDisabled={problems.length > 0} clickAction={async () => { const r = await applyPlanAction(plan); if (!r.ok) { setErr(r.error); return; } close(); router.push(`/a/${r.data.slug}`); }} />}
        </div>
      </div>
    </Dialog>
  );
}
