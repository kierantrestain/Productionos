import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, comments, auditEvents, users } from "@/db/schema";
import { canWrite, canSee } from "@/lib/permissions";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { sha256 } from "../auth/password";
import { def, getEntityRow } from "../entities/crud";
import { forbidden, invalid, notFound } from "../errors";
import { storage } from "../storage";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|scr|ps1|sh|js|jar|vbs|dll|app|dmg|iso)$/i;
const ALLOWED_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp|heic|svg\+xml)|text\/(plain|csv)|application\/(msword|vnd\.openxmlformats-officedocument\..+|vnd\.ms-excel|zip|json|octet-stream)|video\/(mp4|quicktime)|audio\/(mpeg|wav|x-wav|mp4))$/;

/** Upload a file to protected storage and record metadata + SHA-256 for integrity verification. */
export async function uploadAttachment(ctx: Ctx, entityType: string, entityId: string, file: { name: string; type: string; bytes: Buffer }) {
  const d = def(entityType);
  const row = await getEntityRow(ctx, entityType, entityId); // read + scope check
  if (!canWrite(ctx.role, d.domain, d.key) && !(d.domain === "review" && ctx.role === "external_reviewer")) throw forbidden();
  if (file.bytes.length === 0) throw invalid("The file is empty.");
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw invalid("Files must be 25 MB or smaller.");
  const filename = file.name.replace(/[\r\n"\\/]/g, "_").slice(0, 255) || "file";
  if (BLOCKED_EXT.test(filename)) throw invalid("That file type is not allowed.");
  const contentType = ALLOWED_TYPES.test(file.type) ? file.type : "application/octet-stream";
  const hash = sha256(file.bytes);
  const key = `${ctx.orgId}/${entityType}/${entityId}/${randomUUID()}`;
  await storage().put(key, file.bytes, contentType);
  return db.transaction(async (tx) => {
    const [a] = await tx.insert(attachments).values({
      orgId: ctx.orgId, createdBy: ctx.userId, entityType, entityId, productionId: (row.productionId as string) ?? (entityType === "productions" ? entityId : null),
      filename, contentType, sizeBytes: file.bytes.length, sha256: hash, storageKey: key, sensitivity: ["contracts", "people", "engagements"].includes(entityType) ? "restricted" : "internal",
    }).returning();
    await audit(tx, ctx, "upload", entityType, entityId, { productionId: a.productionId, meta: { attachmentId: a.id, filename, sha256: hash, size: a.sizeBytes } });
    return a;
  });
}

export async function listAttachments(ctx: Ctx, entityType: string, entityId: string) {
  await getEntityRow(ctx, entityType, entityId);
  return db.select().from(attachments).where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.entityType, entityType), eq(attachments.entityId, entityId), isNull(attachments.archivedAt))).orderBy(desc(attachments.createdAt));
}

/** Download with per-file authorisation and on-read integrity verification. */
export async function readAttachment(ctx: Ctx, attachmentId: string) {
  const [a] = await db.select().from(attachments).where(and(eq(attachments.id, attachmentId), eq(attachments.orgId, ctx.orgId), isNull(attachments.archivedAt))).limit(1);
  if (!a) throw notFound();
  await getEntityRow(ctx, a.entityType, a.entityId);
  if (a.sensitivity === "restricted" && !canSee(ctx.role, "pii")) throw forbidden();
  const bytes = await storage().get(a.storageKey);
  const ok = sha256(bytes) === a.sha256;
  if (!ok) throw new Error(`Integrity check failed for attachment ${a.id}`);
  return { meta: a, bytes };
}

export async function archiveAttachment(ctx: Ctx, attachmentId: string) {
  const [a] = await db.select().from(attachments).where(and(eq(attachments.id, attachmentId), eq(attachments.orgId, ctx.orgId))).limit(1);
  if (!a) throw notFound();
  const d = def(a.entityType);
  await getEntityRow(ctx, a.entityType, a.entityId);
  if (!canWrite(ctx.role, d.domain, d.key)) throw forbidden();
  await db.transaction(async (tx) => {
    await tx.update(attachments).set({ archivedAt: new Date() }).where(eq(attachments.id, a.id));
    await audit(tx, ctx, "archive_attachment", a.entityType, a.entityId, { meta: { attachmentId: a.id, filename: a.filename } });
  });
}

// ───────────── Comments & activity ─────────────

export async function addComment(ctx: Ctx, entityType: string, entityId: string, body: string) {
  const row = await getEntityRow(ctx, entityType, entityId);
  if (ctx.role === "cast") throw forbidden();
  const text = body.trim();
  if (!text || text.length > 5000) throw invalid("Comments must be 1–5000 characters.");
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(comments).values({ orgId: ctx.orgId, createdBy: ctx.userId, entityType, entityId, productionId: (row.productionId as string) ?? null, body: text }).returning();
    await audit(tx, ctx, "comment", entityType, entityId, { productionId: c.productionId, meta: { commentId: c.id } });
    return c;
  });
}

export async function listComments(ctx: Ctx, entityType: string, entityId: string) {
  await getEntityRow(ctx, entityType, entityId);
  return db.select({ id: comments.id, body: comments.body, createdAt: comments.createdAt, author: users.name }).from(comments)
    .leftJoin(users, eq(users.id, comments.createdBy))
    .where(and(eq(comments.orgId, ctx.orgId), eq(comments.entityType, entityType), eq(comments.entityId, entityId), isNull(comments.archivedAt))).orderBy(desc(comments.createdAt));
}

/** Activity history for one record. Sensitive values are masked for roles that cannot see them. */
export async function activity(ctx: Ctx, entityType: string, entityId: string) {
  const d = def(entityType);
  await getEntityRow(ctx, entityType, entityId);
  const rows = await db.select().from(auditEvents).where(and(eq(auditEvents.orgId, ctx.orgId), eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId))).orderBy(desc(auditEvents.at)).limit(100);
  const masked = new Set(d.fields.filter((f) => f.sensitive && !canSee(ctx.role, f.sensitive)).map((f) => f.key));
  const mask = (o: unknown) => {
    if (!o || typeof o !== "object") return o;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) out[k] = masked.has(k) ? "••••" : v;
    return out;
  };
  return rows.map((r) => ({ id: r.id, action: r.action, actor: r.actorLabel, at: r.at.toISOString(), before: mask(r.before), after: mask(r.after), meta: r.meta }));
}
