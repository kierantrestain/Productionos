"use server";
/**
 * Server actions — the only write path from the UI. Each resolves the session server-side,
 * delegates to permission-checked services and returns a serialisable ActionResult.
 */
import { revalidatePath } from "next/cache";
import { toResult } from "@/server/errors";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/request";
import { authenticate, createSession, destroySession, SESSION_COOKIE, SESSION_TTL_MS } from "@/server/auth/sessions";
import * as admin from "@/server/services/admin";

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
