import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/request";
import { toResult } from "@/server/errors";
import { readRecordAttachment, removeRecordAttachment } from "@/server/platform/attachments";

const INLINE = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|video\/(mp4|webm)|audio\/(mpeg|wav|mp4))$/;

/** Authorised download. Images/PDF/media are shown inline (sandboxed); everything else downloads. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const r = await toResult(() => readRecordAttachment(ctx, id));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code === "forbidden" ? 403 : 404 });
  const { meta, bytes } = r.data;
  const inline = INLINE.test(meta.contentType) && new URL(req.url).searchParams.get("download") !== "1";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": meta.contentType, "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
      "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; media-src 'self'",
      "X-Content-SHA256": meta.sha256,
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const r = await toResult(() => removeRecordAttachment(ctx, id));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code === "forbidden" ? 403 : r.code === "not_found" ? 404 : 400 });
  return NextResponse.json({ ok: true });
}
