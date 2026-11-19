import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { importBatches, importExceptions, productions, sourceRecords } from "@/db/schema";
import { requirePageContext } from "@/server/auth/request";
import { listApiTokens, listInvites, listMembers } from "@/server/services/admin";
import { DISPOSITION } from "@/server/import/disposition";
import { AdminMembers, AdminTokens } from "@/components/admin-client";
import { Badge, Forbidden, PageHeader, Panel, Tabs } from "@/components/ui";
import { dateTime, humanize } from "@/lib/format";

export const metadata = { title: "Admin & migration" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageContext();
  if (ctx.role !== "org_admin") return <Forbidden what="administration" />;
  const tab = (await searchParams).tab ?? "users";
  const header = <PageHeader title="Admin & migration" lede="Users, roles and production access; integration tokens; Airtable migration lineage and reconciliation." />;
  const tabs = <Tabs tabs={[{ key: "users", label: "Users & roles" }, { key: "tokens", label: "API tokens" }, { key: "migration", label: "Migration" }, { key: "mapping", label: "90-table mapping" }]} active={tab} base="/admin" />;
  if (tab === "users") {
    const [members, invites, prods] = await Promise.all([listMembers(ctx), listInvites(ctx), db.select({ id: productions.id, title: productions.title }).from(productions).where(eq(productions.orgId, ctx.orgId))]);
    return <>{header}{tabs}<AdminMembers me={ctx.userId} members={members.map((m) => ({ ...m, disabledAt: m.disabledAt?.toISOString() ?? null, lastLoginAt: m.lastLoginAt?.toISOString() ?? null }))} invites={invites.map((i) => ({ ...i, acceptedAt: i.acceptedAt?.toISOString() ?? null, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString() }))} productions={prods} /></>;
  }
  if (tab === "tokens") {
    const tokens = await listApiTokens(ctx);
    return <>{header}{tabs}<AdminTokens tokens={tokens.map((t) => ({ ...t, lastUsedAt: t.lastUsedAt?.toISOString() ?? null, revokedAt: t.revokedAt?.toISOString() ?? null, createdAt: t.createdAt.toISOString() }))} /></>;
  }
  if (tab === "mapping") {
    const imported = await db.select({ tableId: sourceRecords.tableId, n: count() }).from(sourceRecords).where(eq(sourceRecords.orgId, ctx.orgId)).groupBy(sourceRecords.tableId);
    const n = new Map(imported.map((i) => [i.tableId, Number(i.n)]));
    return <>{header}{tabs}<Panel flush><div className="table-wrap" style={{ border: 0, maxHeight: "none" }}><table className="data">
      <thead><tr><th>Base</th><th>Source table</th><th>Table ID</th><th className="num">Audit records</th><th className="num">Imported lineage</th><th>Disposition</th><th>Target</th><th>Note</th></tr></thead>
      <tbody>{DISPOSITION.map((d) => <tr key={d.tableId}><td>{d.base}</td><td>{d.table}</td><td className="mono">{d.tableId}</td><td className="num">{d.auditRecords}</td><td className="num">{n.get(d.tableId) ?? 0}</td><td><Badge value={d.kind === "canonical" ? "implemented" : d.kind === "archived" ? "paused" : "draft"} label={humanize(d.kind)} /></td><td className="mono" style={{ fontSize: 12 }}>{d.target}</td><td className="subtle" style={{ whiteSpace: "normal", fontSize: 12, minWidth: 240 }}>{d.note}</td></tr>)}</tbody>
    </table></div></Panel></>;
  }
  const [batches, exceptions, totals] = await Promise.all([
    db.select().from(importBatches).where(eq(importBatches.orgId, ctx.orgId)).orderBy(desc(importBatches.startedAt)).limit(20),
    db.select().from(importExceptions).where(eq(importExceptions.orgId, ctx.orgId)).orderBy(desc(importExceptions.createdAt)).limit(200),
    db.select({ status: sourceRecords.migrationStatus, n: sql<number>`count(*)::int` }).from(sourceRecords).where(eq(sourceRecords.orgId, ctx.orgId)).groupBy(sourceRecords.migrationStatus),
  ]);
  return <>{header}{tabs}
    <div className="notice warn" style={{ marginBottom: 16 }}>Live migration has not run in this environment: no read-only Airtable credential is configured. Use <span className="mono">tools/airtable/export_airtable_readonly.py</span> then <span className="mono">pnpm import:airtable --dir &lt;export&gt; --org &lt;slug&gt;</span> (dry-run by default). Both Airtable bases stay untouched.</div>
    <div className="metrics">{totals.length ? totals.map((t) => <div key={t.status} className="metric"><div className="v">{t.n}</div><div className="l">Source records · {humanize(t.status)}</div></div>) : <div className="metric"><div className="v">0</div><div className="l">Source records imported</div></div>}</div>
    <div className="grid-halves">
      <Panel title="Import batches" flush><ul className="list">{batches.map((b) => <li key={b.id}><Badge value={b.status} /><span style={{ flex: 1 }}>{humanize(b.mode)} · {b.sourceLabel}</span><span className="subtle">{dateTime(b.startedAt.toISOString())}</span></li>)}{!batches.length && <li className="subtle">No imports yet.</li>}</ul></Panel>
      <Panel title={`Exception queue (${exceptions.length})`} flush><ul className="list" style={{ maxHeight: 420, overflow: "auto" }}>{exceptions.map((e) => <li key={e.id} style={{ alignItems: "flex-start" }}><span className="badge tone-warn">{humanize(e.kind)}</span><span style={{ flex: 1, fontSize: 13 }}>{e.detail}<div className="subtle mono" style={{ fontSize: 11 }}>{e.tableId}{e.recordId ? ` / ${e.recordId}` : ""}</div></span></li>)}{!exceptions.length && <li className="subtle">No exceptions.</li>}</ul></Panel>
    </div>
  </>;
}
