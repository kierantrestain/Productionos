import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { finishSso } from "@/server/auth/sso";
import { createSession, SESSION_COOKIE, SESSION_TTL_MS } from "@/server/auth/sessions";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const jar = await cookies();
  try {
    const r = await finishSso({ code: u.searchParams.get("code"), state: u.searchParams.get("state"), error: u.searchParams.get("error") }, jar.get("pos_sso")?.value);
    const token = await createSession(r.userId, r.orgId, req.headers.get("user-agent") ?? undefined);
    const res = NextResponse.redirect(`${u.origin}/`);
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: u.protocol === "https:", path: "/", maxAge: SESSION_TTL_MS / 1000 });
    res.cookies.delete({ name: "pos_sso", path: "/api/auth/sso" });
    return res;
  } catch (e) {
    return NextResponse.redirect(`${u.origin}/login?sso_error=${encodeURIComponent((e as Error).message)}`);
  }
}
