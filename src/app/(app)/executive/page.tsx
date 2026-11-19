import { requirePageContext } from "@/server/auth/request";
import { Workspace } from "@/components/workspace";
import type { SP } from "@/components/entity-view";
import { EntityView } from "@/components/entity-view";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { kpis } from "@/db/schema";
import { metricValue, METRIC_DEFS } from "@/server/services/dashboard";
import Link from "next/link";

export const metadata = { title: "Governance" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  return <Workspace ctx={ctx} sp={sp} base="/executive" title="Governance" lede="Business units, legal entities, initiatives, risks, KPIs and funding. Restricted to executive and finance/legal roles." tabs={[
    { key: "risks", label: "Risk register", entity: "risks" },
    { key: "kpis", label: "KPIs & targets", entity: "kpis", render: async () => {
      const rows = await db.select().from(kpis).where(and(eq(kpis.orgId, ctx.orgId), isNull(kpis.archivedAt)));
      const vals = await Promise.all(rows.map((k) => (k.metricKey ? metricValue(ctx, k.metricKey) : Promise.resolve(null))));
      return (<>
        {rows.length > 0 && <div className="metrics">{rows.map((k, i) => {
          const live = k.metricKey != null; const v = live ? vals[i] : k.manualValue;
          const href = METRIC_DEFS.find((m) => m.key === k.metricKey)?.href ?? `/data/kpis/${k.id}`;
          return <Link key={k.id} href={href} className="metric" title={k.definition ?? ""}><div className="v">{v ?? "—"}</div><div className="l">{k.name}{k.target ? ` · target ${k.target}` : ""}</div><div className="subtle" style={{ fontSize: 11 }}>{live ? "Live from database" : k.manualValueAsOf ? `Reported as of ${k.manualValueAsOf}` : "Manual — no as-of date"}</div></Link>;
        })}</div>}
        <EntityView ctx={ctx} entity="kpis" sp={sp} />
      </>);
    } },
    { key: "funding", label: "Funding & capital", entity: "funding_sources" },
    { key: "initiatives", label: "Strategic initiatives", entity: "strategic_initiatives" },
    { key: "units", label: "Business units", entity: "business_units" },
    { key: "entities", label: "Legal entities & SPVs", entity: "legal_entities" },
    { key: "meetings", label: "Board & meetings", entity: "meetings", fixed: { kind: "board" } },
  ]} />;
}
