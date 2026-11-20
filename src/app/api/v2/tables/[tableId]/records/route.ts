import { NextResponse } from "next/server";
import { apiCreateRecords, apiListRecords, authV2, handle } from "@/server/platform/api-v2";

export async function GET(req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  const ctx = await authV2(req, "records:read");
  if (ctx instanceof NextResponse) return ctx;
  const { tableId } = await params;
  return handle(() => apiListRecords(ctx, tableId, new URL(req.url).searchParams));
}

export async function POST(req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  const ctx = await authV2(req, "records:write");
  if (ctx instanceof NextResponse) return ctx;
  const { tableId } = await params;
  const body = await req.json().catch(() => null);
  return handle(() => apiCreateRecords(ctx, tableId, body), 201);
}
