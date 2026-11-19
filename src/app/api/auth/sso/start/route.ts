import { NextResponse } from "next/server";
import { startSso } from "@/server/auth/sso";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const org = u.searchParams.get("org") ?? "";
  try {
    const { url, cookie } = await startSso(org, `${u.origin}/api/auth/sso/callback`);
    const res = NextResponse.redirect(url);
    res.cookies.set("pos_sso", cookie, { httpOnly: true, sameSite: "lax", secure: u.protocol === "https:", path: "/api/auth/sso", maxAge: 600 });
    return res;
  } catch (e) {
    return NextResponse.redirect(`${u.origin}/login?sso_error=${encodeURIComponent((e as Error).message)}`);
  }
}
