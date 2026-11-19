"use client";
import { FormBody, type FormField } from "./views";
import { submitPublicFormAction } from "@/app/public-actions";

export function PublicForm({ token, form }: { token: string; form: { title: string; description: string; submitLabel?: string; successMessage?: string; color: string; fields: FormField[] } }) {
  return (
    <div className="form-page" style={{ minHeight: "100dvh" }}>
      <div className="form-card">
        <div className="form-band" style={{ background: `var(--color-text-${form.color})` }} />
        <FormBody title={form.title} description={form.description} fields={form.fields} submitLabel={form.submitLabel} successMessage={form.successMessage}
          onSubmit={async (values) => { const r = await submitPublicFormAction(token, values); return r.ok ? null : r.error; }} />
      </div>
      <p style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)", marginTop: 16 }}>Powered by Bang On OS · Never submit passwords through this form.</p>
    </div>
  );
}
