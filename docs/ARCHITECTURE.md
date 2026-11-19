# Architecture

## 1. Shape of the system

```
Browser ──► Next.js App Router (server components + server actions) ──► service layer ──► PostgreSQL
                    │                                                     │                 ▲
                    └─ route handlers: /api/attachments, /api/export,     │                 │ outbox (same txn)
                       /api/search, /api/v1/*, /api/jobs/run, /api/health  └─► storage (S3)  │
                                                                                  workflow engine ─┘
```

* **One write path.** All UI mutations go through `src/app/actions.ts`. Each action resolves the session on the server and calls a permission-checked service in `src/server/**`. Services take an explicit `Ctx` and never read cookies, so they are tested directly against Postgres.
* **Entity registry** (`src/lib/entities.ts`). This is one declarative definition per entity: fields, types, select options, sensitivity class, read-only workflow fields, scope, children. It drives zod validation, production scoping, field redaction, the editable grids, the generated forms, CSV export and search. 52 registered entities, 77 tables in total.
* **Specialised services** cover what a generic grid shouldn't do: scheduling and conflicts, call sheets, approvals, finance roll-ups, delivery gating, contracts, messages, imports.

## 2. Domain model

`organisation → business_unit → ip_project (show/IP) → production → season → episode/unit → scene/segment → shot → take`, with `shoot_day → schedule_block → day_call` and `call_sheet` (immutable snapshot) alongside it. Post is `media_asset → post_task → edit_version → review_comment → deliverable → release`.

* Productions may have **no episodes** (`uses_episodes=false`): scenes and segments then attach directly to the production. This covers films, commercials, standalone documentaries and studio specials.
* **Scenes and segments share one table** with `kind`: scene, segment, round, interview, performance, link, VT, ad break, titles. Studio formats get camera-plan, graphics/question-cue and audio fields. Running order is `sort_order`.
* **Shared entities are never duplicated per production**: `people` (one per human, many `engagements` across productions as cast and/or crew), `companies`, `locations`, `resources` (props, wardrobe, equipment, sets, vehicles, graphics), `contracts`, `rights_entries`.
* **Money** is stored as bigint minor units plus ISO currency, with VAT in basis points. Estimate, approved, committed, actual and forecast are distinct (see §5).
* **Lineage**: `source_records` holds a unique key `(org, base, table, record)`, the source hash, the import batch, the target entity and id, the migration status, and raw cells (admin-only).

## 3. Security model

| Concern | Implementation |
|---|---|
| Tenancy | Every row has `org_id`; every query is scoped with `scopeWhere`; referenced ids are verified to exist in the same org (and the same production for production-scoped targets). |
| Roles | `src/lib/permissions.ts`: 11 roles × 16 domains read/write grants. Least privilege, deny by default. |
| Production scoping | `org_admin`, `executive`, `finance_legal` and `commercial` see all productions. Every other role sees only productions it is a member of. Creators are added as members automatically. |
| Field redaction | `pii` (email, phone, address, emergency contact, dietary): admin, producer, PM, finance/legal only. `rate` (rates, fees, contract values): admin, exec, producer, finance/legal. Redaction applies in API responses, grids, exports and audit history views. |
| Cast & crew | No finance or people directories. Cast can only read *issued* call sheets for days they are called on. Call-sheet snapshots never contain personal contact details. |
| Sessions | 32-byte random token; only its SHA-256 is stored. httpOnly, SameSite=Lax, Secure in production. Role changes and disabling a user revoke sessions. |
| Audit | `audit_events` is append-only, enforced by a DB trigger. Approval decisions are append-only. Issued call sheets are immutable (trigger), apart from the `issued → superseded` transition. |
| Files | Per-file authorisation on every download, SHA-256 verified on read, blocked executable types, 25 MB cap, `restricted` sensitivity for contracts/people. |
| Integrations | `/api/v1` bearer tokens (hash stored, scoped, revocable). External systems never get database credentials. |
| Secrets | Only in environment variables. The hard-coded bearer token in the legacy S’appening contract automation was **not** copied; it is flagged for revocation. |

## 4. Workflow engine

* Business writes and their events commit in **one transaction** (`outbox_events`, unique idempotency key).
* The worker claims due events with `FOR UPDATE SKIP LOCKED` and a 2-minute lease. Each handler records a `workflow_run` keyed by `workflow+event`, so replays are no-ops.
* Transient failures retry with exponential backoff (30 s → 1 h) and dead-letter after `max_attempts`. Operators retry from **Automations → Event queue**.
* `origin = import` events are stored `suppressed`: importing data never sends email, creates signature requests or triggers shot generation.
* Inline "kick" after user actions makes results visible immediately; cron/`pnpm jobs:run` guarantees durability.

## 5. Business rules (server-enforced)

| Rule | Where |
|---|---|
| Initial shot auto-created once per scene when it has a title and director; never duplicated, and manual shots are never touched | `hooks.ts` + `generateInitialShot` (unique `generation_key`) |
| Spend authority by gross amount: < £1,000 PM · < £10,000 producer · otherwise executive. Budgets and greenlight gates: executive. Contracts: finance/legal | `approvals.ts` |
| Requesters cannot approve their own requests; rejections need a reason; decisions are immutable | `approvals.ts` + trigger |
| Imported historical approvals are read-only and never appear as decidable | `approvals.ts` |
| Committed = approved open POs minus actuals already booked against them. Actual = approved/paid expenses. Forecast = explicit EFC, else max(approved, committed + actual). Variance = approved − forecast | `finance.ts` (unit-tested) |
| VAT rounded half-up per line; zero-rated lines supported | `finance.ts` |
| Kit demand = per-day **peak** across a unit's scenes, summed across units on the same date, compared with quantity owned | `conflicts.ts` |
| Conflicts: time overlap, person double-booked (any production), unavailability, kit overcommitted/unavailable, location clash (non-shared), unconfirmed location, unsigned contract, missing release, scheduled-but-not-called | `conflicts.ts` |
| Call sheets: issuing with blocking conflicts needs explicit acknowledgement; each issue is a new immutable version | `callsheets.ts` + trigger |
| Wrap → post: day wrapped, scenes marked shot, one ingest task per day and one edit task per episode (idempotent) | `production-ops.ts` |
| Deliverable approval: producer/exec only, blocked by uncleared or expired rights on the production or its IP. Delivery requires prior approval | `post-legal.ts` |
| Contract **signed** requires an attached signature document. Sending without a configured provider marks the contract **blocked**, never sent | `post-legal.ts` |
| Outbound email: draft → preview → explicit confirmation → outbox dispatch. Without a provider it is marked `blocked_no_provider` | `post-legal.ts`, `engine.ts` |

## 6. Integration boundaries

* **SWDR** (screenwriting): `POST /api/v1/integrations/swdr/script-revisions` (scope `scripts:write`) accepts only `approved: true` revisions. It pins `script_revision_ref` on matching scenes and creates missing scenes as drafts. It **never overwrites** existing breakdown content and is idempotent per revision.
* **Mimic OS**: `GET /api/v1/productions`, `/:id/status`, `/:id/schedule` (versioned JSON, no personal data).
* **Providers**: mail (Resend adapter) and e-signature adapters are disabled unless configured *and* explicitly enabled. A `test-sink` provider exists only under `NODE_ENV=test`.

## 7. Design system

This is an original Bang On identity, informed by the Astryx architecture (MIT, React 19, still beta): CSS custom-property tokens with light/dark themes, dense accessible data display, composable primitives. Astryx is **not** a runtime dependency, because adopting a beta package was judged riskier than a small owned token set. The accent is the studio "tally light" red-orange, reserved for live and actionable states. All styles are in `src/app/globals.css`, with print styles for call sheets, touch-target enlargement for coarse pointers, and reduced-motion support.
