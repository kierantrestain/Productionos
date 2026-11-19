"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { Sparkles } from "lucide-react";
import { aiBuildBaseAction, aiCreateFromSpecAction, aiStatusAction } from "@/app/platform-actions";
import type { BaseSpec } from "@/server/platform/spec";

const IDEAS = [
  "A content studio: episodes, guests, shoot days and sponsor deliverables with a kanban by stage",
  "A sales CRM for an agency: companies, contacts, deals with value and stage, and activities",
  "Event production: venues, suppliers, run-of-show items and a budget with actuals",
  "Hiring pipeline: roles, candidates, interviews with scores and offer status",
];

type Summary = { name: string; tables: { name: string; fields: string[]; rows: number }[] };

/** Describe a system → Claude designs tables, fields, links and example rows → preview → build. */
export function AiBuilderDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<{ spec: BaseSpec; summary: Summary } | null>(null);
  useEffect(() => { if (isOpen && configured === null) aiStatusAction().then((s) => setConfigured(s.configured)); }, [isOpen, configured]);
  const close = () => { setPreview(null); setErr(""); onClose(); };

  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => !o && close()} width={640} padding={6} purpose="form">
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, display: "flex", gap: 8, alignItems: "center" }}><Sparkles size={18} /> Build with AI</h2>
      {configured === false ? (
        <p style={{ color: "var(--color-text-secondary)" }}>AI isn&apos;t configured for this workspace yet. An administrator needs to add an <code>ANTHROPIC_API_KEY</code> to the deployment environment. Nothing else is affected — templates, import and manual building all still work.</p>
      ) : !preview ? (
        <>
          <p style={{ color: "var(--color-text-secondary)", marginBottom: 12 }}>Describe the system you want to run. Claude designs the tables, fields, relationships, views and a few clearly-fictional example rows. You review it before anything is created.</p>
          <textarea className="p-textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. A post-production tracker for a documentary series…" aria-label="Describe your base" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {IDEAS.map((i) => <button key={i} type="button" className="p-idea" onClick={() => setText(i)}>{i}</button>)}
          </div>
        </>
      ) : (
        <>
          <p style={{ color: "var(--color-text-secondary)", marginBottom: 12 }}><strong style={{ color: "var(--color-text-primary)" }}>{preview.summary.name}</strong> — {preview.summary.tables.length} tables. Example rows are fictional and can be deleted.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, maxHeight: 340, overflow: "auto" }}>
            {preview.summary.tables.map((t) => (
              <div key={t.name} className="p-basecard" style={{ display: "block", padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{t.name} <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}>· {t.rows} rows</span></div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--color-text-secondary)" }}>{t.fields.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            ))}
          </div>
        </>
      )}
      {err && <p style={{ color: "var(--color-text-error)", marginTop: 12 }}>{err}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        {preview && <Button label="Start over" onClick={() => setPreview(null)} />}
        <Button label="Cancel" onClick={close} />
        {configured !== false && !preview && <Button label="Design it" variant="primary" isDisabled={text.trim().length < 8} clickAction={async () => {
          setErr(""); const r = await aiBuildBaseAction(text, true);
          if (!r.ok) { setErr(r.error); return; }
          setPreview({ spec: r.data.spec, summary: r.data.summary });
        }} />}
        {preview && <Button label="Create base" variant="primary" clickAction={async () => {
          const r = await aiCreateFromSpecAction(preview.spec);
          if (!r.ok) { setErr(r.error); return; }
          close(); router.push(`/base/${r.data.baseId}`); router.refresh();
        }} />}
      </div>
    </Dialog>
  );
}
