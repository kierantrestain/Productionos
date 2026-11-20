import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/request";
import { startChatgptConnect } from "@/server/integrations/chatgpt";

/** Begin "Connect your ChatGPT plan": PKCE verifier + state go in a short-lived httpOnly cookie. */
export async function GET(req: Request) {
  const ctx = await getContext();
  const url = new URL(req.url);
  if (!ctx) return NextResponse.redirect(new URL("/login", url));
  const redirectUri = `${url.origin}/api/connect/chatgpt/callback`;
  try {
    const s = await startChatgptConnect(redirectUri);
    const res = NextResponse.redirect(s.url);
    res.cookies.set("siwc", JSON.stringify({ s: s.state, v: s.verifier, u: ctx.userId }), { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/api/connect/chatgpt", maxAge: 600 });
    return res;
  } catch (e) {
    return NextResponse.redirect(new URL(`/workspace/settings?tab=apps&error=${encodeURIComponent((e as Error).message)}`, url));
  }
}
