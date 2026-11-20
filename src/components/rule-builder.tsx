"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ENTITIES } from "@/lib/entities";
import { humanize } from "@/lib/format";
import { createRuleAction, setRuleStatusAction } from "@/app/actions";
import { useRun } from "./client";
import { useEntityConfig } from "./org-config";
import { Icon } from "./icons";
import { confirmDialog } from "@/components/ui/dialogs";

type Rule = { id: string; name: string; status: string; conditions: { entity: string; event: string; field: string; value: string; action: { type: string; title?: string; priority?: string; dueInDays?: number | null; field?: string; value?: unknown } } };
type Run = { workflowKey: string; status: string; at: string; result: unknown };

const ENTITY_LIST = Object.values(ENTITIES).map((d) => ({ key: d.key, plural: d.plural })).sort((a, b) => a.plural.localeCompare(b.plural));

export function RuleBuilder({ rules, runs, ruleKeys, isAdmin }: { rules: Rule[]; runs: Run[]; ruleKeys: Record<string, string>; isAdmin: boolean }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [r, setR] = useState({ name: "", entity: "deliverables", event: "updated", field: "", value: "", action: "create_task", title: "Follow up: {{title}}", priority: "normal", dueInDays: "2", setField: "", setValue: "" });
  const cfg = useEntityConfig(r.entity);
  const condFields = cfg.fields.filter((f) => !f.sensitive && ["select", "bool", "text"].includes(f.type));
  const cond = condFields.find((f) => f.key === r.field);
  const setFields = cfg.fields.filter((f) => !f.readOnly && !f.system && f.type !== "ref" && !f.sensitive && f.key !== r.field && f.key !== "productionId");
  const target = setFields.find((f) => f.key === r.setField);
  const valueInput = (f: typeof cond, value: string, onChange: (v: string) => void, label: string) =>
    f?.type === "select" ? <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Choose…</option>{f.options!.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}</select>
      : f?.type === "bool" ? <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option></select>
        : <input className="input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const action = r.action === "create_task"
      ? { type: "create_task", title: r.title, priority: r.priority, dueInDays: r.dueInDays === "" ? null : Number(r.dueInDays) }
      : { type: "set_field", field: r.setField, value: target?.type === "bool" ? r.setValue === "true" : target?.type === "int" ? Number(r.setValue) : r.setValue };
    const res = await run(createRuleAction({ name: r.name, entity: r.entity, event: r.event, field: r.field, value: r.value, action }), "Rule created and active");
    if (res) { setR({ ...r, name: "", field: "", value: "" }); router.refresh(); }
  };
  const describe = (x: Rule) => {
    const d = ENTITY_LIST.find((e) => e.key === x.conditions.entity)?.plural ?? x.conditions.entity;
    const a = x.conditions.action;
    return `When ${d} ${x.conditions.event === "created" ? "are created with" : "change"} ${humanize(x.conditions.field)} = ${humanize(x.conditions.value)} → ${a.type === "create_task" ? `create task “${a.title}”${a.dueInDays != null ? ` due in ${a.dueInDays}d` : ""}` : `set ${humanize(a.field)} to ${humanize(String(a.value))}`}`;
  };
  return (
    <div className="stack">
      {isAdmin && (
        <form className="panel" onSubmit={submit} aria-label="New rule">
          <div className="panel-head"><h2>New rule</h2><span className="subtle" style={{ fontSize: 12 }}>Runs with your permissions · idempotent · loop-guarded</span></div>
          <div className="panel-body form-grid">
            <div className="field wide"><label htmlFor="r-name">Rule name</label><input id="r-name" className="input" required value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="e.g. Chase QC when a deliverable is rejected" /></div>
            <div className="field"><label htmlFor="r-entity">When a…</label><select id="r-entity" className="select" value={r.entity} onChange={(e) => setR({ ...r, entity: e.target.value, field: "", value: "", setField: "", setValue: "" })}>{ENTITY_LIST.map((e) => <option key={e.key} value={e.key}>{e.plural}</option>)}</select></div>
            <div className="field"><label htmlFor="r-event">is…</label><select id="r-event" className="select" value={r.event} onChange={(e) => setR({ ...r, event: e.target.value })}><option value="updated">changed so that</option><option value="created">created with</option></select></div>
            <div className="field"><label htmlFor="r-field">Field</label><select id="r-field" className="select" required value={r.field} onChange={(e) => setR({ ...r, field: e.target.value, value: "" })}><option value="">Choose…</option>{condFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></div>
            <div className="field"><label>equals</label>{valueInput(cond, r.value, (v) => setR({ ...r, value: v }), "Trigger value")}</div>
            <div className="field"><label htmlFor="r-action">Then</label><select id="r-action" className="select" value={r.action} onChange={(e) => setR({ ...r, action: e.target.value })}><option value="create_task">Create a task</option><option value="set_field">Set another field on the record</option></select></div>
            {r.action === "create_task" ? <>
              <div className="field"><label htmlFor="r-title">Task title</label><input id="r-title" className="input" value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} /><span className="help">{"{{title}}"} inserts the record’s name</span></div>
              <div className="field"><label htmlFor="r-pri">Priority</label><select id="r-pri" className="select" value={r.priority} onChange={(e) => setR({ ...r, priority: e.target.value })}>{["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</select></div>
              <div className="field"><label htmlFor="r-due">Due in (days)</label><input id="r-due" className="input" type="number" min={0} value={r.dueInDays} onChange={(e) => setR({ ...r, dueInDays: e.target.value })} /></div>
            </> : <>
              <div className="field"><label htmlFor="r-sf">Field to set</label><select id="r-sf" className="select" value={r.setField} onChange={(e) => setR({ ...r, setField: e.target.value, setValue: "" })}><option value="">Choose…</option>{setFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></div>
              <div className="field"><label>to</label>{valueInput(target as typeof cond, r.setValue, (v) => setR({ ...r, setValue: v }), "Value to set")}</div>
            </>}
            <div className="wide"><button className="btn btn-primary" disabled={pending}><Icon name="bolt" /> Create rule</button></div>
          </div>
        </form>
      )}
      <section className="panel" aria-label="Rules">
        <div className="panel-head"><h2>Rules</h2><span className="subtle">{rules.length}</span></div>
        <ul className="list">
          {rules.map((x) => {
            const recent = runs.filter((u) => u.workflowKey === ruleKeys[x.id]);
            return (
              <li key={x.id} style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{x.name}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{describe(x)}</div>
                  <div className="subtle" style={{ fontSize: 12 }}>{recent.filter((u) => u.status === "succeeded").length} fired · {recent.filter((u) => u.status === "skipped").length} skipped · {recent.filter((u) => ["failed", "blocked"].includes(u.status)).length} failed (last 200 runs)</div>
                </div>
                <span className={`badge ${x.status === "active" ? "tone-ok" : "tone-warn"}`}>{humanize(x.status)}</span>
                {isAdmin && <>
                  <button className="btn btn-sm" onClick={() => run(setRuleStatusAction(x.id, x.status === "active" ? "paused" : "active")).then((v) => v !== undefined && router.refresh())}>{x.status === "active" ? "Pause" : "Activate"}</button>
                  <button className="btn btn-quiet btn-sm btn-danger" onClick={async () => (await confirmDialog(`Delete rule “${x.name}”? Its run history is kept.`, { danger: true, confirmLabel: "Delete" })) && run(setRuleStatusAction(x.id, "archived")).then((v) => v !== undefined && router.refresh())}>Delete</button>
                </>}
              </li>
            );
          })}
          {!rules.length && <li className="subtle">No custom rules yet. Example: when a deliverable’s status changes to “rejected”, create an urgent task “Fix QC notes: {"{{title}}"}” due in 1 day.</li>}
        </ul>
      </section>
    </div>
  );
}
