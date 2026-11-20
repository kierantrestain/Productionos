"use client";
import { Trash2, Plus } from "lucide-react";
import { APP_ROLES, type AppConfig, type ButtonAction, type Component, type Cond, type Page, type Role } from "@/lib/apps/types";
import { operatorsFor, type FieldDefLite } from "@/lib/platform/fields";
import { ConditionList } from "@/components/platform/toolbar";
import { KPI_ICONS } from "@/components/apps/renderer";
import { PAGE_ICON_NAMES } from "@/components/apps/shell";
import type { ClientField } from "@/components/platform/types";

export type Meta = { baseName: string; tables: { id: string; name: string; primaryFieldId: string | null }[]; fields: (FieldDefLite & { tableId: string })[]; views: { id: string; name: string; tableId: string }[]; automations: { id: string; name: string }[] };

function Field({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) { return <div className="bd-field"><label htmlFor={htmlFor}>{label}</label>{children}</div>; }
const asClient = (fs: (FieldDefLite & { tableId: string })[]): ClientField[] => fs.map((f) => ({ ...f, editable: true, isPrimary: false }));

export function Roles({ value, onChange }: { value?: Role[]; onChange: (r: Role[]) => void }) {
  const v = value ?? [];
  return (
    <div>
      <div className="bd-chips">{APP_ROLES.map((r) => <button key={r} type="button" className={`bd-chip ${v.includes(r) ? "on" : ""}`} aria-pressed={v.includes(r)} onClick={() => onChange(v.includes(r) ? v.filter((x) => x !== r) : [...v, r])}>{r}</button>)}</div>
      <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 6 }}>{v.length ? "Only these roles (and higher workspace roles) see it." : "Everyone who can open the app sees it."} Enforced on the server.</p>
    </div>
  );
}

export function ComponentInspector({ comp, page, config, meta, onChange, tab }: { comp: Component; page: Page; config: AppConfig; meta: Meta; onChange: (c: Component) => void; tab: "props" | "data" | "visibility" }) {
  const p = comp.props;
  const set = (patch: Partial<Component["props"]>) => onChange({ ...comp, props: { ...p, ...patch } });
  const tableId = comp.type === "record" ? page.tableId : p.data?.tableId;
  const fields = meta.fields.filter((f) => f.tableId === tableId);
  const numeric = fields.filter((f) => ["number", "currency", "percent", "rating", "duration", "count", "rollup", "formula", "autonumber"].includes(f.type));
  const groupable = fields.filter((f) => ["singleSelect", "multipleSelects", "checkbox", "user", "singleLineText", "date", "dateTime", "createdTime", "link", "formula", "lookup"].includes(f.type));
  const selects = fields.filter((f) => f.type === "singleSelect");
  const links = fields.filter((f) => f.type === "link");
  const detailPages = config.pages.filter((x) => x.kind === "detail" && x.tableId === tableId);
  const setData = (patch: Partial<NonNullable<Component["props"]["data"]>>) => set({ data: { ...(p.data ?? { tableId: "" }), ...patch } as NonNullable<Component["props"]["data"]> });
  const id = (s: string) => `${comp.id}-${s}`;

  if (tab === "visibility") return <Field label="Visible to"><Roles value={comp.visibleTo} onChange={(r) => onChange({ ...comp, visibleTo: r })} /></Field>;

  if (tab === "props") return (
    <>
      <Field label="Width" htmlFor={id("w")}>
        <select id={id("w")} className="bd-input" value={comp.w} onChange={(e) => onChange({ ...comp, w: Number(e.target.value) })}>{[3, 4, 6, 8, 9, 12].map((n) => <option key={n} value={n}>{n === 12 ? "Full width" : `${n} of 12 columns (${Math.round((n / 12) * 100)}%)`}</option>)}</select>
      </Field>
      {["heading", "kpi", "chart", "table", "kanban", "activity", "form"].includes(comp.type) && <Field label="Title" htmlFor={id("t")}><input id={id("t")} className="bd-input" value={p.title ?? ""} onChange={(e) => set({ title: e.target.value })} /></Field>}
      {["heading", "chart", "table", "kanban", "form"].includes(comp.type) && <Field label="Subtitle" htmlFor={id("st")}><input id={id("st")} className="bd-input" value={p.subtitle ?? ""} onChange={(e) => set({ subtitle: e.target.value })} /></Field>}
      {comp.type === "text" && <Field label="Text" htmlFor={id("tx")}><textarea id={id("tx")} className="bd-input" rows={5} value={p.text ?? ""} onChange={(e) => set({ text: e.target.value })} /></Field>}
      {comp.type === "kpi" && <>
        <Field label="Icon" htmlFor={id("ic")}><select id={id("ic")} className="bd-input" value={p.icon ?? "layers"} onChange={(e) => set({ icon: e.target.value })}>{Object.keys(KPI_ICONS).map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
      </>}
      {(comp.type === "kpi" || comp.type === "chart") && <Field label="Number format" htmlFor={id("fm")}><select id={id("fm")} className="bd-input" value={p.format ?? "number"} onChange={(e) => set({ format: e.target.value as Component["props"]["format"] })}><option value="number">Number</option><option value="currency">Currency</option><option value="percent">Percent</option><option value="days">Days</option></select></Field>}
      {comp.type === "chart" && <Field label="Chart type" htmlFor={id("ct")}><select id={id("ct")} className="bd-input" value={p.chart ?? "bar"} onChange={(e) => set({ chart: e.target.value as "bar" })}><option value="bar">Bar</option><option value="line">Line</option><option value="donut">Donut</option></select></Field>}
      {comp.type === "form" && <>
        <Field label="Submit label" htmlFor={id("sl")}><input id={id("sl")} className="bd-input" value={p.submitLabel ?? ""} onChange={(e) => set({ submitLabel: e.target.value })} /></Field>
        <Field label="Success message" htmlFor={id("sm")}><input id={id("sm")} className="bd-input" value={p.successMessage ?? ""} onChange={(e) => set({ successMessage: e.target.value })} /></Field>
      </>}
      {comp.type === "record" && <>
        <label className="bd-field" style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={!!p.allowEdit} onChange={(e) => set({ allowEdit: e.target.checked })} /> Allow inline editing (editors and up)</label>
        <label className="bd-field" style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={!!p.showRelated} onChange={(e) => set({ showRelated: e.target.checked })} /> Show linked records</label>
        <label className="bd-field" style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={!!p.showComments} onChange={(e) => set({ showComments: e.target.checked })} /> Show comments</label>
      </>}
      {comp.type === "button" && <ButtonInspector comp={comp} config={config} meta={meta} page={page} set={set} />}
    </>
  );

  // Data tab
  if (["heading", "text", "divider", "button"].includes(comp.type)) return <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>This component doesn&apos;t use data.</p>;
  if (comp.type === "record") return <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Shows the record this detail page is opened with ({meta.tables.find((t) => t.id === page.tableId)?.name ?? "choose the page's table in page settings"}).</p>;
  return (
    <>
      <Field label="Data source" htmlFor={id("tb")}>
        <select id={id("tb")} className="bd-input" value={p.data?.tableId ?? ""} onChange={(e) => set({ data: e.target.value ? { tableId: e.target.value } : undefined, fieldId: undefined, groupFieldId: undefined, fieldIds: [] })}>
          <option value="">Choose a table…</option>{meta.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      {tableId && <>
        <Field label="Records from view" htmlFor={id("vw")}><select id={id("vw")} className="bd-input" value={p.data?.viewId ?? ""} onChange={(e) => setData({ viewId: e.target.value || undefined })}><option value="">All records</option>{meta.views.filter((v) => v.tableId === tableId).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        <Field label="Filter">
          <ConditionList fields={asClient(fields)} conds={p.data?.filter?.conditions ?? []} onChange={(c: Cond[]) => setData({ filter: { conjunction: "and", conditions: c } })} />
          <button type="button" className="bd-chip" onClick={() => setData({ filter: { conjunction: "and", conditions: [...(p.data?.filter?.conditions ?? []), { fieldId: fields[0]?.id ?? "", op: operatorsFor(fields[0]?.type ?? "singleLineText")[0].op }] } })}><Plus size={11} /> Add condition</button>
        </Field>
        {page.kind === "detail" && links.length > 0 && <Field label="Only records linked to this page's record via" htmlFor={id("rl")}>
          <select id={id("rl")} className="bd-input" value={p.data?.relationFieldId ?? ""} onChange={(e) => setData({ relationFieldId: e.target.value || undefined })}><option value="">Not related</option>{links.filter((f) => f.options.linkedTableId === page.tableId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        </Field>}
        {config.portal && <Field label="Clients only see their own rows via" htmlFor={id("sc")}>
          <select id={id("sc")} className="bd-input" value={p.data?.scopeLinkFieldId ?? ""} onChange={(e) => setData({ scopeLinkFieldId: e.target.value || undefined })}><option value="">{p.data?.tableId === config.portal.tableId ? "(the client table itself)" : "Not available to clients"}</option>{links.filter((f) => f.options.linkedTableId === config.portal!.tableId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        </Field>}
        <Field label="Sort" htmlFor={id("so")}>
          <div style={{ display: "flex", gap: 6 }}>
            <select id={id("so")} className="bd-input" value={p.data?.sortFieldId ?? ""} onChange={(e) => setData({ sortFieldId: e.target.value || undefined })}><option value="">{comp.type === "activity" ? "Newest first" : "Default order"}</option>{fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            <select aria-label="Direction" className="bd-input" style={{ width: 90 }} value={p.data?.sortDir ?? "asc"} onChange={(e) => setData({ sortDir: e.target.value as "asc" })}><option value="asc">Asc</option><option value="desc">Desc</option></select>
          </div>
        </Field>
        {(comp.type === "kpi" || comp.type === "chart") && <Field label="Aggregation" htmlFor={id("ag")}>
          <div style={{ display: "flex", gap: 6 }}>
            <select id={id("ag")} className="bd-input" value={p.agg ?? "count"} onChange={(e) => set({ agg: e.target.value as "count" })}><option value="count">Count</option><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Min</option><option value="max">Max</option></select>
            {p.agg && p.agg !== "count" && <select aria-label="Of field" className="bd-input" value={p.fieldId ?? ""} onChange={(e) => set({ fieldId: e.target.value })}><option value="">Of…</option>{numeric.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>}
          </div>
        </Field>}
        {comp.type === "chart" && <Field label={p.chart === "line" ? "Over time (date field)" : "Group by"} htmlFor={id("gb")}>
          <div style={{ display: "flex", gap: 6 }}>
            <select id={id("gb")} className="bd-input" value={p.groupFieldId ?? ""} onChange={(e) => set({ groupFieldId: e.target.value })}><option value="">Choose…</option>{groupable.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            {fields.find((f) => f.id === p.groupFieldId && ["date", "dateTime", "createdTime"].includes(f.type)) && <select aria-label="Per" className="bd-input" style={{ width: 100 }} value={p.dateUnit ?? "month"} onChange={(e) => set({ dateUnit: e.target.value as "month" })}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select>}
          </div>
        </Field>}
        {comp.type === "kanban" && <Field label="Columns (single select)" htmlFor={id("kg")}><select id={id("kg")} className="bd-input" value={p.groupFieldId ?? ""} onChange={(e) => set({ groupFieldId: e.target.value })}><option value="">Choose…</option>{selects.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>}
        {comp.type === "activity" && <>
          <Field label="Title field" htmlFor={id("tf")}><select id={id("tf")} className="bd-input" value={p.titleFieldId ?? ""} onChange={(e) => set({ titleFieldId: e.target.value || undefined })}><option value="">Primary field</option>{fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
          <Field label="Subtitle field" htmlFor={id("sf")}><select id={id("sf")} className="bd-input" value={p.subtitleFieldId ?? ""} onChange={(e) => set({ subtitleFieldId: e.target.value || undefined })}><option value="">None</option>{fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
        </>}
        {["table", "kanban", "form"].includes(comp.type) && <Field label={comp.type === "form" ? "Form fields (in order)" : "Fields shown"}>
          <div className="bd-chips">{fields.filter((f) => comp.type !== "form" || !["lookup", "rollup", "count", "formula", "autonumber", "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy", "link", "user", "attachment", "button", "aiText"].includes(f.type)).map((f) => { const on = p.fieldIds?.includes(f.id); return <button key={f.id} type="button" className={`bd-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => set({ fieldIds: on ? p.fieldIds!.filter((x) => x !== f.id) : [...(p.fieldIds ?? []), f.id] })}>{f.name}</button>; })}</div>
        </Field>}
        {comp.type === "form" && (p.fieldIds?.length ?? 0) > 0 && <Field label="Required & conditional">
          {p.fieldIds!.map((fid) => { const f = fields.find((x) => x.id === fid); if (!f) return null; const cond = p.conditional?.[fid]; return (
            <div key={fid} style={{ borderTop: "1px solid var(--color-border)", padding: "6px 0", fontSize: 13 }}>
              <label style={{ display: "flex", gap: 6 }}><input type="checkbox" checked={!!p.required?.includes(fid)} onChange={(e) => set({ required: e.target.checked ? [...(p.required ?? []), fid] : (p.required ?? []).filter((x) => x !== fid) })} />{f.name} required</label>
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                <select aria-label={`Show ${f.name} when`} className="bd-input" value={cond?.fieldId ?? ""} onChange={(e) => set({ conditional: { ...(p.conditional ?? {}), [fid]: e.target.value ? { fieldId: e.target.value, op: "isNotEmpty" } : undefined! } })}><option value="">Always shown</option>{p.fieldIds!.filter((x) => x !== fid).map((x) => <option key={x} value={x}>Show when {fields.find((y) => y.id === x)?.name}…</option>)}</select>
                {cond && <select aria-label="Condition" className="bd-input" value={cond.op} onChange={(e) => set({ conditional: { ...p.conditional, [fid]: { ...cond, op: e.target.value } } })}><option value="isNotEmpty">is filled</option><option value="isChecked">is checked</option><option value="is">equals…</option></select>}
                {cond?.op === "is" && <input aria-label="Value" className="bd-input" value={String(cond.value ?? "")} onChange={(e) => set({ conditional: { ...p.conditional, [fid]: { ...cond, value: e.target.value } } })} placeholder="value / option id" />}
              </div>
            </div>
          ); })}
        </Field>}
        {["table", "kanban", "activity"].includes(comp.type) && <>
          <Field label="Rows shown" htmlFor={id("lm")}><input id={id("lm")} type="number" min={1} max={200} className="bd-input" value={p.limit ?? 25} onChange={(e) => set({ limit: Number(e.target.value) })} /></Field>
          <Field label="Clicking a row opens" htmlFor={id("dp")}><select id={id("dp")} className="bd-input" value={p.detailPageId ?? ""} onChange={(e) => set({ detailPageId: e.target.value || undefined })}><option value="">Nothing</option>{detailPages.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>{!detailPages.length && <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Add a detail page for this table in Pages.</span>}</Field>
        </>}
        {comp.type === "kanban" && <label className="bd-field" style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={!!p.allowMove} onChange={(e) => set({ allowMove: e.target.checked })} /> Drag cards between columns (editors)</label>}
      </>}
    </>
  );
}

function ButtonInspector({ comp, config, meta, page, set }: { comp: Component; config: AppConfig; meta: Meta; page: Page; set: (p: Partial<Component["props"]>) => void }) {
  const a: ButtonAction = comp.props.action ?? { kind: "navigate" };
  const setA = (patch: Partial<ButtonAction>) => set({ action: { ...a, ...patch } });
  const tid = a.kind === "update_record" ? page.tableId : a.tableId;
  const fields = meta.fields.filter((f) => f.tableId === tid && !["lookup", "rollup", "count", "formula", "autonumber", "link", "user", "attachment", "button", "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy"].includes(f.type));
  const vals = a.values ?? {};
  return (
    <>
      <Field label="Label" htmlFor={`${comp.id}-lb`}><input id={`${comp.id}-lb`} className="bd-input" value={comp.props.label ?? ""} onChange={(e) => set({ label: e.target.value })} /></Field>
      <Field label="Style" htmlFor={`${comp.id}-vr`}><select id={`${comp.id}-vr`} className="bd-input" value={comp.props.variant ?? "primary"} onChange={(e) => set({ variant: e.target.value as "primary" })}><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="danger">Danger</option></select></Field>
      <Field label="When clicked" htmlFor={`${comp.id}-ak`}>
        <select id={`${comp.id}-ak`} className="bd-input" value={a.kind} onChange={(e) => set({ action: { kind: e.target.value as ButtonAction["kind"] } })}>
          <option value="navigate">Go to a page</option><option value="create_record">Create a record</option><option value="update_record">Update this page&apos;s record</option><option value="run_automation">Run an automation on this record</option><option value="open_url">Open a link</option>
        </select>
      </Field>
      {a.kind === "navigate" && <Field label="Page" htmlFor={`${comp.id}-pg`}><select id={`${comp.id}-pg`} className="bd-input" value={a.pageId ?? ""} onChange={(e) => setA({ pageId: e.target.value })}><option value="">Choose…</option>{config.pages.map((x) => <option key={x.id} value={x.id}>{x.title}{x.kind === "detail" ? " (detail)" : ""}</option>)}</select></Field>}
      {a.kind === "open_url" && <Field label="URL (https)" htmlFor={`${comp.id}-url`}><input id={`${comp.id}-url`} className="bd-input" value={a.url ?? ""} onChange={(e) => setA({ url: e.target.value })} placeholder="https://" /></Field>}
      {a.kind === "run_automation" && <Field label="Automation" htmlFor={`${comp.id}-au`}><select id={`${comp.id}-au`} className="bd-input" value={a.automationId ?? ""} onChange={(e) => setA({ automationId: e.target.value })}><option value="">Choose…</option>{meta.automations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
      {a.kind === "create_record" && <Field label="In table" htmlFor={`${comp.id}-ct`}><select id={`${comp.id}-ct`} className="bd-input" value={a.tableId ?? ""} onChange={(e) => setA({ tableId: e.target.value, values: {} })}><option value="">Choose…</option>{meta.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
      {(a.kind === "create_record" || a.kind === "update_record") && tid && <Field label="Set values ({Field} copies from this page's record)">
        {Object.entries(vals).map(([fid, v]) => (
          <div key={fid} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <span className="bd-chip on" style={{ whiteSpace: "nowrap" }}>{fields.find((f) => f.id === fid)?.name ?? "?"}</span>
            <input aria-label="Value" className="bd-input" value={String(v ?? "")} onChange={(e) => setA({ values: { ...vals, [fid]: e.target.value } })} />
            <button type="button" className="bd-chip" aria-label="Remove" onClick={() => { const n = { ...vals }; delete n[fid]; setA({ values: n }); }}><Trash2 size={11} /></button>
          </div>
        ))}
        <select aria-label="Add a value" className="bd-input" value="" onChange={(e) => e.target.value && setA({ values: { ...vals, [e.target.value]: "" } })}><option value="">+ Set a field…</option>{fields.filter((f) => !(f.id in vals)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      </Field>}
      <Field label="Ask for confirmation (optional)" htmlFor={`${comp.id}-cf`}><input id={`${comp.id}-cf`} className="bd-input" value={a.confirm ?? ""} onChange={(e) => setA({ confirm: e.target.value || undefined })} placeholder="e.g. Mark this deal as won?" /></Field>
    </>
  );
}

export function PageInspector({ page, config, meta, onChange, onDelete }: { page: Page; config: AppConfig; meta: Meta; onChange: (p: Page) => void; onDelete: () => void }) {
  const set = (patch: Partial<Page>) => onChange({ ...page, ...patch });
  const links = meta.fields.filter((f) => f.tableId === page.tableId && f.type === "link" && f.options.linkedTableId === config.portal?.tableId);
  return (
    <>
      <Field label="Page title" htmlFor="pg-t"><input id="pg-t" className="bd-input" value={page.title} onChange={(e) => set({ title: e.target.value })} /></Field>
      <Field label="Heading (defaults to title)" htmlFor="pg-h"><input id="pg-h" className="bd-input" value={page.heading ?? ""} onChange={(e) => set({ heading: e.target.value || undefined })} /></Field>
      <Field label="Subtitle" htmlFor="pg-st"><input id="pg-st" className="bd-input" value={page.subtitle ?? ""} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
      <Field label="URL name" htmlFor="pg-s"><input id="pg-s" className="bd-input" value={page.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 48) })} /></Field>
      <Field label="Icon" htmlFor="pg-i"><select id="pg-i" className="bd-input" value={page.icon ?? "dashboard"} onChange={(e) => set({ icon: e.target.value })}>{PAGE_ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
      <Field label="Page type" htmlFor="pg-k"><select id="pg-k" className="bd-input" value={page.kind} onChange={(e) => set({ kind: e.target.value as Page["kind"], hidden: e.target.value === "detail" ? true : page.hidden })}><option value="dashboard">Page</option><option value="detail">Record detail (opens one record)</option></select></Field>
      {page.kind === "detail" && <Field label="Record table" htmlFor="pg-tb"><select id="pg-tb" className="bd-input" value={page.tableId ?? ""} onChange={(e) => set({ tableId: e.target.value })}><option value="">Choose…</option>{meta.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
      {page.kind === "detail" && config.portal && page.tableId && page.tableId !== config.portal.tableId && <Field label="Clients may open records linked to them via" htmlFor="pg-sl"><select id="pg-sl" className="bd-input" value={page.scopeLinkFieldId ?? ""} onChange={(e) => set({ scopeLinkFieldId: e.target.value || undefined })}><option value="">Not available to clients</option>{links.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>}
      {page.kind !== "detail" && <Field label="Nest under" htmlFor="pg-p"><select id="pg-p" className="bd-input" value={page.parentId ?? ""} onChange={(e) => set({ parentId: e.target.value || undefined })}><option value="">Top level</option>{config.pages.filter((x) => x.id !== page.id && x.kind !== "detail" && !x.parentId).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>}
      {page.kind !== "detail" && <label className="bd-field" style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={!!page.hidden} onChange={(e) => set({ hidden: e.target.checked })} /> Hide from navigation</label>}
      <Field label="Who can open this page"><Roles value={page.visibleTo} onChange={(r) => set({ visibleTo: r })} /></Field>
      <button type="button" className="bd-chip" style={{ color: "var(--color-text-red)" }} onClick={onDelete} disabled={config.pages.length <= 1}><Trash2 size={11} /> Delete page</button>
    </>
  );
}
