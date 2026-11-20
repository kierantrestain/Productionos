import { NextResponse } from "next/server";
import { toResult } from "@/server/errors";
import { uploadPublicFormFile } from "@/server/platform/public-form";

export const maxDuration = 60;

/** Public form file upload (no sign-in): multipart `file` + `fieldId`. Limits are enforced in uploadPublicFormFile. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > 10 * 1024 * 1024 + 64 * 1024) return NextResponse.json({ error: "Files must be 10 MB or smaller." }, { status: 413 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Send multipart/form-data." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  const r = await toResult(async () => uploadPublicFormFile(token, String(form.get("fieldId") ?? ""), { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) }));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code === "not_found" ? 404 : 400 });
  return NextResponse.json({ ok: true, attachment: r.data });
}
