"use client";
import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@/components/ui/modal";
import { Button } from "@astryxdesign/core/Button";
import { Trash2, Plus } from "lucide-react";
import { COLORS, FIELD_META, FIELD_TYPES, ROLLUP_FNS, newChoiceId, type FieldOptions, type FieldType, type SelectChoice } from "@/lib/platform/fields";
import { FUNCTION_NAMES, toDisplay } from "@/lib/platform/formula";
import { createFieldAction, listAutomationsAction, previewFieldChangeAction, updateFieldAction } from "@/app/platform-actions";
import { FieldIcon } from "./icons";
import type { BaseData, ClientField } from "./types";

const GROUPS: Record<string, string> = { basic: "Basic", choice: "Choices", date: "Date & time", relation: "Relationships", computed: "Calculated", advanced: "Advanced" };
const inp: React.CSSProperties = { width: "100%", height: 34, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-background-surface)", color: "var(--color-text-primary)", font: "inherit", padding: "0 10px" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", margin: "12px 0 4px" };

export function FieldDialog({ data, field, afterFieldId, onClose, onSaved }: { data: BaseData; field: ClientField | null; afterFieldId?: string; onClose: () => void; onSaved: () => void }) {
  const editing = !!field;
  const tableFields = data.baseFields.filter((f) => f.tableId === data.table.id);
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<FieldType>(field?.type ?? "singleLineText");
  const [description, setDescription] = useState(field?.description ?? "");
  const [o, setO] = useState<FieldOptions>(() => {
    const opts = { ...(field?.options ?? {}) };
    if (opts.formula) opts.formula = toDisplay(opts.formula, data.baseFields);
    return opts;
  });
  const [perm, setPerm] = useState({ edit: field?.permissions?.edit ?? "", hiddenBelow: field?.permissions?.hiddenBelow ?? "" });
  const [err, setErr] = useState("");
  const set = (p: Partial<FieldOptions>) => setO((x) => ({ ...x, ...p }));
  const linkFields = tableFields.filter((f) => f.type === "link" && f.id !== field?.id);
  const linkedTableOf = (linkFieldId?: string) => data.allFields.find((f) => f.id === linkFieldId)?.options.linkedTableId;
  const targetFields = data.baseFields.filter((f) => f.tableId === linkedTableOf(o.linkFieldId));
  const [fnQ, setFnQ] = useState("");
  const fnList = useMemo(() => FUNCTION_NAMES.filter((n) => n.toLowerCase().includes(fnQ.toLowerCase())).slice(0, 40), [fnQ]);

  const choices = o.choices ?? [];
  const setChoices = (c: SelectChoice[]) => set({ choices: c });

  const [impact, setImpact] = useState<{ converted: number; cleared: number; unchanged: number; empty: number; addedChoices: string[]; examples: { before: string; after: string }[] } | null>(null);
  const removedChoices = editing && (field!.type === "singleSelect" || field!.type === "multipleSelects") && (field!.options.choices ?? []).some((c) => !choices.some((x) => x.id === c.id));
  const risky = editing && (type !== field!.type || removedChoices);
  const save = async () => {
    setErr("");
    const options: FieldOptions = { ...o };
    if (type === "singleSelect" || type === "multipleSelects") options.choices = choices.filter((c) => c.name.trim());
    if (risky && !impact) {
      // Show what will happen to existing values before changing anything.
      const p = await previewFieldChangeAction(field!.id, { ...(type !== field!.type ? { type } : {}), options });
      if (!p.ok) { setErr(p.error); return; }
      if (p.data.converted || p.data.cleared || p.data.addedChoices.length) { setImpact(p.data); return; }
    }
    const permissions = { ...(perm.edit ? { edit: perm.edit } : {}), ...(perm.hiddenBelow ? { hiddenBelow: perm.hiddenBelow } : {}) };
    const r = editing
      ? await updateFieldAction(field!.id, { name, ...(type !== field!.type ? { type } : {}), options, description: description || null, ...(data.can.schema ? { permissions } : {}) })
      : await createFieldAction(data.table.id, { name: name || FIELD_META[type].label, type, options, description: description || null, afterFieldId });
    if (!r.ok) { setErr(r.error); return; }
    if (!editing && (perm.edit || perm.hiddenBelow) && r.data?.id) await updateFieldAction(r.data.id, { permissions });
    onSaved();
  };

  const typeLocked = editing && field!.type === "link";

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} width={560} padding={6} purpose="form">
      <div style={{ display: "block", flex: "none" }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>{editing ? `Edit “${field!.name}”` : "Add a field"}</h2>
      <label style={lbl} htmlFor="fd-name">Field name</label>
      <input id="fd-name" autoFocus style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder={FIELD_META[type].label} />
      <label style={lbl} htmlFor="fd-type">Field type</label>
      <select id="fd-type" style={inp} value={type} disabled={editing && field!.type === "link"} onChange={(e) => setType(e.target.value as FieldType)}>
        {Object.entries(GROUPS).map(([g, gl]) => (
          <optgroup key={g} label={gl}>{FIELD_TYPES.filter((t) => FIELD_META[t].group === g && !(field?.isPrimary && ["link", "lookup", "rollup", "count", "attachment", "button"].includes(t))).map((t) => <option key={t} value={t}>{FIELD_META[t].label}</option>)}</optgroup>
        ))}
      </select>
      <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}><FieldIcon type={type} />{FIELD_META[type].description}{typeLocked && " · link fields can't change type"}</p>
      {editing && type !== field!.type && <p style={{ fontSize: 12, color: "var(--color-text-orange)", marginTop: 4 }}>Existing values will be converted. Values that can&apos;t be converted are cleared — the record history keeps the old values.</p>}

      {(type === "singleSelect" || type === "multipleSelects") && (
        <>
          <label style={lbl}>Options</label>
          <div style={{ maxHeight: 220, overflow: "auto" }}>
            {choices.map((c, i) => (
              <div key={c.id} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <select aria-label="Colour" value={c.color} onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, color: e.target.value as SelectChoice["color"] } : x)))} className={`chip ${c.color}`} style={{ height: 34, border: 0, borderRadius: 6, width: 90 }}>{COLORS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
                <input aria-label={`Option ${i + 1}`} style={inp} value={c.name} onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <button type="button" className="p-tbtn" aria-label="Remove option" onClick={() => setChoices(choices.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <button type="button" className="p-tbtn" onClick={() => setChoices([...choices, { id: newChoiceId(), name: "", color: COLORS[choices.length % COLORS.length] }])}><Plus size={14} />Add option</button>
        </>
      )}
      {(type === "number" || type === "currency" || type === "percent") && (
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label style={lbl} htmlFor="fd-prec">Decimal places</label><select id="fd-prec" style={inp} value={o.precision ?? (type === "currency" ? 2 : 0)} onChange={(e) => set({ precision: Number(e.target.value) })}>{[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
          {type === "currency" && <div style={{ flex: 1 }}><label style={lbl} htmlFor="fd-sym">Symbol</label><input id="fd-sym" style={inp} value={o.symbol ?? "£"} maxLength={4} onChange={(e) => set({ symbol: e.target.value })} /></div>}
        </div>
      )}
      {type === "rating" && <><label style={lbl} htmlFor="fd-max">Maximum</label><select id="fd-max" style={inp} value={o.max ?? 5} onChange={(e) => set({ max: Number(e.target.value) })}>{[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select></>}
      {type === "date" && <label style={{ ...lbl, display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}><input type="checkbox" checked={!!o.includeTime} onChange={(e) => set({ includeTime: e.target.checked })} />Include a time</label>}
      {type === "link" && (
        <>
          <label style={lbl} htmlFor="fd-lt">Link to table</label>
          <select id="fd-lt" style={inp} disabled={editing} value={o.linkedTableId ?? ""} onChange={(e) => set({ linkedTableId: e.target.value })}><option value="">Choose a table…</option>{data.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <label style={{ ...lbl, display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}><input type="checkbox" checked={!!o.singleRecord} onChange={(e) => set({ singleRecord: e.target.checked })} />Allow linking to only one record</label>
          {!editing && <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>A matching link field is added to the other table automatically, and both stay in sync.</p>}
        </>
      )}
      {(type === "lookup" || type === "rollup" || type === "count") && (
        linkFields.length ? <>
          <label style={lbl} htmlFor="fd-via">Through link field</label>
          <select id="fd-via" style={inp} value={o.linkFieldId ?? ""} onChange={(e) => set({ linkFieldId: e.target.value, targetFieldId: undefined })}><option value="">Choose…</option>{linkFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          {type !== "count" && o.linkFieldId && <>
            <label style={lbl} htmlFor="fd-tgt">{type === "lookup" ? "Field to look up" : "Field to summarise"}</label>
            <select id="fd-tgt" style={inp} value={o.targetFieldId ?? ""} onChange={(e) => set({ targetFieldId: e.target.value })}><option value="">Choose…</option>{targetFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          </>}
          {type === "rollup" && <><label style={lbl} htmlFor="fd-fn">Aggregation</label><select id="fd-fn" style={inp} value={o.rollupFn ?? "sum"} onChange={(e) => set({ rollupFn: e.target.value as FieldOptions["rollupFn"] })}>{ROLLUP_FNS.map((f) => <option key={f} value={f}>{f}</option>)}</select></>}
        </> : <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 10 }}>Add a link field to this table first — {FIELD_META[type].label.toLowerCase()} fields read values through a link.</p>
      )}
      {type === "formula" && (
        <>
          <label style={lbl} htmlFor="fd-formula">Formula</label>
          <textarea id="fd-formula" className="p-textarea mono" rows={4} value={o.formula ?? ""} onChange={(e) => set({ formula: e.target.value })} placeholder="IF({Budget} > 0, {Spent} / {Budget}, BLANK())" />
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>Fields (click to insert)</div>
              <div style={{ maxHeight: 110, overflow: "auto", display: "flex", flexWrap: "wrap", gap: 4 }}>{tableFields.filter((f) => f.id !== field?.id).map((f) => <button key={f.id} type="button" className="chip" style={{ border: 0, cursor: "pointer" }} onClick={() => set({ formula: `${o.formula ?? ""}{${f.name}}` })}>{f.name}</button>)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <input aria-label="Find a function" placeholder="Find a function" value={fnQ} onChange={(e) => setFnQ(e.target.value)} style={{ ...inp, height: 26, fontSize: 12 }} />
              <div style={{ maxHeight: 84, overflow: "auto", display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>{fnList.map((n) => <button key={n} type="button" className="chip mono" style={{ border: 0, cursor: "pointer" }} onClick={() => set({ formula: `${o.formula ?? ""}${n}(` })}>{n}</button>)}</div>
            </div>
          </div>
        </>
      )}
      {type === "aiText" && (
        <>
          <label style={lbl} htmlFor="fd-prompt">Prompt</label>
          <textarea id="fd-prompt" className="p-textarea" rows={4} value={o.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value })} placeholder="Write a one-line logline for {Name}, a {Genre} project, using {Notes}." />
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Reference fields with {"{Field name}"}. Text is generated on request per record (sparkle button, or the field menu → Generate). {data.aiConfigured ? "" : "AI isn't configured for this workspace yet."}</p>
        </>
      )}
      {type === "button" && <ButtonConfig data={data} o={o} set={set} />}

      <label style={lbl} htmlFor="fd-desc">Description</label>
      <input id="fd-desc" style={inp} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Help collaborators fill this in" />

      {data.can.schema && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Field permissions</summary>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lbl} htmlFor="fd-pe">Who can edit</label><select id="fd-pe" style={inp} value={perm.edit} onChange={(e) => setPerm({ ...perm, edit: e.target.value })}><option value="">Editors and up (default)</option><option value="creator">Creators and up</option><option value="owner">Owners only</option></select></div>
            <div style={{ flex: 1 }}><label style={lbl} htmlFor="fd-ph">Who can see</label><select id="fd-ph" style={inp} value={perm.hiddenBelow} onChange={(e) => setPerm({ ...perm, hiddenBelow: e.target.value })}><option value="">Everyone with access</option><option value="commenter">Commenters and up</option><option value="editor">Editors and up</option><option value="creator">Creators and up</option><option value="owner">Owners only</option></select></div>
          </div>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 6 }}>Enforced on the server — hidden fields are never sent to people below the chosen role, including in exports and the API.</p>
        </details>
      )}
      {impact && (
        <div role="status" className="p-basecard" style={{ display: "block", marginTop: 14, borderColor: impact.cleared ? "var(--color-text-orange)" : undefined }}>
          <strong style={{ fontSize: 13 }}>Impact on existing records</strong>
          <ul style={{ margin: "6px 0 0 18px", fontSize: 13 }}>
            <li>{impact.converted} value{impact.converted === 1 ? "" : "s"} will be converted</li>
            {impact.cleared > 0 && <li style={{ color: "var(--color-text-orange)" }}>{impact.cleared} value{impact.cleared === 1 ? "" : "s"} can&apos;t be represented and will be cleared (kept in record history)</li>}
            <li>{impact.unchanged + impact.empty} unchanged</li>
            {impact.addedChoices.length > 0 && <li>{impact.addedChoices.length} new option{impact.addedChoices.length === 1 ? "" : "s"}: {impact.addedChoices.slice(0, 8).join(", ")}{impact.addedChoices.length > 8 ? "…" : ""}</li>}
          </ul>
          {impact.examples.length > 0 && <table style={{ fontSize: 12, marginTop: 6 }}><tbody>{impact.examples.map((x, i) => <tr key={i}><td style={{ paddingRight: 8, color: "var(--color-text-secondary)" }}>{x.before}</td><td>→ {x.after}</td></tr>)}</tbody></table>}
          <button type="button" className="p-tbtn" style={{ marginTop: 6 }} onClick={() => setImpact(null)}>Change settings</button>
        </div>
      )}
      {err && <p style={{ color: "var(--color-text-error)", marginTop: 12 }}>{err}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Button label="Cancel" onClick={onClose} />
        <Button label={!editing ? "Create field" : impact ? `Convert ${impact.converted + impact.cleared} value${impact.converted + impact.cleared === 1 ? "" : "s"} and save` : "Save"} variant="primary" clickAction={save} />
      </div>
      </div>
    </Dialog>
  );
}

/** Button field: label + one action (open a URL, update the record, run an automation). */
function ButtonConfig({ data, o, set }: { data: BaseData; o: FieldOptions; set: (p: Partial<FieldOptions>) => void }) {
  const [autos, setAutos] = useState<{ id: string; name: string; isEnabled: boolean }[]>([]);
  useEffect(() => { listAutomationsAction(data.base.id).then((r) => { if (r.ok) setAutos(r.data); }); }, [data.base.id]);
  const action = o.action ?? "open_url";
  const values = o.values ?? {};
  const writable = data.allFields.filter((f) => !["link", "user", "attachment", "button", "lookup", "rollup", "count", "formula", "autonumber", "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy"].includes(f.type));
  return (
    <>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}><label style={lbl} htmlFor="fd-bl">Label</label><input id="fd-bl" style={inp} value={o.label ?? ""} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Mark paid" /></div>
        <div style={{ flex: 1 }}><label style={lbl} htmlFor="fd-ba">When clicked</label>
          <select id="fd-ba" style={inp} value={action} onChange={(e) => set({ action: e.target.value as FieldOptions["action"] })}>
            <option value="open_url">Open a URL</option><option value="update_record">Update this record</option><option value="run_automation">Run an automation</option>
          </select></div>
      </div>
      {action === "open_url" && <><label style={lbl} htmlFor="fd-bu">URL — use {"{RECORD_ID}"} or {"{Field name}"}</label><input id="fd-bu" style={inp} value={o.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://maps.google.com/?q={Address}" /></>}
      {action === "update_record" && (
        <div>
          <label style={lbl}>Set these values</label>
          {Object.entries(values).map(([fid, v]) => { const f = data.allFields.find((x) => x.id === fid); return (
            <div key={fid} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <span className="chip" style={{ height: 34, borderRadius: 6, minWidth: 120 }}>{f?.name ?? "?"}</span>
              {f?.type === "singleSelect" ? <select aria-label={f.name} style={inp} value={String(v ?? "")} onChange={(e) => set({ values: { ...values, [fid]: e.target.value } })}><option value="">(clear)</option>{f.options.choices?.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
                : f?.type === "checkbox" ? <select aria-label={f.name} style={inp} value={String(!!v)} onChange={(e) => set({ values: { ...values, [fid]: e.target.value === "true" } })}><option value="true">Checked</option><option value="false">Unchecked</option></select>
                : <input aria-label={f?.name} style={inp} value={String(v ?? "")} onChange={(e) => set({ values: { ...values, [fid]: e.target.value } })} />}
              <button type="button" className="p-tbtn" aria-label="Remove" onClick={() => { const n = { ...values }; delete n[fid]; set({ values: n }); }}><Trash2 size={14} /></button>
            </div>
          ); })}
          <select aria-label="Add a field to set" style={{ ...inp, width: "auto" }} value="" onChange={(e) => e.target.value && set({ values: { ...values, [e.target.value]: "" } })}><option value="">+ Set a field…</option>{writable.filter((f) => !(f.id in values)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        </div>
      )}
      {action === "run_automation" && (
        <>
          <label style={lbl} htmlFor="fd-bauto">Automation</label>
          <select id="fd-bauto" style={inp} value={o.automationId ?? ""} onChange={(e) => set({ automationId: e.target.value || undefined })}>
            <option value="">Choose…</option>{autos.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isEnabled ? "" : " (off)"}</option>)}
          </select>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>Runs that automation&apos;s steps for the clicked record. The clicker needs edit access to the table; outbound steps still wait for approval.</p>
        </>
      )}
    </>
  );
}
