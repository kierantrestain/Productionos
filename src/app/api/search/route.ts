import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/request";
import { listEntity, refLabel } from "@/server/entities/crud";
import { getEntity } from "@/lib/entities";
import { canRead } from "@/lib/permissions";

const SEARCH = [
  { entity: "productions", href: (r: any) => `/productions/${r.id}` },
  { entity: "episodes", href: (r: any) => `/productions/${r.productionId}?tab=episodes&f_episodeId=${r.id}` },
  { entity: "scenes", href: (r: any) => `/productions/${r.productionId}/scenes/${r.id}` },
  { entity: "ip_projects", href: (r: any) => `/data/ip_projects/${r.id}` },
  { entity: "people", href: (r: any) => `/data/people/${r.id}` },
  { entity: "locations", href: (r: any) => `/data/locations/${r.id}` },
  { entity: "resources", href: (r: any) => `/data/resources/${r.id}` },
  { entity: "contracts", href: (r: any) => `/data/contracts/${r.id}` },
  { entity: "companies", href: (r: any) => `/data/companies/${r.id}` },
  { entity: "deliverables", href: (r: any) => `/data/deliverables/${r.id}` },
  { entity: "tasks", href: (r: any) => `/data/tasks/${r.id}` },
];

export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ results: [] }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  if (q.length < 2) return NextResponse.json({ results: [] });
  const results: { href: string; label: string; kind: string }[] = [];
  for (const s of SEARCH) {
    const d = getEntity(s.entity)!;
    if (!canRead(ctx.role, d.readDomain ?? d.domain)) continue;
    const r = await listEntity(ctx, s.entity, { q, pageSize: 5 });
    for (const row of r.rows) results.push({ href: s.href(row), label: refLabel(d, row), kind: d.label });
  }
  return NextResponse.json({ results: results.slice(0, 30) });
}
