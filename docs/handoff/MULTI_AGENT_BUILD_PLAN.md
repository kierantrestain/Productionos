# Claude Code multi-agent implementation plan

The target repository is empty (19-Nov check). Use a **lead/orchestrator** and up to six bounded subagents; adapt to available Claude execution/runtime. Do not merely write six plans and stop: the lead owns integration, working software, commits, QA and the release report. Assign nonoverlapping files to avoid merge clashes.

## Kickoff: discovery and foundation (lead, 1 day-equivalent stage not a promise of time)
- Clone `https://github.com/kierantrestain/Productionos`, check GitHub visibility and active branch/remote.
- Read handoff documents and inspect the 90-row mapping, 75-page map, data provenance/gaps.
- Confirm environment: Vercel target, authenticated staging database/storage secrets, Airtable source access if present. If inaccessible, implement via fixtures+import adapters but report migration as blocked. Do not hard-code a fake import.
- Decide on Next.js/React+TS, PostgreSQL, ORM/migrations, auth, storage, background queue, tests and deployment. Explicitly document choices, costs and any free-tier limitations.
- Set up routes, secure authentication and database migrations; create CI checks before UI scaling.
- Establish shared entity contracts (IDs, tenant, permissions, statuses, currency, timezone, source lineage), typed services and access checks.

## Subagents and file/code ownership

| Agent | Ownership | Deliverables | Depends on |
|---|---|---|---|
| A: Data/migration | `db/`, `prisma/` or `drizzle/`, `src/server/import/` | Schema, migrations, source mapping, importer, validation, link reconciliation, seed/test fixture separation, multi-tenant constraints | Lead contracts |
| B: Production operations | `src/features/production`, `src/features/scheduling`, `src/features/resources` | CRUD scenes/segments, shots, breakdown, schedule, dynamic shoot-day, call-sheet versions and conflict checker | A IDs/RBAC |
| C: Executive slate/finance/rights | `src/features/slate`, `src/features/finance`, `src/features/rights`, `src/features/commercial` | Greenlight gates, chain-of-title, spend/approvals, sponsor/distribution/contract essentials | A IDs/RBAC |
| D: UI design and accessibility | `src/components`, `src/styles`, `src/app` (shell/layout only) | Astryx-informed component library, app shell, dense grids, editing, tablet workflows, loading/error/empty states | Lead UI contracts |
| E: Automation/integrations | `src/server/workflows`, `src/features/automations`, `src/server/integrations` | Outbox/idempotency, safe email/contract state workflows, run logs, retries, secret handling | A + source register |
| F: Independent QA/Release | `tests/`, `e2e/`, `docs/release/` | Actual automated/browser test evidence, data reconciliation, role security, deployment smoke tests, bug triage | Every vertical slice |

These directories are suggestions; adapt to scaffolded structure. All agents should present tested commits or mergeable changes, not screenshots of unimplemented pages. Integrate after each slice, not after all agents finish.

## Feature and release sequence

### Slice 1 — genuinely usable core
Organisation auth + roles → show/IP + production + episode/segment CRUD → scene breakdown → cast/crew/location/props/equipment links → shot list → shoot day/schedule → conflict detection → versioned call-sheet PDF → simple post handover. Validate persistence across refresh and a second signed-in user, including least-privilege denied reads.

### Slice 2 — IP and budgeting
Slate stages, development materials, greenlight approvals, contract/rights status, budget lines, actual and forecast spend, purchase/expense approvals, executive rollups, risks and owner dashboard.

### Slice 3 — post, commercial, automation
Edit versions, deliverables, release calendar, sponsors/partnerships, sales/licensing, contract obligations, workflow definitions/run health. Port four S’appening automations safely and disposition each of 22 Ovation workflow specs.

### Slice 4 — secure migration and production readiness
Import source records and original attachments if authorised; run link reconciliation and snapshots; permissions for cast/crew/executive; exports and backup restore; mobile/tablet browser tests; deployment smoke tests; create live URL and release notes. No premature cutover.

## Explicit non-goals in this repo
Mimic OS, a full Celtx-like writing suite (SWDR), production video/tactics/game-show controller software, automatic legal e-signature without valid vendor setup, copyright-infringing replication of Airtable proprietary code.

## Agent coordination and budget discipline
- Lead creates a small shared source contract with types/DB migrations/API response shapes before parallel feature code.
- Investigate each source once; store findings in `/docs/source/` to avoid repeated browsing/API calls.
- Use automated checks on every merge: typecheck, lint, unit, API integration, E2E, accessibility and production build.
- Prioritise completed vertical flows; a polished placeholder page fails acceptance.
- Do not silently extend scope if source data conflicts: log a traceable issue and use clearly tagged temporary behaviour.
