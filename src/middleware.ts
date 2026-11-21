import { NextResponse, type NextRequest } from "next/server";

/**
 * Signed-out visitors go straight to /login with a 307 before any page renders. This is only a fast
 * path: every page and action still checks the session itself (the cookie may be expired or revoked).
 */
const PUBLIC = ["/login", "/api", "/form", "/invite", "/setup", "/_next", "/favicon", "/robots"];
const SUITE_PATHS = ["/production", "/productions", "/schedule", "/people", "/resources", "/budgets", "/post", "/rights", "/commercial", "/executive", "/operations", "/automations", "/settings", "/admin", "/approvals", "/slate", "/my", "/callsheets", "/data"];
export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  // The Production Suite is now its own app (repo kierantrestain/Production-suite). Old suite links
  // forward there when SUITE_URL is configured, and to the workspace home otherwise.
  if (SUITE_PATHS.some((x) => p === x || p.startsWith(`${x}/`))) {
    const suite = process.env.SUITE_URL;
    return NextResponse.redirect(suite ? new URL(p + req.nextUrl.search, suite) : new URL("/", req.url), 308);
  }
  if (PUBLIC.some((x) => p === x || p.startsWith(`${x}/`)) || /\.[a-z0-9]+$/i.test(p)) return NextResponse.next();
  if (req.cookies.get("pos_session")?.value) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url), 307);
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
