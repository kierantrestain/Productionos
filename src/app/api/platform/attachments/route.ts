import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/request";
import { toResult } from "@/server/errors";
import { MAX_ATTACHMENT_BYTES, uploadRecordAttachment } from "@/server/platform/attachments";

export const maxDuration = 60;

/** Upload one file to an attachment field: multipart form with `file`, `recordId`, `fieldId`. */
export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_ATTACHMENT_BYTES + 64 * 1024) return NextResponse.json({ error: "Files must be 25 MB or smaller." }, { status: 413 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Send multipart/form-data." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  const r = await toResult(async () => uploadRecordAttachment(ctx, { recordId: String(form.get("recordId") ?? ""), fieldId: String(form.get("fieldId") ?? ""), name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) }));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code === "forbidden" ? 403 : r.code === "not_found" ? 404 : 400 });
  return NextResponse.json({ ok: true, attachment: r.data });
}
