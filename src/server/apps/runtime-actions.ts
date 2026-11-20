/**
 * Writes from app components. The browser only sends (app slug, page id, component id, record id, values);
 * the component's configuration is re-read from the stored app version on the server, so a tampered
 * client can't widen what a component is allowed to do. Workspace users write with their own permissions.
 * Portal visitors may only submit forms, always stamped with their scope link.
 */
import type { ButtonAction, Component } from "@/lib/apps/types";
import { cellText } from "@/lib/platform/cell-text";
import type { Ctx } from "../auth/context";
import { forbidden, invalid } from "../errors";
import { atLeast } from "../platform/access";
import { runView } from "../platform/query";
import { createRecords, updateRecord } from "../platform/records";
import { canSee, findComponent, resolveRuntime } from "./apps";
import { assertRecordInScope, effectiveQuery } from "./data";

async function locate(ctx: Ctx, slug: string, pageId: string, componentId: string, preview: boolean) {
  const rt = await resolveRuntime(ctx, slug, preview);
  const page = rt.config.pages.find((p) => p.id === pageId);
  if (!page || !canSee(rt.role, page.visibleTo)) throw forbidden("Page not available.");
  const comp = findComponent(page, componentId);
  if (!comp || !canSee(rt.role, comp.visibleTo)) throw forbidden("Component not available.");
  return { rt, page, comp };
}
const allowedFields = (comp: Component, values: Record<string, unknown>) => {
  const ids = comp.props.fieldIds ?? [];
  for (const k of Object.keys(values)) if (ids.length && !ids.includes(k)) throw invalid("That field isn't part of this form.");
};

export async function submitAppForm(ctx: Ctx, slug: string, pageId: string, componentId: string, values: Record<string, unknown>, opts: { preview?: boolean; recordId?: string } = {}) {
  const { rt, page, comp } = await locate(ctx, slug, pageId, componentId, !!opts.preview);
  if (comp.type !== "form" || !comp.props.data?.tableId) throw invalid("Not a form.");
  allowedFields(comp, values);
  for (const req of comp.props.required ?? []) if (values[req] === undefined || values[req] === "" || values[req] === null) throw invalid("Please fill in the required fields.");
  const { table } = await effectiveQuery({ ctx, rt, page: { ...page, kind: "blank" } }, comp.props.data);
  const vals = { ...values };
  if (comp.props.data.relationFieldId && page.kind === "detail") {
    if (!opts.recordId) throw invalid("This form needs a record.");
    await assertRecordInScope({ ctx, rt, page }, page.tableId!, opts.recordId);
    vals[comp.props.data.relationFieldId] = [opts.recordId];
  }
  if (comp.props.data.scopeLinkFieldId && rt.scopeIds) {
    if (!rt.scopeIds.length) throw forbidden("Your account isn't linked to a client record yet.");
    vals[comp.props.data.scopeLinkFieldId] = [rt.scopeIds[0]];
  }
  if (rt.role === "portal") {
    if (!comp.props.data.scopeLinkFieldId) throw forbidden("This form isn't available to clients.");
    // Portal visitors have no base access: the write runs as the app's owner, limited to this form's fields
    // and stamped with the visitor's scope; the revision log names the visitor.
    const { contextForUser } = await import("../auth/sessions");
    const owner = rt.app.createdBy ? await contextForUser(rt.app.createdBy, rt.app.orgId) : null;
    if (!owner) throw forbidden("This portal's owner no longer has access.");
    const [id] = await createRecords({ ...owner, name: `${ctx.name} (portal)` }, table.id, [vals], { skipPermission: true, origin: "user" });
    return { id };
  }
  const [id] = await createRecords(ctx, table.id, [vals]);
  return { id };
}

export async function updateFromApp(ctx: Ctx, slug: string, pageId: string, componentId: string, recordId: string, values: Record<string, unknown>, preview = false) {
  const { rt, page, comp } = await locate(ctx, slug, pageId, componentId, preview);
  if (rt.role === "portal") throw forbidden("Clients can't edit records here.");
  const tableId = comp.type === "record" ? page.tableId : comp.props.data?.tableId;
  if (!tableId) throw invalid("Nothing to update.");
  if (comp.type === "kanban") { if (!comp.props.allowMove || Object.keys(values).some((k) => k !== comp.props.groupFieldId)) throw forbidden("Moving cards isn't enabled here."); }
  else if (comp.type === "record") { if (!comp.props.allowEdit) throw forbidden("Editing isn't enabled here."); }
  else if (comp.type === "table") { if (!comp.props.allowEdit) throw forbidden("Editing isn't enabled here."); allowedFields(comp, values); }
  else throw invalid("This component can't edit records.");
  await assertRecordInScope({ ctx, rt, page, recordId }, tableId, recordId);
  await updateRecord(ctx, recordId, values);
  return { ok: true };
}

/** Button actions. navigate/open_url are resolved on the server too, so links can't be retargeted client-side. */
export async function runButton(ctx: Ctx, slug: string, pageId: string, componentId: string, recordId: string | undefined, preview = false) {
  const { rt, page, comp } = await locate(ctx, slug, pageId, componentId, preview);
  if (comp.type !== "button") throw invalid("Not a button.");
  const a = comp.props.action as ButtonAction | undefined;
  if (!a) throw invalid("This button has no action.");
  if (a.kind === "navigate") {
    const target = rt.config.pages.find((p) => p.id === a.pageId);
    if (!target) throw invalid("The target page no longer exists.");
    return { navigate: target.kind === "detail" && recordId ? `${target.slug}/${recordId}` : target.slug };
  }
  if (a.kind === "open_url") { if (!/^https:\/\//.test(a.url ?? "")) throw invalid("Only https links are allowed."); return { url: a.url }; }
  if (rt.role === "portal") throw forbidden("This action isn't available to clients.");
  if (!atLeast(rt.role, "editor")) throw forbidden("You need editor access for this action.");
  // Fill {Field} tokens from the current record (detail pages).
  let text: Record<string, string> = {};
  if (recordId && page.tableId) {
    await assertRecordInScope({ ctx, rt, page, recordId }, page.tableId, recordId);
    const v = await runView(ctx, rt.role, page.tableId, {}, { recordIds: [recordId] });
    if (v.rows[0]) text = Object.fromEntries(v.fields.map((f) => [f.name.toLowerCase(), cellText(f, v.rows[0].values[f.id])]));
  }
  const fill = (x: unknown) => (typeof x === "string" ? x.replace(/\{([^{}]+)\}/g, (m, n: string) => text[n.trim().toLowerCase()] ?? m) : x);
  const values = Object.fromEntries(Object.entries(a.values ?? {}).map(([k, v]) => [k, fill(v)]));
  if (a.kind === "create_record") {
    if (!a.tableId) throw invalid("Choose a table.");
    await effectiveQuery({ ctx, rt, page }, { tableId: a.tableId });
    const [id] = await createRecords(ctx, a.tableId, [values]);
    return { message: "Created.", id };
  }
  if (a.kind === "update_record") {
    if (!recordId || !page.tableId) throw invalid("This button needs a record (use it on a detail page).");
    await updateRecord(ctx, recordId, values);
    return { message: "Updated." };
  }
  if (a.kind === "run_automation") {
    if (!recordId || !page.tableId || !a.automationId) throw invalid("This button needs a record and an automation.");
    const { runAutomationForRecord } = await import("../platform/automations");
    const r = await runAutomationForRecord(ctx, a.automationId, recordId);
    const detail = "detail" in r ? r.detail : undefined;
    return { message: r.status === "succeeded" ? "Automation ran." : `Automation ${r.status}${detail ? `: ${detail}` : ""}` };
  }
  throw invalid("Unknown action.");
}
