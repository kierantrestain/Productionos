import { NextResponse } from "next/server";
import { openApiDocument } from "@/server/platform/api-v2";

/** Public OpenAPI 3.1 description of the v2 API (no data, no auth required). */
export async function GET(req: Request) {
  return NextResponse.json(openApiDocument(new URL(req.url).origin), { headers: { "Cache-Control": "public, max-age=300" } });
}
