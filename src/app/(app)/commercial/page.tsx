import { requirePageContext } from "@/server/auth/request";
import { Workspace } from "@/components/workspace";
import type { SP } from "@/components/entity-view";
import { EntityView } from "@/components/entity-view";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { salesOpportunities, sponsorDeals } from "@/db/schema";
import { money } from "@/lib/format";
import { canRead } from "@/lib/permissions";

export const metadata = { title: "Commercial, sponsorship & distribution" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  return <Workspace ctx={ctx} sp={sp} base="/commercial" title="Commercial, sponsorship & distribution" lede="Sponsor and brand integrations with deliverable tracking, the sales and licensing pipeline, and release planning." tabs={[
    { key: "sponsors", label: "Sponsorship & brand", entity: "sponsor_deals" },
    { key: "commercial_deliverables", label: "Commercial deliverables", entity: "commercial_deliverables" },
    { key: "sales", label: "Sales & licensing", entity: "sales_opportunities", render: async () => {
      if (!canRead(ctx.role, "commercial")) return <EntityView ctx={ctx} entity="sales_opportunities" sp={sp} />;
      const [opps, deals] = await Promise.all([
        db.select().from(salesOpportunities).where(and(eq(salesOpportunities.orgId, ctx.orgId), isNull(salesOpportunities.archivedAt))),
        db.select().from(sponsorDeals).where(and(eq(sponsorDeals.orgId, ctx.orgId), isNull(sponsorDeals.archivedAt))),
      ]);
      const open = opps.filter((o) => ["lead", "pitched", "negotiating"].includes(o.stage));
      const sum = (xs: { valueMinor: number | null }[]) => xs.reduce((a, x) => a + Number(x.valueMinor ?? 0), 0);
      const weighted = open.reduce((a, o) => a + Math.round(Number(o.valueMinor ?? 0) * (o.probabilityPct ?? 0) / 100), 0);
      const contracted = deals.filter((d) => ["contracted", "delivering", "complete"].includes(d.stage));
      return (<>
        <div className="metrics">
          <div className="metric"><div className="v">{money(sum(open), ctx.settings?.currency ?? "GBP", { compact: true })}</div><div className="l">Open pipeline ({open.length})</div></div>
          <div className="metric" title="Σ value × probability for open opportunities"><div className="v">{money(weighted, ctx.settings?.currency ?? "GBP", { compact: true })}</div><div className="l">Weighted forecast</div></div>
          <div className="metric"><div className="v">{money(sum(opps.filter((o) => o.stage === "won")), ctx.settings?.currency ?? "GBP", { compact: true })}</div><div className="l">Won</div></div>
          <div className="metric"><div className="v">{money(sum(contracted), ctx.settings?.currency ?? "GBP", { compact: true })}</div><div className="l">Contracted sponsorship</div></div>
        </div>
        <EntityView ctx={ctx} entity="sales_opportunities" sp={sp} />
      </>);
    } },
    { key: "windows", label: "Licence windows", entity: "licence_windows" },
    { key: "releases", label: "Release & distribution", entity: "releases" },
    { key: "companies", label: "Buyers & partners", entity: "companies" },
    { key: "territories", label: "Territories", entity: "territories" },
  ]} />;
}
