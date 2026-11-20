import { NextResponse } from "next/server";
import { apiBaseSchema, authV2, handle } from "@/server/platform/api-v2";

export async function GET(req: Request, { params }: { params: Promise<{ baseId: string }> }) {
  const ctx = await authV2(req, "schema:read");
  if (ctx instanceof NextResponse) return ctx;
  const { baseId } = await params;
  return handle(() => apiBaseSchema(ctx, baseId));
}
