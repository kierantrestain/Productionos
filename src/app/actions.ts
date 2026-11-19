"use server";
/**
 * Server actions — the only write path from the UI. Each resolves the session server-side,
 * delegates to permission-checked services and returns a serialisable ActionResult.
 */
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { savedViews } from "@/db/schema";
import type { Role } from "@/lib/permissions";
import { requireContext } from "@/server/auth/request";
import { authenticate, createSession, destroySession, SESSION_COOKIE, SESSION_TTL_MS } from "@/server/auth/sessions";
import { toResult, type ActionResult } from "@/server/errors";
import * as crud from "@/server/entities/crud";
import * as ops from "@/server/services/production-ops";
import * as cs from "@/server/services/callsheets";
import * as appr from "@/server/services/approvals";
import * as pl from "@/server/services/post-legal";
import * as att from "@/server/services/attachments";
import * as admin from "@/server/services/admin";
import { kickOutbox, processOutbox, retryEvent } from "@/server/workflows/engine";
import { shootDayConflicts } from "@/server/services/conflicts";
import { workflowDefinitions } from "@/db/schema";

const done = (path = "/") => revalidatePath(path, "layout");

// ───────────── Auth ─────────────

export async function loginAction(_prev: unknown, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const u = await authenticate(email, password);
  if (!u) return { error: "Email or password is incorrect." };
  const { passwordBlockedBySso } = await import("@/server/auth/sso");
  if (await passwordBlockedBySso(u.id, u.email)) return { error: "Your workspace requires single sign-on. Use “Sign in with SSO” below." };
  const token = await createSession(u.id, undefined, (await headers()).get("user-agent") ?? undefined);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_MS / 1000 });
  const next = String(form.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await destroySession(t);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function acceptInviteAction(_prev: unknown, form: FormData): Promise<{ error?: string }> {
  const password = String(form.get("password") ?? "");
  if (password.length < 10) return { error: "Use at least 10 characters." };
  try {
    const r = await admin.acceptInvite(String(form.get("token")), String(form.get("name") ?? "").trim() || "New user", password);
    const token = await createSession(r.userId, r.orgId);
    (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_MS / 1000 });
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect("/");
}

export async function setupAction(_prev: unknown, form: FormData): Promise<{ error?: string }> {
  try {
    const r = await admin.firstRunSetup({ orgName: String(form.get("orgName") ?? ""), name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
    // Sign in straight away; the optional demo workspace loads afterwards as its own request.
    const token = await createSession(r.userId, r.orgId);
    (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_MS / 1000 });
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect(form.get("demo") === "on" ? "/?loadDemo=1" : "/");
}

export async function switchOrgAction(orgId: string) {
  const ctx = await requireContext();
  const orgs = await admin.myOrganisations(ctx.userId);
  if (!orgs.some((o) => o.id === orgId)) return;
  const jar = await cookies();
  const old = jar.get(SESSION_COOKIE)?.value;
  const token = await createSession(ctx.userId, orgId);
  if (old) await destroySession(old);
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_MS / 1000 });
  redirect("/");
}

// ───────────── Generic records ─────────────

export async function createRecord(entity: string, values: Record<string, unknown>, custom?: Record<string, unknown>): Promise<ActionResult<crud.Row>> {
  return toResult(async () => {
    const ctx = await requireContext();
    const { listFieldDefs, setCustomValues } = await import("@/server/services/customise");
    const hasDefs = (await listFieldDefs(ctx, entity)).length > 0;
    const r = hasDefs
      ? await db.transaction(async (tx) => { const row = await crud.createEntity(ctx, entity, values, { tx }); await setCustomValues(ctx, entity, row.id, custom ?? {}, { tx, creating: true }); return row; })
      : await crud.createEntity(ctx, entity, values);
    await kickOutbox(ctx.orgId);
    done();
    return r;
  });
}

export async function updateRecord(entity: string, id: string, patch: Record<string, unknown>, version?: number, custom?: Record<string, unknown>): Promise<ActionResult<crud.Row>> {
  return toResult(async () => {
    const ctx = await requireContext();
    const r = Object.keys(patch).length || !custom ? await crud.updateEntity(ctx, entity, id, patch, version) : await crud.getEntityRow(ctx, entity, id);
    if (custom && Object.keys(custom).length) { const { setCustomValues } = await import("@/server/services/customise"); await setCustomValues(ctx, entity, id, custom); }
    await kickOutbox(ctx.orgId);
    done();
    return r;
  });
}

export async function archiveRecords(entity: string, ids: string[], restore = false) {
  return toResult(async () => { const ctx = await requireContext(); const n = await crud.batchArchive(ctx, entity, ids, restore); done(); return n; });
}

export async function batchUpdateRecords(entity: string, ids: string[], patch: Record<string, unknown>) {
  return toResult(async () => { const ctx = await requireContext(); const n = await crud.batchUpdate(ctx, entity, ids, patch); await kickOutbox(ctx.orgId); done(); return n; });
}

export async function refOptionsAction(entity: string, productionId?: string) {
  return toResult(async () => crud.refOptions(await requireContext(), entity, { productionId }));
}

export async function saveViewAction(entity: string, name: string, config: Record<string, unknown>, shared: boolean) {
  return toResult(async () => {
    const ctx = await requireContext();
    const clean = name.trim().slice(0, 80);
    if (!clean) throw new Error("Name required");
    const [v] = await db.insert(savedViews).values({ orgId: ctx.orgId, userId: ctx.userId, createdBy: ctx.userId, entity, name: clean, shared, config: config as never }).returning();
    done();
    return v;
  });
}

export async function deleteViewAction(id: string) {
  return toResult(async () => {
    const ctx = await requireContext();
    await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.orgId, ctx.orgId), eq(savedViews.userId, ctx.userId)));
    done();
  });
}

export async function commentAction(entity: string, id: string, body: string) {
  return toResult(async () => { const r = await att.addComment(await requireContext(), entity, id, body); done(); return r; });
}

export async function archiveAttachmentAction(id: string) {
  return toResult(async () => { await att.archiveAttachment(await requireContext(), id); done(); });
}

// ───────────── Scenes, shots, scheduling ─────────────

export async function linkPersonAction(sceneId: string, personId: string, roleType: string, characterName?: string) {
  return toResult(async () => { const r = await ops.linkScenePerson(await requireContext(), sceneId, personId, roleType, characterName); done(); return r; });
}
export async function unlinkPersonAction(linkId: string) {
  return toResult(async () => { await ops.unlinkScenePerson(await requireContext(), linkId); done(); });
}
export async function linkResourceAction(sceneId: string, resourceId: string, quantity: number) {
  return toResult(async () => { const r = await ops.linkSceneResource(await requireContext(), sceneId, resourceId, quantity); done(); return r; });
}
export async function unlinkResourceAction(linkId: string) {
  return toResult(async () => { await ops.unlinkSceneResource(await requireContext(), linkId); done(); });
}
export async function reorderShotsAction(sceneId: string, ids: string[]) {
  return toResult(async () => { await ops.reorderShots(await requireContext(), sceneId, ids); done(); });
}
export async function duplicateShotAction(id: string) {
  return toResult(async () => { const r = await ops.duplicateShot(await requireContext(), id); done(); return r; });
}
export async function addSceneToDayAction(dayId: string, sceneId: string) {
  return toResult(async () => { const r = await ops.addSceneToDay(await requireContext(), dayId, sceneId); done(); return r; });
}
export async function addBlockAction(dayId: string, kind: string, label: string, start?: string, end?: string) {
  return toResult(async () => { const r = await ops.addBlock(await requireContext(), dayId, kind, label, start || null, end || null); done(); return r; });
}
export async function updateBlockAction(blockId: string, patch: { startTime?: string | null; endTime?: string | null; label?: string | null; notes?: string | null }) {
  return toResult(async () => { const r = await ops.updateBlock(await requireContext(), blockId, patch); done(); return r; });
}
export async function moveBlockAction(blockId: string, shootDayId: string, beforeBlockId?: string | null) {
  return toResult(async () => { await ops.moveBlock(await requireContext(), blockId, { shootDayId, beforeBlockId }); done(); });
}
export async function removeBlockAction(blockId: string) {
  return toResult(async () => { await ops.removeBlock(await requireContext(), blockId); done(); });
}
export async function upsertCallAction(dayId: string, personId: string, patch: Parameters<typeof ops.upsertCall>[3]) {
  return toResult(async () => { const r = await ops.upsertCall(await requireContext(), dayId, personId, patch); done(); return r; });
}
export async function removeCallAction(callId: string) {
  return toResult(async () => { await ops.removeCall(await requireContext(), callId); done(); });
}
export async function checkInAction(callId: string, undo: boolean) {
  return toResult(async () => { const r = await ops.checkIn(await requireContext(), callId, undo); done(); return r; });
}
export async function syncCallsAction(dayId: string) {
  return toResult(async () => { await ops.syncCalls(await requireContext(), dayId); done(); });
}
export async function conflictsAction(dayId: string) {
  return toResult(async () => shootDayConflicts(await requireContext(), dayId));
}
export async function issueCallSheetAction(dayId: string, notes: string, allowWithErrors: boolean) {
  return toResult(async () => { const r = await cs.issueCallSheet(await requireContext(), dayId, notes, { allowWithErrors }); done(); return { id: r.id, versionNumber: r.versionNumber }; });
}
export async function prepareDistributionAction(callSheetId: string) {
  return toResult(async () => { const r = await cs.prepareDistribution(await requireContext(), callSheetId); done(); return r; });
}
export async function wrapDayAction(dayId: string) {
  return toResult(async () => { const r = await ops.wrapDayToPost(await requireContext(), dayId); done(); return r; });
}

// ───────────── Approvals, post, legal, messages ─────────────

export async function requestApprovalAction(subjectType: Parameters<typeof appr.requestApproval>[1], id: string, note?: string) {
  return toResult(async () => { const r = await appr.requestApproval(await requireContext(), subjectType, id, note); done(); return r; });
}
export async function decideApprovalAction(id: string, decision: "approved" | "rejected", note?: string) {
  return toResult(async () => { const r = await appr.decideApproval(await requireContext(), id, decision, note); done(); return r; });
}
export async function withdrawApprovalAction(id: string) {
  return toResult(async () => { await appr.withdrawApproval(await requireContext(), id); done(); });
}
export async function decideEditAction(id: string, decision: "approved" | "changes_requested") {
  return toResult(async () => { const r = await pl.decideEditVersion(await requireContext(), id, decision); done(); return r; });
}
export async function advanceDeliverableAction(id: string, to: string) {
  return toResult(async () => { const r = await pl.advanceDeliverable(await requireContext(), id, to); done(); return r; });
}
export async function approveDeliverableAction(id: string, decision: "approved" | "rejected", note?: string) {
  return toResult(async () => { const r = await pl.approveDeliverable(await requireContext(), id, decision, note); done(); return r; });
}
export async function markDeliveredAction(id: string) {
  return toResult(async () => { const r = await pl.markDelivered(await requireContext(), id); done(); return r; });
}
export async function generateContractAction(id: string) {
  return toResult(async () => { const r = await pl.generateContract(await requireContext(), id); done(); return r; });
}
export async function requestSignatureAction(id: string, confirm: boolean) {
  return toResult(async () => { const ctx = await requireContext(); const r = await pl.requestContractSignature(ctx, id, confirm); await kickOutbox(ctx.orgId); done(); return r; });
}
export async function markSignedAction(id: string, attachmentId: string) {
  return toResult(async () => { const r = await pl.markContractSigned(await requireContext(), id, attachmentId); done(); return r; });
}
export async function draftCastDetailsAction(engagementId: string) {
  return toResult(async () => { const r = await pl.draftCastDetails(await requireContext(), engagementId); done(); return r; });
}
export async function confirmMessagesAction(ids: string[]) {
  return toResult(async () => { const ctx = await requireContext(); const r = await pl.confirmMessages(ctx, ids); await kickOutbox(ctx.orgId); done(); return r; });
}
export async function cancelMessagesAction(ids: string[]) {
  return toResult(async () => { await pl.cancelMessages(await requireContext(), ids); done(); });
}

// ───────────── Automations & admin ─────────────

export async function runQueueAction() {
  return toResult(async () => { const ctx = await requireContext(); if (ctx.role !== "org_admin") throw new Error("Admin only"); const r = await processOutbox({ orgId: ctx.orgId }); done(); return r; });
}
export async function retryEventAction(id: string) {
  return toResult(async () => { const ctx = await requireContext(); if (ctx.role !== "org_admin") throw new Error("Admin only"); const ok = await retryEvent(ctx.orgId, id); await kickOutbox(ctx.orgId); done(); return ok; });
}
export async function setWorkflowStatusAction(id: string, status: "active" | "paused" | "retired") {
  return toResult(async () => {
    const ctx = await requireContext();
    if (ctx.role !== "org_admin") throw new Error("Admin only");
    const [w] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.orgId, ctx.orgId))).limit(1);
    if (!w) throw new Error("Not found");
    if (status === "active" && (w.disposition === "blocked" || w.disposition === "retired")) throw new Error("This workflow is a blocked/retired specification and cannot be activated until it is implemented and tested.");
    await db.update(workflowDefinitions).set({ status, updatedAt: new Date(), ruleVersion: w.ruleVersion + (status === "active" ? 0 : 0) }).where(eq(workflowDefinitions.id, id));
    const { audit } = await import("@/server/audit");
    await audit(db, ctx, "workflow_status", "workflow_definitions", id, { before: { status: w.status }, after: { status } });
    done();
  });
}
export async function inviteAction(email: string, role: Role, productionIds: string[]) {
  return toResult(async () => { const r = await admin.createInvite(await requireContext(), email, role, productionIds); done(); return { token: r.token }; });
}
export async function setRoleAction(userId: string, role: Role) {
  return toResult(async () => { await admin.setMemberRole(await requireContext(), userId, role); done(); });
}
export async function setProductionsAction(userId: string, productionIds: string[]) {
  return toResult(async () => { await admin.setMemberProductions(await requireContext(), userId, productionIds); done(); });
}
export async function setDisabledAction(userId: string, disabled: boolean) {
  return toResult(async () => { await admin.setMemberDisabled(await requireContext(), userId, disabled); done(); });
}
export async function createTokenAction(name: string, scopes: string[]) {
  return toResult(async () => { const r = await admin.createApiToken(await requireContext(), name, scopes); done(); return r; });
}
export async function revokeTokenAction(id: string) {
  return toResult(async () => { await admin.revokeApiToken(await requireContext(), id); done(); });
}

// ───────────── Customisation ─────────────

export async function updateSettingsAction(patch: Record<string, unknown>) {
  return toResult(async () => { const { updateSettings } = await import("@/server/services/customise"); const r = await updateSettings(await requireContext(), patch); done(); return r; });
}
export async function createFieldDefAction(input: Record<string, unknown>) {
  return toResult(async () => { const { createFieldDef } = await import("@/server/services/customise"); const r = await createFieldDef(await requireContext(), input); done(); return { id: r.id }; });
}
export async function updateFieldDefAction(id: string, patch: { label?: string; options?: string[]; required?: boolean; showInList?: boolean; help?: string | null }) {
  return toResult(async () => { const { updateFieldDef } = await import("@/server/services/customise"); await updateFieldDef(await requireContext(), id, patch); done(); });
}
export async function archiveFieldDefAction(id: string) {
  return toResult(async () => { const { archiveFieldDef } = await import("@/server/services/customise"); await archiveFieldDef(await requireContext(), id); done(); });
}
export async function setCustomValueAction(entity: string, recordId: string, key: string, value: unknown) {
  return toResult(async () => { const { setCustomValues } = await import("@/server/services/customise"); const ctx = await requireContext(); await setCustomValues(ctx, entity, recordId, { [key]: value }); done(); return true; });
}

// ───────────── Templates ─────────────

export async function createFromTemplateAction(input: Record<string, unknown>) {
  return toResult(async () => { const { createFromTemplate } = await import("@/server/services/templates"); const r = await createFromTemplate(await requireContext(), input); done(); return r; });
}
export async function saveAsTemplateAction(productionId: string, name: string, description?: string) {
  return toResult(async () => { const { saveAsTemplate } = await import("@/server/services/templates"); const r = await saveAsTemplate(await requireContext(), productionId, name, description); done(); return { id: r.id }; });
}
export async function archiveTemplateAction(id: string) {
  return toResult(async () => { const { archiveTemplate } = await import("@/server/services/templates"); await archiveTemplate(await requireContext(), id); done(); });
}

// ───────────── Custom automation rules ─────────────

export async function createRuleAction(input: Record<string, unknown>) {
  return toResult(async () => { const { createRule } = await import("@/server/workflows/rules"); const r = await createRule(await requireContext(), input); done(); return { id: r.id }; });
}
export async function setRuleStatusAction(id: string, status: "active" | "paused" | "archived") {
  return toResult(async () => { const { setRuleStatus } = await import("@/server/workflows/rules"); await setRuleStatus(await requireContext(), id, status); done(); });
}

// ───────────── Demo workspace ─────────────

/** Build (or finish building) the flagged demo workspace for the signed-in admin. Safe to call again. */
export async function loadDemoAction() {
  return toResult(async () => {
    const ctx = await requireContext();
    if (ctx.role !== "org_admin") throw new Error("Only organisation admins can load the demo workspace.");
    const { seedDemo } = await import("@/server/services/demo");
    const r = await seedDemo({ ownerUserId: ctx.userId });
    done();
    return { orgId: r.orgId, created: r.created };
  });
}

export async function resetDemoLoginsAction() {
  return toResult(async () => admin.resetDemoRoleLogins(await requireContext()));
}
