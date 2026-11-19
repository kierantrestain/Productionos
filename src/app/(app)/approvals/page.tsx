import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { approvalDecisions, users } from "@/db/schema";
import { requirePageContext } from "@/server/auth/request";
import { listApprovals } from "@/server/services/approvals";
import { ApprovalRow } from "@/components/business-client";
import { Empty, Forbidden, PageHeader, Tabs } from "@/components/ui";
import { canRead } from "@/lib/permissions";

export const metadata = { title: "Approvals" };
const HREF: Record<string, string> = { purchase_orders: "purchase_orders", expenses: "expenses", budgets: "budgets", greenlight_gates: "greenlight_gates", contracts: "contracts" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageContext();
  if (!canRead(ctx.role, "approvals")) return <Forbidden what="approvals" />;
  const tab = (await searchParams).tab === "all" ? "all" : "pending";
  const rows = await listApprovals(ctx, tab);
  const chains = rows.length ? await db.select().from(approvalDecisions).where(inArray(approvalDecisions.approvalRequestId, rows.map((r) => r.id))).orderBy(approvalDecisions.at) : [];
  const names = new Map((chains.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...new Set(chains.map((c) => c.actorUserId))])) : []).map((u) => [u.id, u.name]));
  const actionable = rows.filter((r) => r.canDecide);
  return (
    <>
      <PageHeader title="Approvals" lede="Budgets, purchase orders, expenses, greenlight gates and contracts. Authority is checked on the server, requesters cannot approve their own items, and every decision is permanent." />
      <Tabs tabs={[{ key: "pending", label: "Pending", count: tab === "pending" ? rows.length : undefined }, { key: "all", label: "All history" }]} active={tab} base="/approvals" />
      {tab === "pending" && actionable.length > 0 && <div className="notice info" style={{ marginBottom: 12 }}>{actionable.length} item(s) are waiting for your decision.</div>}
      <section className="panel">
        {rows.length === 0 ? <Empty title={tab === "pending" ? "Nothing awaiting approval" : "No approvals yet"}>Submit a PO, expense, budget, gate or contract from its record page.</Empty> : (
          <ul className="list">{rows.map((r) => (
            <ApprovalRow key={r.id} isMine={r.requestedBy === ctx.userId} href={r.historical ? null : HREF[r.subjectType] ? `/data/${HREF[r.subjectType]}/${r.subjectId}` : null}
              a={{ ...r, createdAt: r.createdAt.toISOString(), title: r.historical ? `${r.title} (historical import — read only)` : r.title }}
              chain={chains.filter((c) => c.approvalRequestId === r.id).map((c) => ({ decision: c.decision, actorRole: c.actorRole, at: c.at.toISOString(), note: c.note, actor: names.get(c.actorUserId) ?? "Unknown" }))} />
          ))}</ul>)}
      </section>
    </>
  );
}
