/**
 * Attachment fields. Bytes go to the configured storage provider (S3 in production, or the database
 * provider); metadata goes to base_attachments; the record value holds [{id, filename, size, type}].
 * Upload/remove require edit rights on that field of that record; download requires the record and
 * field to be visible to the caller AND the file to still be on the record (removed files 404).
 * Integrity: SHA-256 is recorded on upload and verified on every read.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { baseAttachments, baseFields, baseRecords } from "@/db/schema";
import type { Ctx } from "../auth/context";
import { sha256 } from "../auth/password";
import { audit } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { storage } from "../storage";
import { atLeast, fieldEditable, fieldVisible, requireRole } from "./access";
import { updateRecord } from "./records";
import { asLite, tableContext } from "./schema";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_CELL = 50;
export const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|scr|ps1|sh|js|mjs|jar|vbs|dll|app|dmg|iso|html?|svg)$/i;
export const ALLOWED_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp|heic|avif)|text\/(plain|csv)|application\/(msword|vnd\.openxmlformats-officedocument\..+|vnd\.ms-excel|vnd\.ms-powerpoint|zip|json|octet-stream)|video\/(mp4|quicktime|webm)|audio\/(mpeg|wav|x-wav|mp4))$/;
export type AttachmentValue = { id: string; filename: string; size: number; type: string };

async function context(ctx: Ctx, recordId: string, fieldId: string) {
  const [rec] = await db.select().from(baseRecords).where(and(eq(baseRecords.id, recordId), eq(baseRecords.orgId, ctx.orgId), isNull(baseRecords.deletedAt))).limit(1);
  if (!rec) throw notFound("Record not found.");
  const { table, access } = await tableContext(ctx, rec.tableId);
  const [f] = await db.select().from(baseFields).where(and(eq(baseFields.id, fieldId), eq(baseFields.tableId, rec.tableId), isNull(baseFields.archivedAt))).limit(1);
  if (!f || f.type !== "attachment") throw notFound("Attachment field not found.");
  const lite = asLite(f);
  if (!fieldVisible(access.role, lite)) throw notFound("Attachment field not found.");
  return { rec, table, access, field: lite };
}

export async function uploadRecordAttachment(ctx: Ctx, input: { recordId: string; fieldId: string; name: string; type: string; bytes: Buffer }) {
  const { rec, table, access, field } = await context(ctx, input.recordId, input.fieldId);
  requireRole(access, table.permissions?.edit ?? "editor", "edit records in this table");
  if (!fieldEditable(access.role, field)) throw forbidden("You can't edit this field.");
  if (!input.bytes.length) throw invalid("The file is empty.");
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) throw invalid("Files must be 25 MB or smaller.");
  const filename = input.name.replace(/[\r\n"\\/]/g, "_").slice(0, 255) || "file";
  if (BLOCKED_EXT.test(filename)) throw invalid("That file type isn't allowed.");
  const current = ((rec.data[field.id] as AttachmentValue[] | undefined) ?? []);
  if (current.length >= MAX_FILES_PER_CELL) throw invalid(`A cell holds at most ${MAX_FILES_PER_CELL} files.`);
  const contentType = ALLOWED_TYPES.test(input.type) ? input.type : "application/octet-stream";
  const hash = sha256(input.bytes);
  const key = `${ctx.orgId}/base/${table.baseId}/${randomUUID()}`;
  await storage().put(key, input.bytes, contentType);
  const [a] = await db.insert(baseAttachments).values({ orgId: ctx.orgId, baseId: table.baseId, tableId: table.id, fieldId: field.id, recordId: rec.id, filename, contentType, size: input.bytes.length, sha256: hash, storageKey: key, createdBy: ctx.userId }).returning();
  const value: AttachmentValue = { id: a.id, filename, size: a.size, type: contentType };
  await updateRecord(ctx, rec.id, { [field.id]: [...current, value] });
  await audit(db, ctx, "upload", "base_records", rec.id, { meta: { attachmentId: a.id, filename, size: a.size, sha256: hash } });
  return value;
}

export async function removeRecordAttachment(ctx: Ctx, attachmentId: string) {
  const [a] = await db.select().from(baseAttachments).where(and(eq(baseAttachments.id, attachmentId), eq(baseAttachments.orgId, ctx.orgId), isNull(baseAttachments.deletedAt))).limit(1);
  if (!a || !a.recordId) throw notFound();
  const { rec, table, access, field } = await context(ctx, a.recordId, a.fieldId);
  requireRole(access, table.permissions?.edit ?? "editor", "edit records in this table");
  if (!fieldEditable(access.role, field)) throw forbidden("You can't edit this field.");
  const current = ((rec.data[field.id] as AttachmentValue[] | undefined) ?? []);
  await updateRecord(ctx, rec.id, { [field.id]: current.filter((x) => x.id !== attachmentId) });
  // Bytes are retained (record history can restore the reference); the file is no longer servable.
  await db.update(baseAttachments).set({ deletedAt: new Date() }).where(eq(baseAttachments.id, attachmentId));
  await audit(db, ctx, "remove_attachment", "base_records", rec.id, { meta: { attachmentId, filename: a.filename } });
}

export async function readRecordAttachment(ctx: Ctx, attachmentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) throw notFound();
  const [a] = await db.select().from(baseAttachments).where(and(eq(baseAttachments.id, attachmentId), eq(baseAttachments.orgId, ctx.orgId), isNull(baseAttachments.deletedAt))).limit(1);
  if (!a || !a.recordId) throw notFound();
  const { rec, access } = await context(ctx, a.recordId, a.fieldId);
  if (!atLeast(access.role, "reader")) throw notFound();
  const onRecord = ((rec.data[a.fieldId] as AttachmentValue[] | undefined) ?? []).some((x) => x.id === a.id);
  if (!onRecord) throw notFound();
  const bytes = await storage().get(a.storageKey);
  if (sha256(bytes) !== a.sha256) throw new Error(`Integrity check failed for attachment ${a.id}`);
  return { meta: a, bytes };
}
