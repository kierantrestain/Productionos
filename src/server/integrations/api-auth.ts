import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiTokens, organisations } from "@/db/schema";
import type { Ctx } from "../auth/context";
import { sha256 } from "../auth/password";

/**
 * Authenticated integration boundary for SWDR / Mimic OS. Bearer token → org-scoped, scope-limited
 * context. External systems never get database access; they get versioned JSON contracts.
 */
export async function apiContext(req: Request, scope: string): Promise<{ ctx: Ctx; tokenName: string } | NextResponse> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token.startsWith("pos_")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [t] = await db.select({ t: apiTokens, org: organisations }).from(apiTokens).innerJoin(organisations, eq(organisations.id, apiTokens.orgId))
    .where(and(eq(apiTokens.tokenHash, sha256(token)), isNull(apiTokens.revokedAt))).limit(1);
  if (!t) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!t.t.scopes.includes(scope)) return NextResponse.json({ error: `missing scope ${scope}` }, { status: 403 });
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, t.t.id));
  // Integrations read with executive-level visibility but only through the endpoints below; field redaction still applies.
  return { tokenName: t.t.name, ctx: { userId: t.t.createdBy ?? "00000000-0000-0000-0000-000000000000", orgId: t.org.id, role: "executive", name: `API: ${t.t.name}`, email: "", personId: null, productionIds: "all", orgName: t.org.name, orgIsDemo: t.org.isDemo } };
}
