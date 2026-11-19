import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { outboundMessages, outboxEvents, workflowDefinitions, workflowRuns } from "@/db/schema";
import { requirePageContext } from "@/server/auth/request";
import { OutboxReview, QueueControls, RetryButton, WorkflowControls } from "@/components/business-client";
import { Badge, Forbidden, PageHeader, Panel, Tabs } from "@/components/ui";
import { canRead } from "@/lib/permissions";
import { dateTime, humanize } from "@/lib/format";
import { mailStatus, signingStatus } from "@/server/integrations/providers";
import { storageStatus } from "@/server/storage";
import { productionAllowed } from "@/server/entities/crud";

export const metadata = { title: "Automations" };

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageContext();
  if (!canRead(ctx.role, "automation")) return <Forbidden what="automations" />;
  const tab = (await searchParams).tab ?? "workflows";
  const isAdmin = ctx.role === "org_admin";
  const mail = mailStatus(), sign = signingStatus(), store = storageStatus();
  const header = <PageHeader title="Operations, workflows & automation health" lede="Rules run from a transactional outbox with idempotency keys, retries and dead-lettering. Imported specifications stay blocked until implemented and tested." actions={<QueueControls isAdmin={isAdmin} />} />;
  const tabs = <Tabs tabs={[{ key: "workflows", label: "Workflow registry" }, { key: "runs", label: "Run history" }, { key: "events", label: "Event queue" }, { key: "outbox", label: "Outbox review" }, { key: "integrations", label: "Integrations" }]} active={tab} base="/automations" />;
  if (tab === "runs" || tab === "events") {
    const runs = tab === "runs" ? await db.select().from(workflowRuns).where(eq(workflowRuns.orgId, ctx.orgId)).orderBy(desc(workflowRuns.startedAt)).limit(200) : [];
    const events = tab === "events" ? await db.select().from(outboxEvents).where(eq(outboxEvents.orgId, ctx.orgId)).orderBy(desc(outboxEvents.occurredAt)).limit(200) : [];
    return (<>{header}{tabs}
      <Panel flush>{tab === "runs" ? (
        <div className="table-wrap" style={{ border: 0 }}><table className="data"><thead><tr><th>Workflow</th><th>Status</th><th>Attempts</th><th>Result</th><th>Error</th><th>Finished</th></tr></thead>
          <tbody>{runs.map((r) => <tr key={r.id}><td className="mono">{r.workflowKey} v{r.ruleVersion}</td><td><Badge value={r.status} /></td><td className="num">{r.attempts}</td><td className="mono" style={{ fontSize: 11 }}>{r.result ? JSON.stringify(r.result).slice(0, 80) : ""}</td><td className="subtle">{r.lastError}</td><td>{dateTime(r.finishedAt?.toISOString())}</td></tr>)}
            {!runs.length && <tr><td colSpan={6}><div className="empty">No runs yet.</div></td></tr>}</tbody></table></div>
      ) : (
        <div className="table-wrap" style={{ border: 0 }}><table className="data"><thead><tr><th>Event</th><th>Origin</th><th>Status</th><th>Attempts</th><th>Error</th><th>Occurred</th><th /></tr></thead>
          <tbody>{events.map((e) => <tr key={e.id}><td className="mono">{e.type}</td><td>{humanize(e.origin)}</td><td><Badge value={e.status} /></td><td className="num">{e.attempts}</td><td className="subtle">{e.lastError}</td><td>{dateTime(e.occurredAt.toISOString())}</td><td>{isAdmin && ["failed", "dead"].includes(e.status) && <RetryButton id={e.id} />}</td></tr>)}
            {!events.length && <tr><td colSpan={7}><div className="empty">Queue is empty.</div></td></tr>}</tbody></table></div>
      )}</Panel></>);
  }
  if (tab === "outbox") {
    const msgs = (await db.select().from(outboundMessages).where(eq(outboundMessages.orgId, ctx.orgId)).orderBy(desc(outboundMessages.createdAt)).limit(300)).filter((m) => !m.productionId || productionAllowed(ctx, m.productionId));
    return (<>{header}{tabs}<OutboxReview provider={mail} messages={msgs.map((m) => ({ id: m.id, to: m.toAddress, subject: m.subject, body: m.body, status: m.status, template: m.template, lastError: m.lastError, createdAt: m.createdAt.toISOString() }))} /></>);
  }
  if (tab === "integrations") {
    const rows = [
      { name: "Email delivery", s: mail.enabled ? "active" : "blocked", note: mail.enabled ? `Provider: ${mail.provider}` : mail.reason },
      { name: "E-signature", s: sign.enabled ? "active" : "blocked", note: sign.enabled ? `Provider: ${sign.provider}` : sign.reason },
      { name: "Object storage", s: store.durable ? "active" : "paused", note: store.note },
      { name: "Airtable migration", s: process.env.AIRTABLE_PAT ? "active" : "blocked", note: process.env.AIRTABLE_PAT ? "Read-only token configured (server-side)" : "No AIRTABLE_PAT configured — run the read-only exporter, then the importer" },
      { name: "Legacy S'appening contract credential", s: "blocked", note: "Hard-coded bearer token found in the legacy automation was NOT copied. Owner must revoke/rotate it at the issuing provider." },
    ];
    return (<>{header}{tabs}<Panel flush><ul className="list">{rows.map((r) => <li key={r.name}><strong style={{ width: 260 }}>{r.name}</strong><Badge value={r.s} /><span className="muted">{r.note}</span></li>)}</ul></Panel></>);
  }
  const defs = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.orgId, ctx.orgId))).orderBy(workflowDefinitions.source, workflowDefinitions.key);
  return (<>{header}{tabs}
    <Panel flush><div className="table-wrap" style={{ border: 0 }}><table className="data">
      <thead><tr><th>Key</th><th>Workflow</th><th>Source</th><th>Trigger</th><th>Status</th><th>Disposition</th><th>Evidence</th><th /></tr></thead>
      <tbody>{defs.map((d) => (
        <tr key={d.id}><td className="mono">{d.key}</td><td style={{ whiteSpace: "normal", minWidth: 200 }}>{d.name}{d.requiresApproval && <span className="badge plain" style={{ marginLeft: 6 }}>human-gated</span>}</td>
          <td>{humanize(d.source)}{d.sourceDeployment ? <div className="subtle" style={{ fontSize: 11 }}>{humanize(d.sourceDeployment)}</div> : null}</td>
          <td className="mono" style={{ fontSize: 12 }}>{d.triggerEvent ?? "—"}</td><td><Badge value={d.status} /></td><td><Badge value={d.disposition} /></td>
          <td className="subtle" style={{ whiteSpace: "normal", fontSize: 12, minWidth: 260 }}>{d.dispositionEvidence}</td>
          <td><WorkflowControls id={d.id} status={d.status} disposition={d.disposition} isAdmin={isAdmin} /></td></tr>))}
      </tbody></table></div></Panel>
    <p className="subtle" style={{ marginTop: 8, fontSize: 12 }}>Ovation’s 22 Automation Control Centre rows appear here only after an authorised import, as blocked specifications.</p>
  </>);
}
