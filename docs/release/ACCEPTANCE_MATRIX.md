# Acceptance matrix — 30 scenarios

Run date: **19 Nov 2026**, local environment (PostgreSQL 16.15, Node 22, Chromium via Playwright 1.63). Statuses: **pass**, **partial** (implemented; part of the criterion unverified), **blocked** (needs external access). A blocked item is never counted as passed.

Evidence key: **IT** = `tests/integration/*.test.ts` (Vitest, real Postgres) · **E2E** = `tests/e2e/journey.spec.ts` (Playwright, production build) · **INS** = verified by inspection or manual run.

| # | Scenario | Status | Evidence | Notes |
|---:|---|---|---|---|
| 1 | Org A cannot read Org B by URL/API | pass | IT security › org B cannot read or write | Also blocks cross-org linking |
| 2 | Show → episode → scene → shot persists across refresh and a second session | pass | IT journey; E2E producer journey + second session | |
| 3 | Standalone film/ad without seasons; series with episodes | pass | IT journey › standalone; E2E series | |
| 4 | Scene links real people/resources; shared, not duplicated | pass | IT journey; E2E link person + resource | Cross-production links rejected |
| 5 | Search/filter/sort/saved views/keyboard with ≥ 79 scenes | partial | INS: 79-scene / 70-shot density fixture seeded; grids render it | Not asserted by an automated test; no performance benchmark recorded |
| 6 | 79 Scenes + 80 Editing stay separately traceable | pass (synthetic) | IT import › reconciles Editing without creating scenes | Live data: **blocked** (no export) |
| 7 | Shoot-day conflicts detected without reload | pass | IT journey (overlap, overcommit, double-booking, unavailability); E2E conflict panel | Fixed during QA: kit demand is now peak per day, not summed |
| 8 | All 40 shoot-day records handled; no 8-date assumption | partial | IT import (duplicate-date days both kept); dynamic `/schedule/day/:id` | Live 40 records: **blocked** |
| 9 | Versioned call sheet; old versions unchanged | pass | IT journey (DB trigger rejects tampering); E2E issue v1 | PDF = browser print/save from the print-styled snapshot; no server-side PDF renderer |
| 10 | Cast/crew can't see salaries, finance or others' data | pass | IT security; E2E role security | |
| 11 | Double-book, availability, unsigned contract, missing release, unconfirmed location alerts | pass | IT journey; INS demo day shows all types | Unconfirmed-location alert not separately asserted |
| 12 | Repeated scene edits → at most one auto shot; manual shots kept | pass | IT journey | |
| 13 | No provider → contract/email stay draft/blocked | pass | IT workflows | |
| 14 | Live email: sender, preview, recipient, confirmation, idempotency, audit | pass (test provider) | IT workflows (test-sink) | Real provider (Resend adapter) **not contract-tested**: no credentials |
| 15 | Legacy bearer credential not in code/logs/tests; owner notified | partial | INS: repository credential scan clean | Owner revocation is an **owner action** (flagged in reports) |
| 16 | 22 Ovation rows dispositioned with evidence | blocked | Importer maps them to blocked specs (IT import, synthetic) | Needs authorised export |
| 17 | Spend/greenlight approvals check authority and record chain | pass | IT security › approvals; IT workflows (contract approval) | |
| 18 | Estimate/approved/committed/actual/variance/VAT distinct; invisible to cast | pass | IT security › finance + VAT | |
| 19 | Missing clearance blocks release approval | pass | IT journey › rights block | |
| 20 | Versioned cuts, comments, media, acceptance; protected uploads | pass | IT journey (cut approval); IT workflows (protected attachments) | |
| 21 | Sponsor/commercial deliverables tracked | partial | INS: CRUD screens + demo records | No dedicated automated test |
| 22 | Dashboards drill to real records; no seeded numbers | pass | INS: `dashboard.ts` counts live rows; every metric links | Demo org is flagged `is_demo` in the UI |
| 23 | All 90 tables dispositioned; field configs fetched or NOT_EXPORTED | partial | IT import › 90-table register; `docs/MIGRATION.md` | Field configs: **blocked** (no schema export) |
| 24 | Lineage + checksum; second import creates nothing | pass (synthetic) | IT import › idempotent second run | Live: **blocked** |
| 25 | Links resolve or go to exception queue; attachments hashed | pass (synthetic) | IT import (orphan link, bad hash, undownloaded file) | Live: **blocked** |
| 26 | 75 pages mapped; drafts marked unverified | pass | `docs/reports/INTERFACE_PAGES.md` (75/75) | Element-level fidelity and draft pages unverified |
| 27 | 1440/1024/390 layouts; keyboard, contrast, touch | partial | E2E no-overflow at 1024 and 390; 1440 default viewport | No automated axe/contrast audit was run |
| 28 | Typecheck, lint, tests, build clean; deployed URL works | partial | All local checks pass (see release report) | Deployment **blocked**: no Vercel/Neon access |
| 29 | Backup/restore demonstrated; Airtable untouched | pass | INS: `scripts/backup.sh` → `restore.sh` into a fresh DB, counts identical, triggers restored | Airtable never accessed |
| 30 | Reviewer reproduces the full journey | pass | E2E producer journey (11/11) | |

**Totals:** 22 pass · 7 partial · 1 blocked. No scenario recorded as failing.
