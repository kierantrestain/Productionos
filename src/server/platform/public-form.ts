/**
 * Public (share-link) forms. Anyone with the link can submit a new record; nothing else is readable.
 * Submissions run as the view's creator with create-only scope: only the form's chosen fields are
 * accepted, role-restricted and calculated fields are rejected, and every submission is audited.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { baseAttachments, baseFields, baseTables, baseViews, bases, recordRevisions } from "@/db/schema";
import { sha256 } from "../auth/password";
import { storage } from "../storage";
import { ALLOWED_TYPES, BLOCKED_EXT } from "./attachments";
import { isComputed, type FieldDefLite } from "@/lib/platform/fields";
import { contextForUser } from "../auth/sessions";
import { invalid, notFound } from "../errors";
import { createRecords } from "./records";
import { cleanAnswers, formClosed, missingRequired, safeRedirect, type FormItem } from "@/lib/platform/form-logic";
import { asLite } from "./schema";

const BLOCKED = new Set(["aiText", "button", "link", "user"]);
const PUBLIC_MAX_BYTES = 10 * 1024 * 1024; const PUBLIC_MAX_FILES = 5;

export async function loadPublicForm(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound();
  const [v] = await db.select().from(baseViews).where(and(eq(baseViews.shareToken, token), eq(baseViews.type, "form"), isNull(baseViews.archivedAt))).limit(1);
  if (!v) throw notFound("This form is no longer shared.");
  const [t] = await db.select().from(baseTables).where(and(eq(baseTables.id, v.tableId), isNull(baseTables.archivedAt))).limit(1);
  if (!t) throw notFound();
  const [b] = await db.select().from(bases).where(and(eq(bases.id, t.baseId), isNull(bases.archivedAt))).limit(1);
  if (!b) throw notFound();
  const all = (await db.select().from(baseFields).where(and(eq(baseFields.tableId, t.id), isNull(baseFields.archivedAt)))).map(asLite);
  // Only fields everyone may see and editors may edit, that are user-enterable.
  const usable = all.filter((f) => !f.permissions?.hiddenBelow && (!f.permissions?.edit || f.permissions.edit === "editor") && !isComputed(f.type) && !BLOCKED.has(f.type));
  const cfg = v.config.form ?? {};
  const chosen: FormItem[] = (cfg.fields?.length ? cfg.fields : usable.slice(0, 8).map((f) => ({ fieldId: f.id, required: f.id === t.primaryFieldId }))).filter((c) => usable.some((f) => f.id === c.fieldId));
  return {
    view: v, table: t,
    form: {
      title: cfg.title || v.name, description: cfg.description ?? "", submitLabel: cfg.submitLabel, successMessage: cfg.successMessage, color: b.color,
      closed: formClosed(cfg), redirectUrl: safeRedirect(cfg.redirectUrl), allowAnother: cfg.allowAnother !== false,
      fields: chosen.map((c) => ({ ...c, f: usable.find((f) => f.id === c.fieldId)! as FieldDefLite })),
    },
  };
}

export async function submitPublicForm(token: string, values: Record<string, unknown>) {
  const { view, table, form } = await loadPublicForm(token);
  if (!view.createdBy) throw invalid("This form has no owner and can't accept responses.");
  const owner = await contextForUser(view.createdBy, view.orgId);
  if (!owner) throw invalid("This form's owner no longer has access, so it can't accept responses.");
  if (form.closed) throw invalid("This form is closed and no longer accepts responses.");
  const allowed = new Map(form.fields.map((x) => [x.fieldId, x]));
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    if (!allowed.has(k)) throw invalid("The form contained an unexpected field.");
    if (typeof v === "string" && v.length > 20_000) throw invalid("An answer is too long.");
    clean[k] = v;
  }
  // Conditional logic is re-checked here: answers to hidden questions are dropped; required only applies when shown.
  const items = form.fields as unknown as FormItem[];
  const missing = missingRequired(items, clean);
  if (missing.length) { const m = items.find((x) => x.fieldId === missing[0].fieldId); throw invalid(`${m?.label || form.fields.find((x) => x.fieldId === missing[0].fieldId)!.f.name} is required.`); }
  const answers = cleanAnswers(items, clean);
  // Files: only uploads made through THIS form for THIS question, still unclaimed and recent, can be attached.
  const claimed: string[] = [];
  for (const x of form.fields.filter((y) => y.f.type === "attachment")) {
    const v = answers[x.fieldId]; if (v === undefined) continue;
    const ids = (Array.isArray(v) ? v : []).map((a) => String((a as { id?: string })?.id ?? "")).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, PUBLIC_MAX_FILES);
    const rows = ids.length ? await db.select().from(baseAttachments).where(and(inArray(baseAttachments.id, ids), eq(baseAttachments.fieldId, x.fieldId), eq(baseAttachments.tableId, table.id), isNull(baseAttachments.recordId), isNull(baseAttachments.deletedAt), gt(baseAttachments.createdAt, new Date(Date.now() - 6 * 3600_000)))) : [];
    if (rows.length !== ids.length) throw invalid("An uploaded file has expired or isn't part of this form. Please upload it again.");
    answers[x.fieldId] = rows.map((r) => ({ id: r.id, filename: r.filename, size: r.size, type: r.contentType }));
    claimed.push(...rows.map((r) => r.id));
  }
  // Throttle: at most 30 public submissions per table per minute.
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(recordRevisions)
    .where(and(eq(recordRevisions.tableId, table.id), eq(recordRevisions.actorLabel, "Public form"), gt(recordRevisions.at, new Date(Date.now() - 60_000))));
  if (n >= 30) throw invalid("This form is receiving a lot of responses. Please try again in a minute.");
  const ctx = { ...owner, name: "Public form", platformRole: "editor" };
  const [id] = await createRecords(ctx, table.id, [answers], { skipPermission: true, origin: "user", formViewId: view.id });
  if (claimed.length) await db.update(baseAttachments).set({ recordId: id }).where(and(inArray(baseAttachments.id, claimed), isNull(baseAttachments.recordId)));
  return { id };
}

/** Upload a file for a public form's attachment question. Stored unclaimed until the response is submitted. */
export async function uploadPublicFormFile(token: string, fieldId: string, file: { name: string; type: string; bytes: Buffer }) {
  const { table, form } = await loadPublicForm(token);
  if (form.closed) throw invalid("This form is closed.");
  const q = form.fields.find((x) => x.fieldId === fieldId && x.f.type === "attachment");
  if (!q) throw invalid("This question doesn't accept files.");
  if (!file.bytes.length) throw invalid("The file is empty.");
  if (file.bytes.length > PUBLIC_MAX_BYTES) throw invalid("Files must be 10 MB or smaller.");
  const filename = file.name.replace(/[\r\n"\\/]/g, "_").slice(0, 255) || "file";
  if (BLOCKED_EXT.test(filename) || !ALLOWED_TYPES.test(file.type)) throw invalid("That file type isn't allowed. Use PDF, images, Office documents, CSV or text.");
  // Throttle: at most 20 public uploads per table per minute.
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(baseAttachments).where(and(eq(baseAttachments.tableId, table.id), isNull(baseAttachments.createdBy), gt(baseAttachments.createdAt, new Date(Date.now() - 60_000))));
  if (n >= 20) throw invalid("Too many uploads right now. Please try again in a minute.");
  const key = `${table.orgId}/base/${table.baseId}/form/${randomUUID()}`;
  await storage().put(key, file.bytes, file.type);
  const [a] = await db.insert(baseAttachments).values({ orgId: table.orgId, baseId: table.baseId, tableId: table.id, fieldId, recordId: null, filename, contentType: file.type, size: file.bytes.length, sha256: sha256(file.bytes), storageKey: key, createdBy: null }).returning();
  return { id: a.id, filename, size: a.size, type: a.contentType };
}
