import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/request";
import { readAttachment } from "@/server/services/attachments";
import { toResult } from "@/server/errors";

/** Per-file authorised download with on-read SHA-256 verification. Never a public URL. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const r = await toResult(() => readAttachment(ctx, id));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code === "forbidden" ? 403 : 404 });
  return new NextResponse(new Uint8Array(r.data.bytes), {
    headers: {
      "Content-Type": r.data.meta.contentType, "Content-Length": String(r.data.bytes.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(r.data.meta.filename)}`,
      "Cache-Control": "private, no-store", "X-Content-SHA256": r.data.meta.sha256,
    },
  });
}
