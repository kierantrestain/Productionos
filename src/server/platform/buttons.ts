/**
 * Button fields. A click runs ONE configured action server-side, with the clicker's permissions:
 *  - open_url: returns a URL (http/https only) with {RECORD_ID} and {Field name} tokens filled in;
 *  - update_record: writes the configured values to the record (edit rights on table and fields required);
 *  - run_automation: runs a chosen automation of the same base for this record (see automations.ts).
 * Every click is audited.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { baseFields, baseRecords } from "@/db/schema";
import { cellText } from "@/lib/platform/cell-text";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { invalid, notFound } from "../errors";
import { requireRole } from "./access";
import { runView } from "./query";
import { updateRecord } from "./records";
import { asLite, tableContext } from "./schema";

export type ButtonAction = "open_url" | "update_record" | "run_automation";

export async function clickButton(ctx: Ctx, fieldId: string, recordId: string) {
  const [f] = await db.select().from(baseFields).where(and(eq(baseFields.id, fieldId), eq(baseFields.orgId, ctx.orgId), isNull(baseFields.archivedAt))).limit(1);
  if (!f || f.type !== "button") throw notFound("Button not found.");
  const [rec] = await db.select().from(baseRecords).where(and(eq(baseRecords.id, recordId), eq(baseRecords.tableId, f.tableId), isNull(baseRecords.deletedAt))).limit(1);
  if (!rec) throw notFound("Record not found.");
  const { table, access } = await tableContext(ctx, f.tableId);
  const o = asLite(f).options as { action?: ButtonAction; url?: string; values?: Record<string, unknown>; automationId?: string; label?: string };
  const action: ButtonAction = o.action ?? "open_url";
  let result: { kind: ButtonAction; url?: string; status?: string };
  if (action === "open_url") {
    const v = await runView(ctx, access.role, f.tableId, {}, { recordIds: [recordId] });
    const row = v.rows[0]; if (!row) throw notFound("Record not found.");
    const text: Record<string, string> = {};
    for (const x of v.fields) text[x.name.toLowerCase()] = cellText(x, row.values[x.id]);
    const url = String(o.url ?? "").replace(/\{RECORD_ID\}/g, recordId).replace(/\{([^{}]+)\}/g, (m, n: string) => encodeURIComponent(text[n.trim().toLowerCase()] ?? ""));
    if (!/^https?:\/\//i.test(url)) throw invalid("This button has no valid http(s) URL.");
    result = { kind: action, url };
  } else if (action === "update_record") {
    requireRole(access, table.permissions?.edit ?? "editor", "edit records in this table");
    if (!o.values || !Object.keys(o.values).length) throw invalid("This button has nothing to update.");
    await updateRecord(ctx, recordId, o.values); // field-level edit permissions enforced inside
    result = { kind: action, status: "updated" };
  } else if (action === "run_automation") {
    if (!o.automationId) throw invalid("This button isn't linked to an automation.");
    const { runAutomationForRecord } = await import("./automations");
    const r = await runAutomationForRecord(ctx, o.automationId, recordId, randomUUID());
    result = { kind: action, status: r.status };
  } else throw invalid("Unknown button action.");
  await audit(db, ctx, "button_click", "base_records", recordId, { meta: { fieldId, action, label: o.label ?? f.name, outcome: result.status ?? "opened" } });
  return result;
}
