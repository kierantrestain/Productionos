/**
 * Public (share-link) forms. Anyone with the link can submit a new record; nothing else is readable.
 * Submissions run as the view's creator with create-only scope: only the form's chosen fields are
 * accepted, role-restricted and calculated fields are rejected, and every submission is audited.
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { baseFields, baseTables, baseViews, bases, recordRevisions } from "@/db/schema";
import { isComputed, type FieldDefLite } from "@/lib/platform/fields";
import { contextForUser } from "../auth/sessions";
import { invalid, notFound } from "../errors";
import { createRecords } from "./records";
import { asLite } from "./schema";

const BLOCKED = new Set(["attachment", "aiText", "button", "link", "user"]);

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
  const chosen = (cfg.fields?.length ? cfg.fields : usable.slice(0, 8).map((f) => ({ fieldId: f.id, required: f.id === t.primaryFieldId }))).filter((c) => usable.some((f) => f.id === c.fieldId));
  return {
    view: v, table: t,
    form: {
      title: cfg.title || v.name, description: cfg.description ?? "", submitLabel: cfg.submitLabel, successMessage: cfg.successMessage, color: b.color,
      fields: chosen.map((c) => ({ ...c, f: usable.find((f) => f.id === c.fieldId)! as FieldDefLite })),
    },
  };
}

export async function submitPublicForm(token: string, values: Record<string, unknown>) {
  const { view, table, form } = await loadPublicForm(token);
  if (!view.createdBy) throw invalid("This form has no owner and can't accept responses.");
  const owner = await contextForUser(view.createdBy, view.orgId);
  if (!owner) throw invalid("This form's owner no longer has access, so it can't accept responses.");
  const allowed = new Map(form.fields.map((x) => [x.fieldId, x]));
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    if (!allowed.has(k)) throw invalid("The form contained an unexpected field.");
    if (typeof v === "string" && v.length > 20_000) throw invalid("An answer is too long.");
    clean[k] = v;
  }
  for (const x of form.fields) if (x.required && (clean[x.fieldId] === undefined || clean[x.fieldId] === "" || clean[x.fieldId] === null)) throw invalid(`${x.f.name} is required.`);
  // Throttle: at most 30 public submissions per table per minute.
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(recordRevisions)
    .where(and(eq(recordRevisions.tableId, table.id), eq(recordRevisions.actorLabel, "Public form"), gt(recordRevisions.at, new Date(Date.now() - 60_000))));
  if (n >= 30) throw invalid("This form is receiving a lot of responses. Please try again in a minute.");
  const ctx = { ...owner, name: "Public form", platformRole: "editor" };
  const [id] = await createRecords(ctx, table.id, [clean], { skipPermission: true, origin: "user" });
  return { id };
}
