# Automation and workflow recovery register

The 19-Nov source audit confirmed **four** S’appening native automations (three deployed, one undeployed) and **22 Ovation Automation Control Centre records** (written specifications, not native deployed Airtable automations). This file records verified behaviour at the level made available in the source audit; do not invent missing expressions, scripts or trigger timings. A builder with source access must fetch full current configurations, test the execution path and write down any change before porting.

| Source | Status as observed | Trigger/action | Recommended destination | Guard |
|---|---|---|---|---|
| S’appening: Update Shot List when Scene Name and Director are not empty | Deployed | Trigger after scene naming/director; search Shot List; create shot record | Events: `scene.ready_for_shots` → `shot.generate_if_missing` | DB unique guard, idempotency, transactions, manual override and audit |
| S’appening: Send Cast Contract | Deployed | Cast Contract Status=`Create Contract`; external service document generation and status update | Human-gated contract generation, delivery, signature proof, retries | **Legacy script hard-coded bearer token. Revoke/rotate, never copy.** No fake Signed status |
| S’appening: Automation 2 | **Undeployed** | Cast checkbox triggers status to Signed | Disabled draft rule | Do not enable without actual signed evidence |
| S’appening: Send Cast Details | Deployed | Explicit interface action sends role details/attachments via Gmail then flags send | Review/confirm/send/outbox/idempotency + immutable delivery log | Accurate recipient, role permission, no automated email during import |
| Ovation: 22 Automation Control Centre rows | Spec records, **not native automations** | Proposed event/target/retry/test rules with keys like `AUTO-001` | Workflow-definition registry with draft/active status | Fetch individual specs and build tests before enabling any |

## Workflow engine requirements

- Each event contains immutable ID, source entity, tenant/production scope, actor, occurred time, schema version and idempotency key.
- Rules define valid trigger types, conditions, actions, approval checkpoints, version, owner, rate limits, retries, timeout and compensation/rollback if possible.
- State machine: `draft → approved → active → paused → retired`. Running instances keep their originating rule version.
- DB transactional outbox for events; at-least-once delivery with idempotent sinks; DLQ and visible retry controls.
- All sends, approvals, contract status transitions, service connections and failures are audited. Messages include preview and explicit actor confirmation where significant.
- Unit tests for double-trigger, repeated import, network failure, retry, no-approval, wrong recipient, revocation and concurrent update.
- Mark unresolved configuration as `NOT_EXPORTED` instead of silently inventing an automation.
