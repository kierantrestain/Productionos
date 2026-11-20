import { NextResponse } from "next/server";
import { apiDeleteRecord, apiGetRecord, apiUpdateRecord, authV2, handle } from "@/server/platform/api-v2";

type P = { params: Promise<{ tableId: string; recordId: string }> };

export async function GET(req: Request, { params }: P) {
  const ctx = await authV2(req, "records:read");
  if (ctx instanceof NextResponse) return ctx;
  const { tableId, recordId } = await params;
  return handle(() => apiGetRecord(ctx, tableId, recordId));
}

export async function PATCH(req: Request, { params }: P) {
  const ctx = await authV2(req, "records:write");
  if (ctx instanceof NextResponse) return ctx;
  const { tableId, recordId } = await params;
  const body = await req.json().catch(() => null);
  return handle(() => apiUpdateRecord(ctx, tableId, recordId, body));
}

export async function DELETE(req: Request, { params }: P) {
  const ctx = await authV2(req, "records:write");
  if (ctx instanceof NextResponse) return ctx;
  const { tableId, recordId } = await params;
  return handle(() => apiDeleteRecord(ctx, tableId, recordId));
}
