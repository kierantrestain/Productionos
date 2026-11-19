import { db, type DbOrTx } from "@/db";
import { workflowDefinitions } from "@/db/schema";

/**
 * Built-in workflow definitions, including the four native S'appening automations with their
 * migration disposition. Ovation's 22 Automation Control Centre rows are NOT seeded here: they are
 * imported from the authorised Airtable export as `blocked` specs pending review, never assumed live.
 */
export const BUILTIN_WORKFLOWS = [
  {
    key: "SAP-SHOT-INIT", name: "Create initial shot when scene has a name and director", source: "sappening_native", sourceDeployment: "deployed",
    sourceRef: "S'appening automation: Update Shot List when Scene Name and Director are not empty",
    triggerEvent: "scene.ready_for_shots", action: "shot.generate_if_missing", requiresApproval: false, status: "active", disposition: "implemented",
    dispositionEvidence: "Ported with DB unique generation key + per-scene event idempotency. Repeated edits create at most one auto shot; manual shots are never touched (tests: workflows.test.ts).",
    maxAttempts: 5,
  },
  {
    key: "SAP-CAST-CONTRACT", name: "Cast contract generation and signature (human-gated)", source: "sappening_native", sourceDeployment: "deployed",
    sourceRef: "S'appening automation: Send Cast Contract (custom script; contained a hard-coded bearer credential — NOT copied, flagged for revocation)",
    triggerEvent: "contract.send_requested", action: "contract.generate → approval → signature request", requiresApproval: true, status: "active", disposition: "replaced",
    dispositionEvidence: "Replaced by generate → finance/legal approval → confirmed signature request. Without a configured signing provider contracts are marked BLOCKED, never sent/signed.",
    maxAttempts: 3,
  },
  {
    key: "SAP-CONTRACT-SIGNED-AUTO", name: "Auto-set contract status to Signed from a checkbox (undeployed in source)", source: "sappening_native", sourceDeployment: "undeployed",
    sourceRef: "S'appening automation: Automation 2 (undeployed)", triggerEvent: null, action: "contract.mark_signed", requiresApproval: true, status: "paused", disposition: "retired",
    dispositionEvidence: "Not enabled. Signed status now requires uploaded signature evidence (markContractSigned).", maxAttempts: 1,
  },
  {
    key: "SAP-CAST-DETAILS", name: "Send cast role details email", source: "sappening_native", sourceDeployment: "deployed",
    sourceRef: "S'appening automation: Send Cast Details (Gmail)", triggerEvent: "outbound_message.confirmed", action: "message.dispatch", requiresApproval: true, status: "active", disposition: "implemented",
    dispositionEvidence: "Draft → preview → explicit confirmation → outbox dispatch with idempotency and immutable log. Blocked until a mail provider is configured.",
    maxAttempts: 5,
  },
  {
    key: "SYS-MESSAGE-DISPATCH", name: "Outbound message dispatch", source: "native", sourceDeployment: null, sourceRef: null,
    triggerEvent: "outbound_message.confirmed", action: "mail.send", requiresApproval: true, status: "active", disposition: "implemented",
    dispositionEvidence: "Provider adapter disabled unless MAIL_PROVIDER + MAIL_API_KEY + ENABLE_REAL_EMAIL=true.", maxAttempts: 5,
  },
  {
    key: "SYS-CONTRACT-SEND", name: "Contract signature request dispatch", source: "native", sourceDeployment: null, sourceRef: null,
    triggerEvent: "contract.send_requested", action: "signing.request", requiresApproval: true, status: "active", disposition: "implemented",
    dispositionEvidence: "Signing adapter disabled unless SIGNING_PROVIDER + SIGNING_API_KEY + ENABLE_REAL_SIGNATURE_REQUESTS=true.", maxAttempts: 3,
  },
] as const;

export async function ensureWorkflowDefinitions(orgId: string, tx: DbOrTx = db) {
  for (const w of BUILTIN_WORKFLOWS) {
    await tx.insert(workflowDefinitions).values({ ...w, orgId, conditions: {} }).onConflictDoNothing({ target: [workflowDefinitions.orgId, workflowDefinitions.key] });
  }
}
