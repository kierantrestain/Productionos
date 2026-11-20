"use client";
import { FormBody, type FormField } from "./views";
import { submitPublicFormAction } from "@/app/public-actions";

export function PublicForm({ token, form, initial }: { token: string; initial?: Record<string, unknown>; form: { title: string; description: string; submitLabel?: string; successMessage?: string; color: string; fields: FormField[]; closed?: boolean; redirectUrl?: string; allowAnother?: boolean } }) {
  return (
    <div className="form-page" style={{ minHeight: "100dvh" }}>
      <div className="form-card">
        <div className="form-band" style={{ background: `var(--color-text-${form.color})` }} />
        {form.closed ? <div style={{ padding: 40, textAlign: "center" }}><h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{form.title}</h1><p>This form is closed and is no longer accepting responses.</p></div> :
        <FormBody title={form.title} description={form.description} fields={form.fields} submitLabel={form.submitLabel} successMessage={form.successMessage} initial={initial} redirectUrl={form.redirectUrl} allowAnother={form.allowAnother} uploadUrl={`/api/forms/${token}/upload`}
          onSubmit={async (values) => { const r = await submitPublicFormAction(token, values); return r.ok ? null : r.error; }} />}
      </div>
      <p style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)", marginTop: 16 }}>Powered by Bang On OS · Never submit passwords through this form.</p>
    </div>
  );
}
