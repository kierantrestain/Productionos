import { NextResponse } from "next/server";
import { apiListBases, authV2, handle } from "@/server/platform/api-v2";

export async function GET(req: Request) {
  const ctx = await authV2(req, "bases:read");
  if (ctx instanceof NextResponse) return ctx;
  return handle(() => apiListBases(ctx));
}
