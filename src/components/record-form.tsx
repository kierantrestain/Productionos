"use client";
import { useState } from "react";
import { getEntity } from "@/lib/entities";
import { createRecord, updateRecord } from "@/app/actions";
import { FieldInput, finalise, invalidateRefCache, useRun } from "./client";

/**
 * Generated create/edit form. Fixed values (e.g. productionId from context) are applied and hidden.
 * Read-only/system fields are never sent — the server rejects them anyway.
 */
export function RecordForm({ entity, initial, fixed = {}, onDone, redacted = [], canWrite = true, submitLabel, id }: {
  entity: string; initial?: Record<string, unknown> & { id?: string; version?: number }; fixed?: Record<string, unknown>; onDone?: (row: Record<string, unknown>) => void;
  redacted?: string[]; canWrite?: boolean; submitLabel?: string; id?: string;
}) {
  const d = getEntity(entity)!;
  const { run, pending } = useRun();
  const editing = !!initial?.id;
  const [vals, setVals] = useState<Record<string, unknown>>(() => ({ ...(initial ?? {}), ...fixed }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fields = d.fields.filter((f) => !f.system && !(f.key in fixed) && !redacted.includes(f.key) && (editing || !f.readOnly));
  const productionId = (vals.productionId as string) || (fixed.productionId as string) || undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const f of d.fields) {
      if (f.system || f.readOnly || redacted.includes(f.key)) continue;
      if (!(f.key in vals)) continue;
      const v = finalise(f, vals[f.key]);
      if (editing && JSON.stringify(v) === JSON.stringify(initial?.[f.key])) continue;
      payload[f.key] = v;
    }
    setErrors({});
    const res = editing ? await updateRecord(entity, initial!.id!, payload, initial!.version) : await createRecord(entity, payload);
    if (!res.ok) {
      if (res.details && typeof res.details === "object") setErrors(res.details as Record<string, string>);
      await run(Promise.resolve(res));
      return;
    }
    invalidateRefCache();
    await run(Promise.resolve(res), editing ? "Saved" : `${d.label} created`);
    // The server action already revalidates the route; a second client refresh can swallow a
    // navigation the user starts immediately afterwards.
    onDone?.(res.data);
  }

  return (
    <form id={id} onSubmit={submit} noValidate>
      <fieldset disabled={!canWrite || pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          {fields.map((f) => (
            <div key={f.key} className={`field ${f.type === "textarea" ? "wide" : ""}`}>
              {f.type === "bool" ? (
                <label className="check"><FieldInput f={f} value={vals[f.key]} onChange={(v) => setVals((s) => ({ ...s, [f.key]: v }))} id={`f-${entity}-${f.key}`} /> {f.label}</label>
              ) : (
                <>
                  <label htmlFor={`f-${entity}-${f.key}`}>{f.label}{f.required && <span aria-hidden> *</span>}</label>
                  {f.readOnly ? <div className="muted" style={{ minHeight: 32, display: "flex", alignItems: "center" }}>{String(vals[f.key] ?? "—")}</div>
                    : <FieldInput f={f} value={vals[f.key]} onChange={(v) => setVals((s) => ({ ...s, [f.key]: v }))} productionId={productionId} id={`f-${entity}-${f.key}`} />}
                </>
              )}
              {errors[f.key] && <span className="err" role="alert">{errors[f.key]}</span>}
              {f.help && !errors[f.key] && <span className="help">{f.help}</span>}
            </div>
          ))}
        </div>
        {redacted.length > 0 && <p className="subtle" style={{ marginTop: 12, fontSize: 12 }}>Some restricted fields are hidden for your role.</p>}
        {canWrite && !id && <div className="row" style={{ marginTop: 16 }}><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel ?? (editing ? "Save changes" : `Create ${d.label.toLowerCase()}`)}</button></div>}
      </fieldset>
    </form>
  );
}
