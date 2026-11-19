# Automation migration & verification report

Source: `docs/source/AUTOMATION_AND_RULES_REGISTER.md` (audit of 19 Nov 2026). Engine: `src/server/workflows/`. Tests: `tests/integration/journey.test.ts`, `workflows.test.ts`, `import.test.ts`.

## S’appening native automations (4)

| Key | Source automation | Source state | Disposition | Behaviour now | Verified by |
|---|---|---|---|---|---|
| `SAP-SHOT-INIT` | Update Shot List when Scene Name and Director are not empty | Deployed | **Implemented** | `scene.ready_for_shots` is emitted once per scene (idempotency key) when title and director become non-empty. The handler creates the master shot only if the scene has no shots, guarded by the unique `generation_key`. Manual and duplicated shots are never touched. Imported scenes never trigger it. | journey.test: 4 repeated edits → exactly 1 auto shot; manual + duplicate kept. E2E: auto badge appears after a UI create. Demo seed: 18 qualifying segments → 18 auto shots. |
| `SAP-CAST-CONTRACT` | Send Cast Contract (custom script, external document service) | Deployed | **Replaced** | Generate (internal) → approval by finance/legal (no self-approval) → explicit confirmation → signing-provider adapter. With no provider configured the contract is marked **blocked**, never sent. | workflows.test: blocked path, confirmation required, authority enforced. |
| `SAP-CONTRACT-SIGNED-AUTO` | Automation 2: checkbox sets status to Signed | **Undeployed** | **Retired** (registry status `paused`) | Not enabled. *Signed* requires an attached signature document (`markContractSigned`). | workflows.test: signed rejected without evidence, accepted with attached PDF; engagement status syncs. |
| `SAP-CAST-DETAILS` | Send Cast Details (Gmail) | Deployed | **Implemented** | Draft with preview → explicit confirmation (producer/PM/admin) → outbox → mail adapter. Duplicate drafts blocked by idempotency key. Without a provider: `blocked_no_provider`. Sets `details_email_sent_at` only on confirmed delivery. | workflows.test: blocked path, cast cannot confirm, exactly-once send, retry, dead-letter, operator retry. |

### Legacy credential (security)
The audit found a **hard-coded bearer credential** in the deployed `Send Cast Contract` script. It has **not** been copied into this codebase (a repository scan for bearer, PAT and API-key patterns is clean). **Owner action required:** revoke or rotate that credential at its issuing provider. Replacements live only in deployment secrets (`SIGNING_API_KEY`).

## Ovation Automation Control Centre (22 specification rows)

These were **specifications, not live automations**. The record contents were not in the handoff pack and could not be fetched (no Airtable access from this environment), so none are fabricated here. The importer maps each row to a `workflow_definitions` record with `source = ovation_spec`, `status = draft` and `disposition = blocked`, and keeps its key (e.g. `AUTO-001`). The Automations screen refuses to activate a blocked or retired specification. Each must be implemented, tested, and re-dispositioned (`implemented` / `replaced` / `retired`) individually. The import path is verified on a synthetic row in `import.test.ts`.

| Item | Count | Status |
|---|---:|---|
| Ovation spec rows in audit | 22 | **Blocked: awaiting authorised export** |
| Imported in this environment | 0 | Live import not run |
| Activated | 0 | By design |

## Engine guarantees (verified)

| Guarantee | Test |
|---|---|
| Event written in the same transaction as the business change; duplicate keys ignored | journey.test (repeat edits), workflows.test |
| Replay of a processed event is a no-op (`workflow+event` run key) | workflows.test |
| Transient failure → retry with backoff | workflows.test (simulated network failure) |
| Persistent failure → dead-letter after `max_attempts`; operator retry recovers | workflows.test |
| Import-origin events are `suppressed` (no emails, signatures or shots) | import.test |
| Paused/unregistered workflow → run recorded as `skipped` | engine logic (`processOutbox`) |
| Run history, event queue and outbox review visible to admins/producers | Automations screen (E2E smoke) |
