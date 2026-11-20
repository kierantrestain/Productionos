import { NextResponse, type NextRequest } from "next/server";

/**
 * Signed-out visitors go straight to /login with a 307 before any page renders. This is only a fast
 * path: every page and action still checks the session itself (the cookie may be expired or revoked).
 */
const PUBLIC = ["/login", "/api", "/form", "/invite", "/setup", "/_next", "/favicon", "/robots"];
export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (PUBLIC.some((x) => p === x || p.startsWith(`${x}/`)) || /\.[a-z0-9]+$/i.test(p)) return NextResponse.next();
  if (req.cookies.get("pos_session")?.value) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url), 307);
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
