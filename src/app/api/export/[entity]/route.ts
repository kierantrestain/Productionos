import { NextResponse } from "next/server";
import { getEntity } from "@/lib/entities";
import { getContext } from "@/server/auth/request";
import { listEntity } from "@/server/entities/crud";
import { toResult } from "@/server/errors";
import { audit } from "@/server/audit";
import { db } from "@/db";
import { customValuesFor, listFieldDefs } from "@/server/services/customise";

const csv = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };

/** Permission-checked CSV export of the current filtered view (redacted fields stay redacted). */
export async function GET(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { entity } = await params;
  const d = getEntity(entity);
  if (!d) return NextResponse.json({ error: "Unknown entity" }, { status: 404 });
  const url = new URL(req.url);
  const filters: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { if (k.startsWith("f_")) filters[k.slice(2)] = v; });
  const r = await toResult(() => listEntity(ctx, entity, { q: url.searchParams.get("q") ?? undefined, filters, pageSize: 1000 }));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code === "forbidden" ? 403 : 400 });
  const fields = d.fields.filter((f) => !r.data.redacted.includes(f.key));
  const defs = await listFieldDefs(ctx, entity);
  const cv = defs.length ? await customValuesFor(ctx, entity, r.data.rows.map((x) => x.id)) : {};
  const lines = [["id", ...fields.map((f) => f.label), ...defs.map((c) => c.label)].map(csv).join(",")];
  for (const row of r.data.rows) {
    lines.push([row.id, ...fields.map((f) => f.type === "ref" ? r.data.refs[f.ref!]?.[String(row[f.key])] ?? "" : f.type === "money" && row[f.key] != null ? (Number(row[f.key]) / 100).toFixed(2) : row[f.key]),
      ...defs.map((c) => { const v = cv[row.id]?.[c.key]; return c.type === "money" && v != null ? (Number(v) / 100).toFixed(2) : v; })].map(csv).join(","));
  }
  await audit(db, ctx, "export", entity, null, { meta: { rows: r.data.rows.length, filters } });
  return new NextResponse(lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${entity}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
