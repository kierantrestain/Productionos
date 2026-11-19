import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/request";
import { uploadAttachment } from "@/server/services/attachments";
import { toResult } from "@/server/errors";

export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  const r = await toResult(async () => uploadAttachment(ctx, String(fd.get("entityType")), String(fd.get("entityId")), { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) }));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code === "forbidden" ? 403 : r.code === "not_found" ? 404 : 400 });
  return NextResponse.json({ id: r.data.id, sha256: r.data.sha256 });
}
