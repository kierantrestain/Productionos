"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@astryxdesign/core/Dialog";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Zap, Plus, Trash2, Pencil, History } from "lucide-react";
import { isComputed } from "@/lib/platform/fields";
import { automationRunsAction, deleteAutomationAction, saveAutomationAction } from "@/app/platform-actions";
import type { Action, Trigger } from "@/server/platform/automations";
import type { BaseMeta } from "@/app/(base)/base/[baseId]/load";
import { BaseHeader } from "./base-header";
import { ConditionList } from "./toolbar";
import type { ClientField } from "./types";

type Auto = { id: string; name: string; isEnabled: boolean; trigger: Trigger; actions: Action[]; lastRunAt: string | null; runCount: number; failCount: number };
const inp: React.CSSProperties = { width: "100%", height: 34, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-background-surface)", color: "var(--color-text-primary)", font: "inherit", padding: "0 8px" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", margin: "12px 0 4px" };
const TRIGGERS: Record<Trigger["type"], string> = { record_created: "When a record is created", record_updated: "When a record is updated", record_matches: "When a record is created or updated and matches conditions" };

export function AutomationsApp({ meta, automations }: { meta: BaseMeta; automations: Auto[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<Auto | null>(null);
  const [runs, setRuns] = useState<{ auto: Auto; rows: { id: string; status: string; result: unknown; error: string | null; at: string }[] } | null>(null);
  const [err, setErr] = useState("");
  const tableName = (id: string) => meta.tables.find((t) => t.id === id)?.name ?? "a deleted table";
  const toggle = async (a: Auto) => { const r = await saveAutomationAction(meta.base.id, { ...a, isEnabled: !a.isEnabled }); if (!r.ok) setErr(r.error); router.refresh(); };
  return (
    <div className="p-base">
      <BaseHeader base={meta.base} role={meta.role} active="automations" />
      <main style={{ flex: 1, overflow: "auto", background: "var(--color-background-muted)", padding: 24 }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700 }}>Automations</h1>
              <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>Internal actions only — update records, create linked records, add comments. Automations never email, charge or contact anyone, imports and syncs never trigger them, and chains stop after 3 steps.</p>
            </div>
            {meta.canEdit && <Button label="New automation" variant="primary" icon={<Plus size={16} />} onClick={() => setEdit({ id: "", name: "", isEnabled: false, trigger: { type: "record_created", tableId: meta.tables[0]?.id ?? "" }, actions: [{ type: "add_comment", body: "" }], lastRunAt: null, runCount: 0, failCount: 0 })} />}
          </div>
          {err && <p style={{ color: "var(--color-text-error)", marginBottom: 8 }}>{err}</p>}
          {!automations.length && <EmptyState title="No automations yet" description="For example: when a deal moves to Won, create an engagement linked to it; when a task is marked Done, comment on the project." />}
          <div style={{ display: "grid", gap: 10 }}>
            {automations.map((a) => (
              <article key={a.id} className="p-basecard" style={{ alignItems: "flex-start" }}>
                <span style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 8, background: a.isEnabled ? "var(--color-background-green)" : "var(--color-background-gray)" }}><Zap size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t">{a.name}</div>
                  <div className="s">{TRIGGERS[a.trigger.type]} in {tableName(a.trigger.tableId)} → {a.actions.map((x) => x.type === "update_record" ? "update it" : x.type === "create_record" ? `create a record in ${tableName(x.tableId)}` : "add a comment").join(", ")}</div>
                  <div className="s">{a.runCount} successful run{a.runCount === 1 ? "" : "s"}{a.failCount ? ` · ${a.failCount} failed` : ""}{a.lastRunAt ? ` · last ${new Date(a.lastRunAt).toLocaleString("en-GB")}` : ""}</div>
                </div>
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={a.isEnabled} disabled={!meta.canEdit} onChange={() => toggle(a)} />{a.isEnabled ? "On" : "Off"}</label>
                <button type="button" className="p-tbtn" aria-label="Run history" onClick={async () => { const r = await automationRunsAction(a.id); if (r.ok) setRuns({ auto: a, rows: r.data }); }}><History size={14} /></button>
                {meta.canEdit && <button type="button" className="p-tbtn" aria-label="Edit" onClick={() => setEdit(a)}><Pencil size={14} /></button>}
                {meta.canEdit && <button type="button" className="p-tbtn" aria-label="Delete" onClick={async () => { if (confirm(`Delete “${a.name}”?`)) { await deleteAutomationAction(a.id); router.refresh(); } }}><Trash2 size={14} /></button>}
              </article>
            ))}
          </div>
        </div>
      </main>
      {edit && <AutomationDialog meta={meta} initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); router.refresh(); }} />}
      {runs && (
        <Dialog isOpen onOpenChange={(o) => !o && setRuns(null)} width={620} padding={6} purpose="info">
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>Run history — {runs.auto.name}</h2>
          {!runs.rows.length && <p style={{ color: "var(--color-text-secondary)" }}>No runs yet.</p>}
          <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 420, overflow: "auto" }}>
            {runs.rows.map((r) => <li key={r.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--color-border)", fontSize: 13 }}>
              <span className={`chip ${r.status === "succeeded" ? "green" : r.status === "failed" ? "red" : "gray"}`}>{r.status}</span>
              <span style={{ flex: 1, overflowWrap: "anywhere" }}>{r.error ?? JSON.stringify(r.result)}</span>
              <span style={{ color: "var(--color-text-secondary)" }}>{new Date(r.at).toLocaleString("en-GB")}</span>
            </li>)}
          </ul>
        </Dialog>
      )}
    </div>
  );
}

function AutomationDialog({ meta, initial, onClose, onSaved }: { meta: BaseMeta; initial: Auto; onClose: () => void; onSaved: () => void }) {
  const [a, setA] = useState<Auto>(initial);
  const [err, setErr] = useState("");
  const fieldsOf = (tid: string): ClientField[] => meta.fields.filter((f) => f.tableId === tid).map((f) => ({ ...f, editable: true, isPrimary: meta.tables.find((t) => t.id === tid)?.primaryFieldId === f.id }));
  const tf = fieldsOf(a.trigger.tableId);
  const writable = (tid: string) => fieldsOf(tid).filter((f) => !isComputed(f.type) && !["link", "user", "attachment", "button"].includes(f.type));
  const setT = (p: Partial<Trigger>) => setA((x) => ({ ...x, trigger: { ...x.trigger, ...p } }));
  const setAct = (i: number, act: Action) => setA((x) => ({ ...x, actions: x.actions.map((y, j) => (j === i ? act : y)) }));
  const ValueRows = ({ tid, values, onChange }: { tid: string; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) => (
    <div>
      {Object.entries(values).map(([fid, v]) => { const f = fieldsOf(tid).find((x) => x.id === fid); return (
        <div key={fid} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <span className="chip" style={{ height: 34, borderRadius: 6, minWidth: 120 }}>{f?.name ?? "?"}</span>
          {f?.type === "singleSelect" ? <select aria-label={f.name} style={inp} value={String(v ?? "")} onChange={(e) => onChange({ ...values, [fid]: e.target.value })}><option value="">(clear)</option>{f.options.choices?.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
            : f?.type === "checkbox" ? <select aria-label={f.name} style={inp} value={String(!!v)} onChange={(e) => onChange({ ...values, [fid]: e.target.value === "true" })}><option value="true">Checked</option><option value="false">Unchecked</option></select>
            : <input aria-label={f?.name} style={inp} value={String(v ?? "")} placeholder="Value — use {Field name} to copy from the trigger record" onChange={(e) => onChange({ ...values, [fid]: e.target.value })} />}
          <button type="button" className="p-tbtn" aria-label="Remove" onClick={() => { const n = { ...values }; delete n[fid]; onChange(n); }}><Trash2 size={14} /></button>
        </div>
      ); })}
      <select aria-label="Add a field" style={{ ...inp, width: "auto" }} value="" onChange={(e) => e.target.value && onChange({ ...values, [e.target.value]: "" })}><option value="">+ Set a field…</option>{writable(tid).filter((f) => !(f.id in values)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
    </div>
  );
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={680} padding={6} purpose="form">
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>{a.id ? "Edit automation" : "New automation"}</h2>
      <label style={lbl} htmlFor="au-name">Name</label>
      <input id="au-name" style={inp} value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder="e.g. Won deal → create engagement" />
      <fieldset style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 12, marginTop: 14 }}>
        <legend style={{ fontWeight: 600, padding: "0 6px" }}>Trigger</legend>
        <div style={{ display: "flex", gap: 10 }}>
          <select aria-label="Trigger type" style={inp} value={a.trigger.type} onChange={(e) => setT({ type: e.target.value as Trigger["type"] })}>{Object.entries(TRIGGERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select aria-label="Trigger table" style={{ ...inp, width: 200 }} value={a.trigger.tableId} onChange={(e) => setT({ tableId: e.target.value, watchFieldIds: [], conditions: undefined })}>{meta.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </div>
        {a.trigger.type === "record_updated" && <><label style={lbl}>Only when these fields change (optional)</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{tf.filter((f) => !isComputed(f.type)).map((f) => { const on = a.trigger.watchFieldIds?.includes(f.id); return <button key={f.id} type="button" className={`chip ${on ? "blue" : ""}`} style={{ border: 0, cursor: "pointer" }} onClick={() => setT({ watchFieldIds: on ? a.trigger.watchFieldIds!.filter((x) => x !== f.id) : [...(a.trigger.watchFieldIds ?? []), f.id] })}>{f.name}</button>; })}</div></>}
        <label style={lbl}>Conditions {a.trigger.type === "record_matches" ? "" : "(optional)"}</label>
        {tf.length > 0 && <ConditionList fields={tf} conds={a.trigger.conditions?.conditions ?? []} onChange={(c) => setT({ conditions: { conjunction: a.trigger.conditions?.conjunction ?? "and", conditions: c } })} />}
        <button type="button" className="p-tbtn" onClick={() => setT({ conditions: { conjunction: "and", conditions: [...(a.trigger.conditions?.conditions ?? []), { fieldId: tf[0].id, op: "isNotEmpty" }] } })}><Plus size={14} />Add condition</button>
      </fieldset>
      {a.actions.map((act, i) => (
        <fieldset key={i} style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 12, marginTop: 12 }}>
          <legend style={{ fontWeight: 600, padding: "0 6px" }}>Action {i + 1}</legend>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select aria-label="Action type" style={inp} value={act.type} onChange={(e) => setAct(i, e.target.value === "update_record" ? { type: "update_record", values: {} } : e.target.value === "create_record" ? { type: "create_record", tableId: meta.tables[0].id, values: {} } : { type: "add_comment", body: "" })}>
              <option value="update_record">Update the trigger record</option><option value="create_record">Create a record</option><option value="add_comment">Add a comment to the trigger record</option>
            </select>
            {a.actions.length > 1 && <button type="button" className="p-tbtn" aria-label="Remove action" onClick={() => setA({ ...a, actions: a.actions.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>}
          </div>
          {act.type === "update_record" && <ValueRows tid={a.trigger.tableId} values={act.values} onChange={(v) => setAct(i, { ...act, values: v })} />}
          {act.type === "create_record" && <>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <select aria-label="Create in table" style={inp} value={act.tableId} onChange={(e) => setAct(i, { type: "create_record", tableId: e.target.value, values: {} })}>{meta.tables.map((t) => <option key={t.id} value={t.id}>In {t.name}</option>)}</select>
              <select aria-label="Link back" style={inp} value={act.linkFieldId ?? ""} onChange={(e) => setAct(i, { ...act, linkFieldId: e.target.value || undefined })}><option value="">Don&apos;t link</option>{fieldsOf(act.tableId).filter((f) => f.type === "link" && f.options.linkedTableId === a.trigger.tableId).map((f) => <option key={f.id} value={f.id}>Link via “{f.name}”</option>)}</select>
            </div>
            <ValueRows tid={act.tableId} values={act.values} onChange={(v) => setAct(i, { ...act, values: v })} />
          </>}
          {act.type === "add_comment" && <textarea className="p-textarea" rows={2} aria-label="Comment" value={act.body} onChange={(e) => setAct(i, { ...act, body: e.target.value })} placeholder="e.g. {Deal} was won — kick off onboarding." />}
        </fieldset>
      ))}
      {a.actions.length < 10 && <button type="button" className="p-tbtn" style={{ marginTop: 8 }} onClick={() => setA({ ...a, actions: [...a.actions, { type: "add_comment", body: "" }] })}><Plus size={14} />Add action</button>}
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}><input type="checkbox" checked={a.isEnabled} onChange={(e) => setA({ ...a, isEnabled: e.target.checked })} />Turn on after saving</label>
      {err && <p style={{ color: "var(--color-text-error)", marginTop: 10 }}>{err}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <Button label="Cancel" onClick={onClose} />
        <Button label="Save" variant="primary" clickAction={async () => { const r = await saveAutomationAction(meta.base.id, { id: a.id || undefined, name: a.name, trigger: a.trigger, actions: a.actions, isEnabled: a.isEnabled }); if (!r.ok) setErr(r.error); else onSaved(); }} />
      </div>
    </Dialog>
  );
}
