"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/modal";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Zap, Plus, Trash2, Pencil, History, FlaskConical, GitBranch, Sparkles, Send, MessageSquare, PenLine, Link2, FilePlus2, Clock, Webhook, Check, X } from "lucide-react";
import { isComputed } from "@/lib/platform/fields";
import { automationRunsAction, decideApprovalAction, deleteAutomationAction, previewAutomationAction, saveAutomationAction, searchLinkAction } from "@/app/platform-actions";
import type { Action, Trigger } from "@/server/platform/automations";
import type { BaseMeta } from "@/app/(base)/base/[baseId]/load";
import { BaseHeader } from "./base-header";
import { ConditionList } from "./toolbar";
import type { ClientField } from "./types";
import { confirmDialog } from "@/components/ui/dialogs";

type Auto = { id: string; name: string; isEnabled: boolean; trigger: Trigger; actions: Action[]; lastRunAt: string | null; runCount: number; failCount: number; webhookToken: string | null };
export type ApprovalRow = { id: string; kind: string; summary: string; status: string; source: string; createdAt: string; result: Record<string, unknown> | null };
const inp: React.CSSProperties = { width: "100%", height: 34, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-background-surface)", color: "var(--color-text-primary)", font: "inherit", padding: "0 8px" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", margin: "12px 0 4px" };
const TRIGGERS: Record<Trigger["type"], [string, React.ReactNode]> = {
  record_created: ["When a record is created", <FilePlus2 key="c" size={14} />],
  record_updated: ["When a record is updated", <PenLine key="u" size={14} />],
  record_matches: ["When a record is created or updated and matches conditions", <Check key="m" size={14} />],
  schedule: ["On a schedule, for every matching record", <Clock key="s" size={14} />],
  webhook: ["When a webhook is received (creates a record)", <Webhook key="w" size={14} />],
};
const STEPS: Record<Action["type"], [string, React.ReactNode]> = {
  update_record: ["Update the record", <PenLine key="1" size={14} />], update_linked: ["Update linked records", <Link2 key="2" size={14} />],
  create_record: ["Create a record", <FilePlus2 key="3" size={14} />], add_comment: ["Add a comment", <MessageSquare key="4" size={14} />],
  ai_generate: ["Generate a field with AI", <Sparkles key="5" size={14} />], webhook: ["Send to a webhook (needs approval)", <Send key="6" size={14} />],
  branch: ["If / else", <GitBranch key="7" size={14} />],
};
const blank = (t: Action["type"], tableId: string): Action => t === "update_record" ? { type: t, values: {} } : t === "update_linked" ? { type: t, linkFieldId: "", values: {} } : t === "create_record" ? { type: t, tableId, values: {} }
  : t === "add_comment" ? { type: t, body: "" } : t === "ai_generate" ? { type: t, fieldId: "", prompt: "" } : t === "webhook" ? { type: t, url: "https://" } : { type: "branch", conditions: { conjunction: "and", conditions: [] }, then: [], else: [] };

function summary(a: Action[], tableName: (id: string) => string): string {
  return a.map((x) => x.type === "branch" ? `if… (${x.then.length}/${x.else.length} steps)` : x.type === "create_record" ? `create in ${tableName(x.tableId)}` : STEPS[x.type][0].toLowerCase()).join(" → ");
}

export function AutomationsApp({ meta, automations, approvals }: { meta: BaseMeta; automations: Auto[]; approvals: ApprovalRow[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<Auto | null>(null);
  const [runs, setRuns] = useState<{ auto: Auto; rows: { id: string; status: string; result: unknown; error: string | null; at: string }[] } | null>(null);
  const [err, setErr] = useState("");
  const tableName = (id: string) => meta.tables.find((t) => t.id === id)?.name ?? "a deleted table";
  const toggle = async (a: Auto) => { const r = await saveAutomationAction(meta.base.id, { ...a, isEnabled: !a.isEnabled }); if (!r.ok) setErr(r.error); router.refresh(); };
  const pending = approvals.filter((a) => a.status === "pending");
  return (
    <div className="p-base">
      <BaseHeader base={meta.base} role={meta.role} active="automations" />
      <main style={{ flex: 1, overflow: "auto", background: "var(--color-background-muted)", padding: 24 }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700 }}>Automations</h1>
              <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>Trigger → steps, with if/else branches. Internal steps run straight away; anything leaving the workspace (webhooks) waits in the approval queue. Imports and syncs never trigger automations, and chains stop after 3 hops.</p>
            </div>
            {meta.canEdit && <Button label="New automation" variant="primary" icon={<Plus size={16} />} onClick={() => setEdit({ id: "", name: "", isEnabled: false, trigger: { type: "record_created", tableId: meta.tables[0]?.id ?? "" }, actions: [blank("add_comment", meta.tables[0]?.id ?? "")], lastRunAt: null, runCount: 0, failCount: 0, webhookToken: null })} />}
          </div>
          {err && <p style={{ color: "var(--color-text-error)", marginBottom: 8 }}>{err}</p>}
          {pending.length > 0 && <ApprovalQueue items={pending} onDone={() => router.refresh()} />}
          {!automations.length && <EmptyState title="No automations yet" description="Start from a recipe below (built from your own tables and fields), or choose New automation. Recipes open in the editor switched off, so you can test them before turning them on." />}
          {meta.canEdit && <Recipes meta={meta} onPick={(a) => setEdit(a)} compact={automations.length > 0} />}
          <div style={{ display: "grid", gap: 10 }}>
            {automations.map((a) => (
              <article key={a.id} className="p-basecard" style={{ alignItems: "flex-start" }}>
                <span style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 8, background: a.isEnabled ? "var(--color-background-green)" : "var(--color-background-gray)" }}><Zap size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t">{a.name}</div>
                  <div className="s">{TRIGGERS[a.trigger.type][0]} in {tableName(a.trigger.tableId)} → {summary(a.actions, tableName)}</div>
                  {a.trigger.type === "webhook" && a.webhookToken && <div className="s mono" style={{ overflowWrap: "anywhere" }}>POST <Origin />/api/hooks/{a.webhookToken}</div>}
                  <div className="s">{a.runCount} successful run{a.runCount === 1 ? "" : "s"}{a.failCount ? ` · ${a.failCount} failed` : ""}{a.lastRunAt ? ` · last ${new Date(a.lastRunAt).toLocaleString("en-GB")}` : ""}</div>
                </div>
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={a.isEnabled} disabled={!meta.canEdit} onChange={() => toggle(a)} />{a.isEnabled ? "On" : "Off"}</label>
                <button type="button" className="p-tbtn" aria-label="Run history" onClick={async () => { const r = await automationRunsAction(a.id); if (r.ok) setRuns({ auto: a, rows: r.data }); }}><History size={14} /></button>
                {meta.canEdit && <button type="button" className="p-tbtn" aria-label="Edit" onClick={() => setEdit(a)}><Pencil size={14} /></button>}
                {meta.canEdit && <button type="button" className="p-tbtn" aria-label="Delete" onClick={async () => { if ((await confirmDialog(`Delete “${a.name}”?`, { danger: true, confirmLabel: "Delete" }))) { await deleteAutomationAction(a.id); router.refresh(); } }}><Trash2 size={14} /></button>}
              </article>
            ))}
          </div>
        </div>
      </main>
      {edit && <AutomationDialog meta={meta} initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); router.refresh(); }} />}
      {runs && (
        <Dialog isOpen onOpenChange={(o) => !o && setRuns(null)} width={680} padding={6} purpose="info">
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>Run history — {runs.auto.name}</h2>
          {!runs.rows.length && <p style={{ color: "var(--color-text-secondary)" }}>No runs yet.</p>}
          <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 460, overflow: "auto" }}>
            {runs.rows.map((r) => { const steps = (r.result as { steps?: string[] } | null)?.steps; return (
              <li key={r.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--color-border)", fontSize: 13 }}>
                <div style={{ display: "flex", gap: 10 }}><span className={`chip ${r.status === "succeeded" ? "green" : r.status === "failed" ? "red" : "gray"}`}>{r.status}</span><span style={{ flex: 1, color: "var(--color-text-secondary)" }}>{new Date(r.at).toLocaleString("en-GB")}</span></div>
                {r.error && <div style={{ color: "var(--color-text-error)", marginTop: 4 }}>{r.error}</div>}
                {steps ? <ol style={{ margin: "4px 0 0 18px" }}>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : !r.error && <div style={{ marginTop: 4, color: "var(--color-text-secondary)" }}>{JSON.stringify(r.result)}</div>}
              </li>
            ); })}
          </ul>
        </Dialog>
      )}
    </div>
  );
}

export function ApprovalQueue({ items, onDone }: { items: ApprovalRow[]; onDone: () => void }) {
  const [err, setErr] = useState("");
  return (
    <section className="p-basecard" style={{ display: "block", marginBottom: 16, borderColor: "var(--color-text-yellow)" }} aria-label="Waiting for approval">
      <strong>Waiting for approval ({items.length})</strong>
      {err && <p style={{ color: "var(--color-text-error)", fontSize: 13 }}>{err}</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
        {items.map((a) => (
          <li key={a.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--color-border)", fontSize: 13 }}>
            <span className="chip">{a.source === "agent" ? "agent" : "automation"} · {a.kind.replace("_", " ")}</span>
            <span style={{ flex: 1 }}>{a.summary}</span>
            <button type="button" className="p-tbtn on-green" onClick={async () => { setErr(""); const r = await decideApprovalAction(a.id, true); if (!r.ok) setErr(r.error); onDone(); }}><Check size={14} />Approve</button>
            <button type="button" className="p-tbtn" onClick={async () => { const r = await decideApprovalAction(a.id, false); if (!r.ok) setErr(r.error); onDone(); }}><X size={14} />Reject</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AutomationDialog({ meta, initial, onClose, onSaved }: { meta: BaseMeta; initial: Auto; onClose: () => void; onSaved: () => void }) {
  const [a, setA] = useState<Auto>(initial);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<{ recordId: string; steps: string[] | null }>({ recordId: "", steps: null });
  const [records, setRecords] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => { searchLinkAction(a.trigger.tableId, "").then((r) => { if (r.ok) setRecords(r.data.slice(0, 50)); }); }, [a.trigger.tableId]);
  const fieldsOf = (tid: string): ClientField[] => meta.fields.filter((f) => f.tableId === tid).map((f) => ({ ...f, editable: true, isPrimary: meta.tables.find((t) => t.id === tid)?.primaryFieldId === f.id }));
  const tf = fieldsOf(a.trigger.tableId);
  const setT = (p: Partial<Trigger>) => setA((x) => ({ ...x, trigger: { ...x.trigger, ...p } }));
  const definition = { name: a.name, trigger: a.trigger, actions: a.actions };
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={760} padding={6} purpose="form">
      <div style={{ display: "block", flex: "none" }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>{a.id ? "Edit automation" : "New automation"}</h2>
      <label style={lbl} htmlFor="au-name">Name</label>
      <input id="au-name" style={inp} value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder="e.g. Won deal → create engagement" />
      <fieldset style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 12, marginTop: 14 }}>
        <legend style={{ fontWeight: 600, padding: "0 6px" }}>Trigger</legend>
        <div style={{ display: "flex", gap: 10 }}>
          <select aria-label="Trigger type" style={inp} value={a.trigger.type} onChange={(e) => setT({ type: e.target.value as Trigger["type"], schedule: e.target.value === "schedule" ? { every: "day", hour: 7 } : undefined })}>{Object.entries(TRIGGERS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
          <select aria-label="Trigger table" style={{ ...inp, width: 200 }} value={a.trigger.tableId} onChange={(e) => setT({ tableId: e.target.value, watchFieldIds: [], conditions: undefined })}>{meta.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </div>
        {a.trigger.type === "schedule" && (
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <select aria-label="Frequency" style={inp} value={a.trigger.schedule?.every ?? "day"} onChange={(e) => setT({ schedule: { ...a.trigger.schedule, every: e.target.value as "hour" | "day" | "week" } })}><option value="hour">Every hour</option><option value="day">Every day</option><option value="week">Every week</option></select>
            {a.trigger.schedule?.every !== "hour" && <select aria-label="Hour (UTC)" style={inp} value={a.trigger.schedule?.hour ?? 7} onChange={(e) => setT({ schedule: { ...a.trigger.schedule!, hour: Number(e.target.value) } })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00 UTC</option>)}</select>}
            {a.trigger.schedule?.every === "week" && <select aria-label="Weekday" style={inp} value={a.trigger.schedule?.weekday ?? 1} onChange={(e) => setT({ schedule: { ...a.trigger.schedule!, weekday: Number(e.target.value) } })}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <option key={d} value={i}>{d}</option>)}</select>}
          </div>
        )}
        {a.trigger.type === "schedule" && <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 6 }}>Runs with the background job runner (on the free hosting tier that is once a day). Each record is processed once per period.</p>}
        {a.trigger.type === "webhook" && <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 6 }}>After saving you get a secret URL. POST a JSON object whose keys are field names; a record is created and the steps run on it.</p>}
        {a.trigger.type === "record_updated" && <><label style={lbl}>Only when these fields change (optional)</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{tf.filter((f) => !isComputed(f.type)).map((f) => { const on = a.trigger.watchFieldIds?.includes(f.id); return <button key={f.id} type="button" className={`chip ${on ? "blue" : ""}`} style={{ border: 0, cursor: "pointer" }} onClick={() => setT({ watchFieldIds: on ? a.trigger.watchFieldIds!.filter((x) => x !== f.id) : [...(a.trigger.watchFieldIds ?? []), f.id] })}>{f.name}</button>; })}</div></>}
        {a.trigger.type !== "webhook" && <>
          <label style={lbl}>Only for records where {a.trigger.type === "record_matches" ? "" : "(optional)"}</label>
          {tf.length > 0 && <ConditionList fields={tf} conds={a.trigger.conditions?.conditions ?? []} onChange={(c) => setT({ conditions: { conjunction: a.trigger.conditions?.conjunction ?? "and", conditions: c } })} />}
          <button type="button" className="p-tbtn" onClick={() => setT({ conditions: { conjunction: "and", conditions: [...(a.trigger.conditions?.conditions ?? []), { fieldId: tf[0].id, op: "isNotEmpty" }] } })}><Plus size={14} />Add condition</button>
        </>}
      </fieldset>
      <StepList meta={meta} triggerTable={a.trigger.tableId} steps={a.actions} onChange={(s) => setA({ ...a, actions: s })} fieldsOf={fieldsOf} depth={0} />
      <fieldset style={{ border: "1px dashed var(--color-border)", borderRadius: 8, padding: 12, marginTop: 14 }}>
        <legend style={{ fontWeight: 600, padding: "0 6px", display: "flex", gap: 6, alignItems: "center" }}><FlaskConical size={14} />Test (dry run)</legend>
        <div style={{ display: "flex", gap: 8 }}>
          <select aria-label="Test record" style={inp} value={preview.recordId} onChange={(e) => setPreview({ recordId: e.target.value, steps: null })}><option value="">Choose a record…</option>{records.map((r) => <option key={r.id} value={r.id}>{r.title || "Unnamed"}</option>)}</select>
          <button type="button" className="p-tbtn on-purple" disabled={!preview.recordId} onClick={async () => { setErr(""); const r = await previewAutomationAction(meta.base.id, definition, preview.recordId); if (!r.ok) setErr(r.error); else setPreview({ ...preview, steps: r.data.steps }); }}>Preview</button>
        </div>
        {preview.steps && <ol style={{ margin: "8px 0 0 18px", fontSize: 13 }}>{preview.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 6 }}>Shows exactly what each step would write or queue, with {"{Field}"} tokens filled in. Nothing is changed or sent.</p>
      </fieldset>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}><input type="checkbox" checked={a.isEnabled} onChange={(e) => setA({ ...a, isEnabled: e.target.checked })} />Turn on after saving</label>
      {err && <p style={{ color: "var(--color-text-error)", marginTop: 10 }}>{err}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <Button label="Cancel" onClick={onClose} />
        <Button label="Save" variant="primary" clickAction={async () => { const r = await saveAutomationAction(meta.base.id, { id: a.id || undefined, ...definition, isEnabled: a.isEnabled }); if (!r.ok) setErr(r.error); else onSaved(); }} />
      </div>
      </div>
    </Dialog>
  );
}

function StepList({ meta, triggerTable, steps, onChange, fieldsOf, depth }: { meta: BaseMeta; triggerTable: string; steps: Action[]; onChange: (s: Action[]) => void; fieldsOf: (tid: string) => ClientField[]; depth: number }) {
  const set = (i: number, s: Action) => onChange(steps.map((x, j) => (j === i ? s : x)));
  const writable = (tid: string) => fieldsOf(tid).filter((f) => !isComputed(f.type) && !["link", "user", "attachment", "button"].includes(f.type));
  const tf = fieldsOf(triggerTable);
  const ValueRows = ({ tid, values, onValues }: { tid: string; values: Record<string, unknown>; onValues: (v: Record<string, unknown>) => void }) => (
    <div>
      {Object.entries(values).map(([fid, v]) => { const f = fieldsOf(tid).find((x) => x.id === fid); return (
        <div key={fid} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <span className="chip" style={{ height: 34, borderRadius: 6, minWidth: 120 }}>{f?.name ?? "?"}</span>
          {f?.type === "singleSelect" ? <select aria-label={f.name} style={inp} value={String(v ?? "")} onChange={(e) => onValues({ ...values, [fid]: e.target.value })}><option value="">(clear)</option>{f.options.choices?.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
            : f?.type === "checkbox" ? <select aria-label={f.name} style={inp} value={String(!!v)} onChange={(e) => onValues({ ...values, [fid]: e.target.value === "true" })}><option value="true">Checked</option><option value="false">Unchecked</option></select>
            : <input aria-label={f?.name} style={inp} value={String(v ?? "")} placeholder="Value — {Field name} copies from the trigger record" onChange={(e) => onValues({ ...values, [fid]: e.target.value })} />}
          <button type="button" className="p-tbtn" aria-label="Remove" onClick={() => { const n = { ...values }; delete n[fid]; onValues(n); }}><Trash2 size={14} /></button>
        </div>
      ); })}
      <select aria-label="Set a field" style={{ ...inp, width: "auto" }} value="" onChange={(e) => e.target.value && onValues({ ...values, [e.target.value]: "" })}><option value="">+ Set a field…</option>{writable(tid).filter((f) => !(f.id in values)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
    </div>
  );
  return (
    <div style={{ marginLeft: depth ? 14 : 0, borderLeft: depth ? "2px solid var(--color-border)" : undefined, paddingLeft: depth ? 10 : 0 }}>
      {steps.map((act, i) => (
        <fieldset key={i} style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 12, marginTop: 12 }}>
          <legend style={{ fontWeight: 600, padding: "0 6px", display: "flex", gap: 6, alignItems: "center" }}>{STEPS[act.type][1]}Step {i + 1}</legend>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select aria-label="Step type" style={inp} value={act.type} onChange={(e) => set(i, blank(e.target.value as Action["type"], meta.tables[0].id))}>{Object.entries(STEPS).filter(([k]) => k !== "branch" || depth < 2).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
            <button type="button" className="p-tbtn" aria-label="Move up" disabled={i === 0} onClick={() => { const n = [...steps]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}>↑</button>
            <button type="button" className="p-tbtn" aria-label="Remove step" onClick={() => onChange(steps.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>
          {act.type === "update_record" && <ValueRows tid={triggerTable} values={act.values} onValues={(v) => set(i, { ...act, values: v })} />}
          {act.type === "update_linked" && <>
            <select aria-label="Through link" style={{ ...inp, marginBottom: 8 }} value={act.linkFieldId} onChange={(e) => set(i, { ...act, linkFieldId: e.target.value, values: {} })}><option value="">Through link field…</option>{tf.filter((f) => f.type === "link").map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            {act.linkFieldId && <ValueRows tid={tf.find((f) => f.id === act.linkFieldId)?.options.linkedTableId ?? ""} values={act.values} onValues={(v) => set(i, { ...act, values: v })} />}
          </>}
          {act.type === "create_record" && <>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <select aria-label="Create in table" style={inp} value={act.tableId} onChange={(e) => set(i, { type: "create_record", tableId: e.target.value, values: {} })}>{meta.tables.map((t) => <option key={t.id} value={t.id}>In {t.name}</option>)}</select>
              <select aria-label="Link back" style={inp} value={act.linkFieldId ?? ""} onChange={(e) => set(i, { ...act, linkFieldId: e.target.value || undefined })}><option value="">Don&apos;t link</option>{fieldsOf(act.tableId).filter((f) => f.type === "link" && f.options.linkedTableId === triggerTable).map((f) => <option key={f.id} value={f.id}>Link via “{f.name}”</option>)}</select>
            </div>
            <ValueRows tid={act.tableId} values={act.values} onValues={(v) => set(i, { ...act, values: v })} />
          </>}
          {act.type === "add_comment" && <textarea className="p-textarea" rows={2} aria-label="Comment" value={act.body} onChange={(e) => set(i, { ...act, body: e.target.value })} placeholder="e.g. {Deal} was won — kick off onboarding." />}
          {act.type === "ai_generate" && <>
            <select aria-label="Field to fill" style={{ ...inp, marginBottom: 8 }} value={act.fieldId} onChange={(e) => set(i, { ...act, fieldId: e.target.value })}><option value="">Field to fill…</option>{tf.filter((f) => ["singleLineText", "longText", "aiText"].includes(f.type)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            <textarea className="p-textarea" rows={2} aria-label="AI prompt" value={act.prompt} onChange={(e) => set(i, { ...act, prompt: e.target.value })} placeholder="e.g. Write a two-line onboarding welcome for {Account} who bought {Offer}." />
          </>}
          {act.type === "webhook" && <>
            <input aria-label="Webhook URL" style={inp} value={act.url} onChange={(e) => set(i, { ...act, url: e.target.value })} placeholder="https://hooks.example.com/…" />
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>Sends the record&apos;s fields as JSON — only after a creator approves it in the queue. Private and non-https addresses are refused.</p>
          </>}
          {act.type === "branch" && <>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>If the record matches</div>
            {tf.length > 0 && <ConditionList fields={tf} conds={act.conditions.conditions} onChange={(c) => set(i, { ...act, conditions: { ...act.conditions, conditions: c } })} />}
            <button type="button" className="p-tbtn" onClick={() => set(i, { ...act, conditions: { ...act.conditions, conditions: [...act.conditions.conditions, { fieldId: tf[0].id, op: "isNotEmpty" }] } })}><Plus size={14} />Add condition</button>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>Then</div>
            <StepList meta={meta} triggerTable={triggerTable} steps={act.then} onChange={(s) => set(i, { ...act, then: s })} fieldsOf={fieldsOf} depth={depth + 1} />
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>Otherwise</div>
            <StepList meta={meta} triggerTable={triggerTable} steps={act.else} onChange={(s) => set(i, { ...act, else: s })} fieldsOf={fieldsOf} depth={depth + 1} />
          </>}
        </fieldset>
      ))}
      {steps.length < 25 && <button type="button" className="p-tbtn" style={{ marginTop: 8 }} onClick={() => onChange([...steps, blank("add_comment", meta.tables[0].id)])}><Plus size={14} />Add step</button>}
    </div>
  );
}

function Origin() { const [o, setO] = useState(""); useEffect(() => setO(location.origin), []); return <>{o}</>; }


/** One-click starting points built from this base's real tables and fields. They open in the editor, switched off. */
function Recipes({ meta, onPick, compact }: { meta: BaseMeta; onPick: (a: Auto) => void; compact: boolean }) {
  const [open, setOpen] = useState(!compact);
  const out: { title: string; desc: string; icon: React.ReactNode; auto: Auto }[] = [];
  const mk = (name: string, trigger: Trigger, actions: Action[]): Auto => ({ id: "", name, isEnabled: false, trigger, actions, lastRunAt: null, runCount: 0, failCount: 0, webhookToken: null });
  for (const t of meta.tables.slice(0, 6)) {
    const fs = meta.fields.filter((f) => f.tableId === t.id);
    const prim = fs.find((f) => f.id === t.primaryFieldId)?.name ?? "Name";
    const sel = fs.find((f) => f.type === "singleSelect" && ((f.options as { choices?: unknown[] }).choices?.length ?? 0) >= 2);
    const choices = ((sel?.options as { choices?: { id: string; name: string }[] })?.choices) ?? [];
    const last = choices[choices.length - 1];
    const date = fs.find((f) => f.type === "date" || f.type === "dateTime");
    const long = fs.find((f) => f.type === "longText");
    const link = fs.find((f) => f.type === "link" && (f.options as { linkedTableId?: string }).linkedTableId !== t.id);
    if (sel && last) out.push({ title: `When ${t.name.toLowerCase()} move to ${last.name}`, desc: `Watch ${sel.name}; when it becomes “${last.name}”, add a comment for the team.`, icon: <Check size={16} />,
      auto: mk(`${t.name}: ${sel.name} → ${last.name}`, { type: "record_matches", tableId: t.id, watchFieldIds: [sel.id], conditions: { conjunction: "and", conditions: [{ fieldId: sel.id, op: "is", value: last.id }] } }, [{ type: "add_comment", body: `{${prim}} moved to ${last.name}.` }]) });
    if (date) out.push({ title: `Daily overdue check on ${t.name.toLowerCase()}`, desc: `Every morning at 08:00, comment on ${t.name.toLowerCase()} whose ${date.name} has passed${sel && last ? ` and aren't ${last.name}` : ""}.`, icon: <Clock size={16} />,
      auto: mk(`${t.name}: overdue check`, { type: "schedule", tableId: t.id, schedule: { every: "day", hour: 8 }, conditions: { conjunction: "and", conditions: [{ fieldId: date.id, op: "isBefore", value: "today" }, ...(sel && last ? [{ fieldId: sel.id, op: "isNot", value: last.id }] : [])] } }, [{ type: "add_comment", body: `Overdue: ${date.name} was {${date.name}}.` }]) });
    if (link) {
      const other = (link.options as { linkedTableId: string }).linkedTableId;
      const back = meta.fields.find((f) => f.tableId === other && f.type === "link" && (f.options as { linkedTableId?: string }).linkedTableId === t.id);
      const otherT = meta.tables.find((x) => x.id === other);
      if (otherT && back && otherT.primaryFieldId) out.push({ title: `New ${t.name.toLowerCase()} → linked ${otherT.name.toLowerCase()}`, desc: `When a record is added to ${t.name}, create a record in ${otherT.name} linked back to it.`, icon: <Link2 size={16} />,
        auto: mk(`${t.name}: create linked ${otherT.name.toLowerCase()}`, { type: "record_created", tableId: t.id }, [{ type: "create_record", tableId: other, linkFieldId: back.id, values: { [otherT.primaryFieldId]: `Follow-up: {${prim}}` } }]) });
    }
    if (long) out.push({ title: `AI summary for ${t.name.toLowerCase()}`, desc: `When a record is created, write a short summary into ${long.name} (needs the AI key to be configured).`, icon: <Sparkles size={16} />,
      auto: mk(`${t.name}: AI summary`, { type: "record_created", tableId: t.id }, [{ type: "ai_generate", fieldId: long.id, prompt: "Summarise this record in two sentences for a busy manager." }]) });
    out.push({ title: `Note every new ${t.name.replace(/s$/, "").toLowerCase()}`, desc: `When a record is created in ${t.name}, add a comment so the team sees it in the activity feed.`, icon: <FilePlus2 size={16} />,
      auto: mk(`${t.name}: note new records`, { type: "record_created", tableId: t.id }, [{ type: "add_comment", body: `New: {${prim}}.` }]) });
  }
  if (!out.length) return null;
  return (
    <section style={{ margin: "8px 0 18px" }} aria-label="Recipes">
      <button type="button" className="p-tbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open}><Sparkles size={14} />{open ? "Hide recipes" : `Recipes for this base (${out.length})`}</button>
      {open && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginTop: 10 }}>
        {out.slice(0, 12).map((r) => (
          <button key={r.auto.name} type="button" className="if-layout" onClick={() => onPick(r.auto)} style={{ background: "var(--color-background-card)" }}>
            <span style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--color-text-primary)", fontSize: 14 }}><span style={{ color: "var(--color-accent)", display: "inline-flex" }}>{r.icon}</span><strong>{r.title}</strong></span>
            <span>{r.desc}</span>
          </button>
        ))}
      </div>}
    </section>
  );
}
