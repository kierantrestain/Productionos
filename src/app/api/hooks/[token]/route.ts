import { NextResponse } from "next/server";
import { toResult } from "@/server/errors";
import { receiveWebhook } from "@/server/platform/automations";

/** Inbound webhook trigger. The secret token in the path identifies the automation; body ≤ 256 KB JSON. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const text = await req.text();
  if (text.length > 256 * 1024) return NextResponse.json({ error: "Body too large" }, { status: 413 });
  let body: unknown; try { body = JSON.parse(text || "{}"); } catch { return NextResponse.json({ error: "Body must be JSON" }, { status: 400 }); }
  const r = await toResult(() => receiveWebhook(token, body));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code === "not_found" ? 404 : 400 });
  return NextResponse.json({ ok: true, ...r.data });
}
