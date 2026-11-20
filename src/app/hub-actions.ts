"use server";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/server/auth/request";
import { toResult } from "@/server/errors";
import { changePassword, myWork, quickAdd, searchEverything, updateProfile } from "@/server/hub/hub";
import { createSession, revokeUserSessions, SESSION_COOKIE, SESSION_TTL_MS } from "@/server/auth/sessions";

export async function searchEverythingAction(q: string, currentBaseId?: string) {
  return toResult(async () => searchEverything(await requireContext(), String(q ?? "").slice(0, 600), currentBaseId));
}
export async function myWorkCountsAction(mentionsSince?: string) {
  return toResult(async () => { const d = mentionsSince ? new Date(mentionsSince) : undefined; return (await myWork(await requireContext(), { maxTables: 25, mentionsSince: d && !isNaN(+d) ? d : new Date(Date.now() - 7 * 864e5) })).counts; });
}
export async function updateProfileAction(name: string) {
  return toResult(async () => { await updateProfile(await requireContext(), { name }); revalidatePath("/", "layout"); });
}
/** Changing the password signs out every other device, then issues this browser a fresh session. */
export async function changePasswordAction(current: string, next: string) {
  return toResult(async () => {
    const ctx = await requireContext();
    await changePassword(ctx, current, next);
    await revokeUserSessions([ctx.userId]);
    const token = await createSession(ctx.userId, ctx.orgId, (await headers()).get("user-agent") ?? undefined);
    (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_MS / 1000 });
  });
}
export async function quickAddAction(tableId: string, text: string) {
  return toResult(async () => { const r = await quickAdd(await requireContext(), tableId, String(text ?? "")); revalidatePath("/", "layout"); return r; });
}
