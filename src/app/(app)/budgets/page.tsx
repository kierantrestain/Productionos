import { requirePageContext } from "@/server/auth/request";
import { Workspace } from "@/components/workspace";
import type { SP } from "@/components/entity-view";

export const metadata = { title: "Budgets & spend" };
export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  return <Workspace ctx={ctx} sp={await searchParams} base="/budgets" title="Budgets, expenses & approvals"
    lede="Estimate, approved, committed, actual and forecast kept distinct, in pounds with VAT. POs and expenses route to the right approver by amount."
    tabs={[
      { key: "budgets", label: "Budgets", entity: "budgets", recordBase: "/budgets" },
      { key: "lines", label: "Budget lines", entity: "budget_lines" },
      { key: "pos", label: "Purchase orders", entity: "purchase_orders" },
      { key: "expenses", label: "Expenses & actuals", entity: "expenses" },
      { key: "funding", label: "Funding & capital", entity: "funding_sources" },
    ]} />;
}
