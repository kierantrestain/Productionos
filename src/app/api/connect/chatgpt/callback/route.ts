import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getContext } from "@/server/auth/request";
import { finishChatgptConnect } from "@/server/integrations/chatgpt";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => { const r = NextResponse.redirect(new URL(`/workspace/settings?tab=apps&${q}`, url)); r.cookies.delete({ name: "siwc", path: "/api/connect/chatgpt" }); return r; };
  const ctx = await getContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", url));
  if (url.searchParams.get("error")) return back(`error=${encodeURIComponent(url.searchParams.get("error_description") ?? "ChatGPT sign-in was cancelled.")}`);
  let saved: { s?: string; v?: string; u?: string } = {};
  try { saved = JSON.parse((await cookies()).get("siwc")?.value ?? "{}"); } catch { /* invalid cookie */ }
  if (!saved.v || saved.u !== ctx.userId) return back("error=Your%20sign-in%20session%20expired.%20Please%20try%20again.");
  try {
    await finishChatgptConnect(ctx, { code: url.searchParams.get("code") ?? "", state: url.searchParams.get("state") ?? "", expectedState: saved.s ?? "", verifier: saved.v, redirectUri: `${url.origin}/api/connect/chatgpt/callback` });
    return back("connected=chatgpt");
  } catch (e) { return back(`error=${encodeURIComponent((e as Error).message)}`); }
}
