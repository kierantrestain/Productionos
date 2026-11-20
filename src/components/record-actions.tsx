"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Role } from "@/lib/permissions";
import {
  advanceDeliverableAction, approveDeliverableAction, decideEditAction, draftCastDetailsAction, generateContractAction,
  markDeliveredAction, markSignedAction, requestApprovalAction, requestSignatureAction,
} from "@/app/actions";
import { Drawer, useRun } from "./client";
import { promptDialog } from "@/components/ui/dialogs";

type Row = Record<string, unknown> & { id: string };

/** Workflow actions shown on record pages. Each is re-checked server-side. */
export function RecordActions({ entity, row, role, attachments = [] }: { entity: string; row: Row; role: Role; attachments?: { id: string; filename: string }[] }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [signOpen, setSignOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [evidence, setEvidence] = useState("");
  const ok = async (p: Promise<unknown>) => { if ((await p) !== undefined) router.refresh(); };
  const status = String(row.status ?? "");
  const a: React.ReactNode[] = [];

  const submit = (t: "purchase_orders" | "expenses" | "budgets" | "greenlight_gates" | "contracts") =>
    a.push(<button key="submit" className="btn btn-primary" disabled={pending} onClick={() => ok(run(requestApprovalAction(t, row.id), "Submitted for approval"))}>Submit for approval</button>);

  switch (entity) {
    case "productions": a.push(<Link key="o" className="btn btn-primary" href={`/productions/${row.id}`}>Open production workspace</Link>); break;
    case "scenes": a.push(<Link key="o" className="btn btn-primary" href={`/productions/${row.productionId}/scenes/${row.id}`}>Open breakdown & shot list</Link>); break;
    case "shoot_days": a.push(<Link key="o" className="btn btn-primary" href={`/schedule/day/${row.id}`}>Open Shoot-Day Command</Link>); break;
    case "budgets": a.push(<Link key="o" className="btn" href={`/budgets/${row.id}`}>Budget-to-actual</Link>); if (["draft"].includes(status)) submit("budgets"); break;
    case "purchase_orders": if (["draft", "rejected"].includes(status)) submit("purchase_orders"); break;
    case "expenses": if (["draft", "submitted", "rejected"].includes(status) && !row.approvalRequestId) submit("expenses"); break;
    case "greenlight_gates": if (["pending", "rejected", "deferred"].includes(status)) submit("greenlight_gates"); break;
    case "contracts":
      if (["draft", "blocked"].includes(status)) a.push(<button key="g" className="btn" disabled={pending} onClick={() => ok(run(generateContractAction(row.id), "Contract generated"))}>Generate document</button>);
      if (["draft", "generated", "blocked"].includes(status)) submit("contracts");
      if (["approved", "blocked"].includes(status)) a.push(<button key="s" className="btn" onClick={() => setSendOpen(true)}>Send for signature…</button>);
      if (["approved", "sent", "generated", "blocked"].includes(status)) a.push(<button key="m" className="btn" onClick={() => setSignOpen(true)}>Record signed copy…</button>);
      break;
    case "engagements": a.push(<button key="e" className="btn" disabled={pending} onClick={() => ok(run(draftCastDetailsAction(row.id), "Draft created — review it in Automations → Outbox"))}>Draft role-details email</button>); break;
    case "edit_versions":
      if (["org_admin", "executive", "producer", "external_reviewer"].includes(role) && status === "in_review") {
        a.push(<button key="ap" className="btn btn-primary" disabled={pending} onClick={() => ok(run(decideEditAction(row.id, "approved"), "Cut approved"))}>Approve cut</button>);
        a.push(<button key="cr" className="btn" disabled={pending} onClick={() => ok(run(decideEditAction(row.id, "changes_requested"), "Changes requested"))}>Request changes</button>);
      }
      break;
    case "deliverables": {
      const next: Record<string, string[]> = { pending: ["in_progress"], in_progress: ["qc", "ready_for_approval"], qc: ["ready_for_approval", "in_progress"], ready_for_approval: ["in_progress"], rejected: ["in_progress"] };
      for (const to of next[status] ?? []) a.push(<button key={to} className="btn" disabled={pending} onClick={() => ok(run(advanceDeliverableAction(row.id, to), "Updated"))}>Move to {to.replace(/_/g, " ")}</button>);
      if (["ready_for_approval", "qc"].includes(status) && ["org_admin", "executive", "producer"].includes(role)) {
        a.push(<button key="ap" className="btn btn-primary" disabled={pending} onClick={() => ok(run(approveDeliverableAction(row.id, "approved"), "Deliverable approved"))}>Approve deliverable</button>);
        a.push(<button key="rj" className="btn btn-danger" disabled={pending} onClick={async () => { const n = (await promptDialog("Reason for rejection")); if (n) ok(run(approveDeliverableAction(row.id, "rejected", n), "Rejected")); }}>Reject</button>);
      }
      if (status === "approved") a.push(<button key="dl" className="btn btn-primary" disabled={pending} onClick={() => ok(run(markDeliveredAction(row.id), "Marked delivered"))}>Mark delivered</button>);
      break;
    }
  }
  return (
    <>
      {a}
      <Drawer modal open={sendOpen} onClose={() => setSendOpen(false)} title="Send for signature"
        footer={<><button className="btn" onClick={() => setSendOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={pending} onClick={async () => { const r = await run(requestSignatureAction(row.id, true)); setSendOpen(false); if (r) router.refresh(); }}>Confirm and send</button></>}>
        <p>This sends <strong>{String(row.title)}</strong> to the configured e-signature provider. If no provider is configured the contract will be marked <strong>blocked</strong> — it will never be marked sent or signed without a real provider response.</p>
      </Drawer>
      <Drawer modal open={signOpen} onClose={() => setSignOpen(false)} title="Record signed copy"
        footer={<><button className="btn" onClick={() => setSignOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!evidence || pending} onClick={async () => { if (await run(markSignedAction(row.id, evidence), "Contract marked signed")) { setSignOpen(false); router.refresh(); } }}>Mark signed</button></>}>
        <p className="muted" style={{ marginBottom: 12 }}>Signed status requires evidence. Upload the fully signed document under Documents, then select it here.</p>
        {attachments.length === 0 ? <div className="notice warn">No documents attached to this contract yet.</div> : (
          <select className="select" value={evidence} onChange={(e) => setEvidence(e.target.value)} aria-label="Signature evidence">
            <option value="">Select signed document…</option>
            {attachments.map((x) => <option key={x.id} value={x.id}>{x.filename}</option>)}
          </select>
        )}
      </Drawer>
    </>
  );
}
