"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { archiveFieldDefAction, createFieldDefAction, updateFieldDefAction, updateSettingsAction } from "@/app/actions";
import { CUSTOM_FIELD_TYPES, DEFAULT_APPROVAL, DEFAULT_CONTACT_POLICY, type CustomFieldDefShape, type OrgSettingsShape, optionLabel } from "@/lib/customise";
import { useRun } from "./client";
import { Icon } from "./icons";

type EntityMeta = { key: string; label: string; plural: string };
type Ext = { key: string; entity: string; entityLabel: string; field: string; label: string; builtIn: string[] };

const pounds = (minor?: number) => (minor == null ? "" : (minor / 100).toFixed(0));

export function GeneralSettings({ settings }: { settings: OrgSettingsShape }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [v, setV] = useState({
    currency: settings.currency ?? "GBP", timezone: settings.timezone ?? "Europe/London", vat: String((settings.defaultVatBp ?? 2000) / 100),
    pm: pounds(settings.approval?.pmLimitMinor ?? DEFAULT_APPROVAL.pmLimitMinor), producer: pounds(settings.approval?.producerLimitMinor ?? DEFAULT_APPROVAL.producerLimitMinor),
    policy: settings.callSheetContactPolicy ?? DEFAULT_CONTACT_POLICY, departments: (settings.departments ?? []).join(", "),
  });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(updateSettingsAction({
      currency: v.currency.toUpperCase(), timezone: v.timezone, defaultVatBp: Math.round(parseFloat(v.vat) * 100),
      approval: { pmLimitMinor: Math.round(parseFloat(v.pm) * 100), producerLimitMinor: Math.round(parseFloat(v.producer) * 100) },
      callSheetContactPolicy: v.policy, departments: v.departments.split(",").map((x) => x.trim()).filter(Boolean),
    }), "Settings saved — they apply immediately to new records and approvals");
    if (r) router.refresh();
  };
  const F = (k: keyof typeof v, label: string, help?: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field"><label htmlFor={`s-${k}`}>{label}</label><input id={`s-${k}`} className="input" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...props} />{help && <span className="help">{help}</span>}</div>
  );
  return (
    <form className="panel" onSubmit={save} aria-label="General settings">
      <div className="panel-head"><h2>Organisation defaults</h2></div>
      <div className="panel-body form-grid">
        {F("currency", "Currency (ISO)", "Default for new productions and budgets", { maxLength: 3 })}
        {F("timezone", "Timezone", "IANA name, e.g. Europe/London, America/New_York")}
        {F("vat", "Default VAT / sales tax %", "Applied to new budget lines", { inputMode: "decimal" })}
        {F("pm", "Production manager can approve below", "Gross amount in your currency", { inputMode: "decimal" })}
        {F("producer", "Producer can approve below", "Above this, an executive must approve", { inputMode: "decimal" })}
        {F("departments", "Departments", "Comma separated — suggested on people and engagements")}
        <div className="field wide"><label htmlFor="s-policy">Call sheet contact policy</label><textarea id="s-policy" className="textarea" value={v.policy} onChange={(e) => setV({ ...v, policy: e.target.value })} /><span className="help">Printed on every issued call sheet</span></div>
        <div className="wide"><button className="btn btn-primary" disabled={pending}>Save defaults</button></div>
      </div>
    </form>
  );
}

export function TerminologySettings({ settings, entities }: { settings: OrgSettingsShape; entities: EntityMeta[] }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [t, setT] = useState<Record<string, { label?: string; plural?: string }>>(settings.terminology ?? {});
  return (
    <section className="panel" aria-label="Terminology">
      <div className="panel-head"><h2>Terminology</h2><span className="subtle" style={{ fontSize: 12 }}>Rename record types to match how your team works — e.g. Scenes → Items, Shoot days → Record days</span></div>
      <div className="table-wrap" style={{ border: 0, borderRadius: 0, maxHeight: 480 }}>
        <table className="data"><thead><tr><th>Record type</th><th>Singular</th><th>Plural</th></tr></thead>
          <tbody>{entities.map((e) => (
            <tr key={e.key}><td>{e.plural}</td>
              <td><input className="input cell-edit" aria-label={`${e.label} singular`} placeholder={e.label} value={t[e.key]?.label ?? ""} onChange={(x) => setT({ ...t, [e.key]: { ...t[e.key], label: x.target.value } })} /></td>
              <td><input className="input cell-edit" aria-label={`${e.label} plural`} placeholder={e.plural} value={t[e.key]?.plural ?? ""} onChange={(x) => setT({ ...t, [e.key]: { ...t[e.key], plural: x.target.value } })} /></td></tr>))}
          </tbody></table>
      </div>
      <div className="panel-body"><button className="btn btn-primary" disabled={pending} onClick={async () => {
        const clean = Object.fromEntries(Object.entries(t).map(([k, x]) => [k, { label: x.label?.trim() || undefined, plural: x.plural?.trim() || undefined }]).filter(([, x]) => (x as { label?: string }).label || (x as { plural?: string }).plural));
        if (await run(updateSettingsAction({ terminology: clean }), "Terminology saved")) router.refresh();
      }}>Save terminology</button></div>
    </section>
  );
}

export function OptionListSettings({ settings, lists }: { settings: OrgSettingsShape; lists: Ext[] }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [opts, setOpts] = useState<Record<string, string[]>>(settings.options ?? {});
  const [sel, setSel] = useState(lists[0]?.key ?? "");
  const [add, setAdd] = useState("");
  const cur = lists.find((l) => l.key === sel);
  return (
    <section className="panel" aria-label="Option lists">
      <div className="panel-head"><h2>Option lists</h2><span className="subtle" style={{ fontSize: 12 }}>Add your own choices. Status lists that drive approvals and delivery logic are locked.</span></div>
      <div className="panel-body stack" style={{ gap: 12 }}>
        <select className="select" aria-label="Choose an option list" value={sel} onChange={(e) => setSel(e.target.value)}>
          {lists.map((l) => <option key={l.key} value={l.key}>{l.entityLabel} → {l.label}</option>)}
        </select>
        {cur && <div className="row">
          {cur.builtIn.map((o) => <span key={o} className="badge plain">{optionLabel(o)}</span>)}
          {(opts[cur.key] ?? []).map((o) => <span key={o} className="badge tone-live plain">{optionLabel(o)} <button type="button" aria-label={`Remove ${o}`} className="btn btn-quiet btn-sm icon-btn" style={{ height: 16, width: 16 }} onClick={() => setOpts({ ...opts, [cur.key]: (opts[cur.key] ?? []).filter((x) => x !== o) })}><Icon name="x" size={10} /></button></span>)}
        </div>}
        <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); if (cur && add.trim()) { setOpts({ ...opts, [cur.key]: [...(opts[cur.key] ?? []), add.trim()] }); setAdd(""); } }}>
          <input className="input" placeholder="New option, e.g. Music video, Song, Challenge" aria-label="New option" value={add} onChange={(e) => setAdd(e.target.value)} />
          <button className="btn">Add</button>
        </form>
        <div><button className="btn btn-primary" disabled={pending} onClick={async () => { if (await run(updateSettingsAction({ options: opts }), "Option lists saved")) router.refresh(); }}>Save option lists</button></div>
      </div>
    </section>
  );
}

export function CustomFieldSettings({ defs, entities }: { defs: CustomFieldDefShape[]; entities: EntityMeta[] }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [n, setN] = useState({ entity: "scenes", label: "", type: "text" as CustomFieldDefShape["type"], options: "", required: false, showInList: true, help: "" });
  const label = (k: string) => entities.find((e) => e.key === k)?.plural ?? k;
  return (
    <section className="panel" aria-label="Custom fields">
      <div className="panel-head"><h2>Custom fields</h2><span className="subtle" style={{ fontSize: 12 }}>Add fields to any record type. They appear in forms, grids, filters and CSV exports.</span></div>
      <form className="panel-body form-grid" onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(createFieldDefAction({ ...n, options: n.options.split(",").map((x) => x.trim()).filter(Boolean), help: n.help || null }), "Custom field added");
        if (r) { setN({ ...n, label: "", options: "", help: "" }); router.refresh(); }
      }}>
        <div className="field"><label htmlFor="cf-entity">Record type</label><select id="cf-entity" className="select" value={n.entity} onChange={(e) => setN({ ...n, entity: e.target.value })}>{entities.map((e) => <option key={e.key} value={e.key}>{e.plural}</option>)}</select></div>
        <div className="field"><label htmlFor="cf-label">Field name</label><input id="cf-label" className="input" required value={n.label} onChange={(e) => setN({ ...n, label: e.target.value })} placeholder="e.g. Song BPM, Guest booker, Brand safety" /></div>
        <div className="field"><label htmlFor="cf-type">Type</label><select id="cf-type" className="select" value={n.type} onChange={(e) => setN({ ...n, type: e.target.value as CustomFieldDefShape["type"] })}>{CUSTOM_FIELD_TYPES.map((t) => <option key={t} value={t}>{t === "select" ? "choice list" : t === "bool" ? "yes / no" : t}</option>)}</select></div>
        {n.type === "select" && <div className="field"><label htmlFor="cf-options">Choices</label><input id="cf-options" className="input" required value={n.options} onChange={(e) => setN({ ...n, options: e.target.value })} placeholder="Comma separated" /></div>}
        <div className="field"><label htmlFor="cf-help">Help text</label><input id="cf-help" className="input" value={n.help} onChange={(e) => setN({ ...n, help: e.target.value })} /></div>
        <div className="field" style={{ justifyContent: "flex-end" }}><label className="check"><input type="checkbox" checked={n.required} onChange={(e) => setN({ ...n, required: e.target.checked })} /> Required on new records</label><label className="check"><input type="checkbox" checked={n.showInList} onChange={(e) => setN({ ...n, showInList: e.target.checked })} /> Show as grid column</label></div>
        <div className="wide"><button className="btn btn-primary" disabled={pending}><Icon name="plus" /> Add field</button></div>
      </form>
      <ul className="list">
        {defs.map((d) => (
          <li key={d.id}>
            <span className="badge plain">{label(d.entity)}</span>
            <strong style={{ flex: 1 }}>{d.label}<span className="subtle mono" style={{ fontSize: 11, marginLeft: 8 }}>{d.type}{d.type === "select" ? `: ${d.options.join(", ")}` : ""}</span></strong>
            {d.required && <span className="badge tone-warn plain">required</span>}
            <label className="check" style={{ fontSize: 12 }}><input type="checkbox" checked={d.showInList} onChange={(e) => run(updateFieldDefAction(d.id, { showInList: e.target.checked })).then((r) => r !== undefined && router.refresh())} /> column</label>
            {d.type === "select" && <button className="btn btn-sm" onClick={() => { const o = prompt("Choices (comma separated)", d.options.join(", ")); if (o !== null) run(updateFieldDefAction(d.id, { options: o.split(",").map((x) => x.trim()).filter(Boolean) }), "Choices updated").then((r) => r !== undefined && router.refresh()); }}>Edit choices</button>}
            <button className="btn btn-quiet btn-sm btn-danger" onClick={() => confirm(`Remove “${d.label}”? Existing values are kept in history but hidden.`) && run(archiveFieldDefAction(d.id), "Field removed").then((r) => r !== undefined && router.refresh())}>Remove</button>
          </li>
        ))}
        {!defs.length && <li className="subtle">No custom fields yet.</li>}
      </ul>
    </section>
  );
}
