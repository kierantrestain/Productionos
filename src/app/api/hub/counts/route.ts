import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/request";
import { myWork } from "@/server/hub/hub";

export const dynamic = "force-dynamic";
/** My-work counts for the sidebar badge and Home strip. A plain GET (not a server action) so it never holds up page navigation. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const since = new URL(req.url).searchParams.get("since");
  const d = since ? new Date(since) : null;
  const w = await myWork(ctx, { maxTables: 25, mentionsSince: d && !isNaN(+d) ? d : new Date(Date.now() - 7 * 864e5) });
  return NextResponse.json(w.counts, { headers: { "Cache-Control": "private, no-store" } });
}
