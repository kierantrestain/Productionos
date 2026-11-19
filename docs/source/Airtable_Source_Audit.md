# Bang On Production OS — Airtable source audit and implementation blueprint

**Audit date:** 19 November 2026  
**Status:** Read-only inspection of two connected Airtable bases. No Airtable data was modified.  
**Intended output:** One independently hosted Production OS, built in Codex with separate authorised inspection/research, not an Airtable clone or two independent apps. Build Production OS first; Mimic OS is deferred.

## 1. Confirmed source bases

| Source | Airtable base | Tables | Fields | Records | Retrieved interface pages | Native automations |
|---|---|---:|---:|---:|---:|---:|
| Ovation OS | https://airtable.com/appGbXugVx1UAfw6B | 68 | 1,449 | 232 | 10 | 0 found |
| S’appening Production | https://airtable.com/appkx0tyAT1SDGSz5 | 22 | 386 | 564 | 65 | 4 (3 deployed, 1 undeployed) |
| **Total** | | **90** | **1,835** | **796** | **75** | **4** |

The **record counts include sparse/placeholder records**, not necessarily 796 fully populated operational objects. The count was established via Airtable metadata across all 90 tables. The connector exposed the schemas/field names for all tables and the interface page structure, plus sample rows and automation configurations. This is **not a byte-for-byte export** of all cell values or files; a separate exhaustive export and verification pass is required before migration.

Ovation has extensive schema and governance/IP logic, but many downstream tables are entirely empty. Its 22 Automation Control Centre rows are workflow specifications, **not 22 live native Airtable automations**. S’appening has genuine scene/shot/day/cast/asset data from a four-episode Liverpool production.

## 2. Recovered interface structure

### Ovation executive interface — 10 retrieved pages

The source contains one interface, **OVATION OS | Executive Command**, with the following observed pages:

1. 01 Executive Command — executive dashboard, KPIs, task lists, calendar and charts
2. 02 Slate Pipeline — IP development records
3. 03 Decision Calendar — IP decision dates
4. 04 Rights Command — chain-of-title/rights register
5. 05 Packaging Studio — packaging overview
6. 06 Work Command — tasks
7. 07 Gate Room — development/greenlight approvals
8. 08 Materials Library — development materials
9. 09 Approvals — governance and approvals
10. 10 Automation Health — workflow/automation dashboard

Previously discussed draft interface pages beyond these ten were **not returned in this connector result**. Do not assert that every unpublished draft has been captured. Verify separately with authorised UI inspection.

### S’appening — 9 interfaces / 65 retrieved pages

- Main interface **Interface**: 17 pages — Transport, Contracts, Shotlist, Episodes, Partnerships, Post Production, Expenses, Locations, Props, Equipment, Cast, Distribution, Scenes, Sponsors, Crew, Scenes Calendar, Shoot Days.
- Eight shoot-day interfaces (Wednesday 18th; Sunday 22nd; Monday 23rd; Tuesday 24th; Wednesday 25th; Thursday 26th; Friday 27th; Saturday 28th). Each contains six pages: **Dashboard, Cast, Crew, Props, Locations, Equipment**. The eight day-specific interfaces account for 48 pages.
- The shoot-day dashboards contain headcount/asset count tiles and lists cross-referenced from scene data.

**Replacement decision:** Do not hard-code one interface per shoot date. Build a reusable Shoot Day Command screen selected by production and date, with tabs/cards for schedule, cast, crew, locations, props, wardrobe, equipment, transport, catering, call sheets, status, conflicts, and documents. Save filtering and access as real persisted views.

## 3. Current Airtable table inventory

The following is the complete observed **90-table inventory**. Counts are records returned as total count by the connected Airtable service. Zero means no current records, not no product value.

### Ovation OS: 68 tables

| Table | Fields | Records |
|---|---:|---:|
| Business Units & P&L | 20 | 8 |
| Legal Entities & SPVs | 23 | 1 |
| Strategic Initiatives & Milestones | 17 | 10 |
| Governance & Approvals | 22 | 6 |
| Slate & IP | 65 | 6 |
| Development Materials | 15 | 36 |
| Development & Greenlight Reviews | 31 | 6 |
| Packaging & Attachments | 15 | 0 |
| Rights & Chain of Title | 14 | 24 |
| Capital Pools & Raises | 18 | 6 |
| Investors & Capital Relationships | 16 | 0 |
| Funding Commitments & Finance Stack | 23 | 0 |
| Incentives & Rebates | 22 | 0 |
| Productions | 65 | 0 |
| Production Schedule | 16 | 0 |
| Budget Lines | 21 | 0 |
| Purchase Orders & Commitments | 24 | 0 |
| Suppliers & Vendors | 16 | 0 |
| Team & Crew | 33 | 2 |
| Crew Assignments & Availability | 20 | 0 |
| Cast & Contributors | 15 | 0 |
| Locations & Facilities | 23 | 0 |
| Equipment & Assets | 20 | 0 |
| Asset Bookings & Hires | 19 | 0 |
| Post & Delivery Workflow | 23 | 0 |
| Delivery Requirements | 18 | 0 |
| Companies & Partners | 29 | 0 |
| Contacts | 16 | 0 |
| Buyer & Market Intelligence | 21 | 0 |
| Sales & Licensing Pipeline | 20 | 0 |
| Rights Deals & Licence Windows | 34 | 0 |
| Catalogue & Exploitation | 28 | 0 |
| Franchise & Derivative Rights | 14 | 0 |
| Contracts & Agreements | 26 | 0 |
| Contract Obligations | 12 | 0 |
| Bank Accounts | 15 | 0 |
| Finance Transactions | 22 | 0 |
| Cash Forecast & Runway | 21 | 0 |
| Risk Register | 19 | 8 |
| KPIs & Targets | 18 | 14 |
| Board Meetings | 12 | 0 |
| Management Packs | 20 | 0 |
| Strategic Partnerships | 17 | 0 |
| Build Partner Buy Decisions | 20 | 0 |
| Acquisition Targets | 18 | 0 |
| Brand & Commercial Integrations | 16 | 0 |
| Release & Distribution | 16 | 0 |
| Incidents & Issues | 20 | 0 |
| Tasks | 17 | 30 |
| SOP Library | 19 | 13 |
| Automation Control Centre | 33 | 22 |
| IP Sourcing & Acquisitions | 22 | 0 |
| Packaging Overview | 19 | 6 |
| Script Coverage & Creative Reviews | 22 | 2 |
| Episodes & Production Units | 18 | 0 |
| Production Cost Reports | 19 | 0 |
| Meetings & Actions | 21 | 0 |
| Corporate Finance Monthly | 21 | 0 |
| Territories & Markets | 21 | 20 |
| Rights Inventory | 27 | 0 |
| Decision Log | 19 | 0 |
| Exploitation Opportunities | 19 | 0 |
| Rights Revenue | 19 | 0 |
| Workflow Queue | 19 | 6 |
| Post Service Projects | 19 | 0 |
| Production Services Jobs | 17 | 0 |
| Studio & Stage Bookings | 16 | 0 |
| Automation Run Log | 14 | 6 |

### S’appening Production: 22 tables

| Table | Fields | Records |
|---|---:|---:|
| Episodes | 29 | 4 |
| Cast | 40 | 48 |
| Crew | 22 | 7 |
| Scenes | 34 | 79 |
| Locations | 28 | 54 |
| Props | 15 | 89 |
| Wardrobe | 12 | 44 |
| Equipment | 16 | 20 |
| Shot List | 14 | 70 |
| Shoot Days | 20 | 40 |
| Marketing | 11 | 1 |
| Release Forms | 10 | 19 |
| Expenses | 13 | 1 |
| Sponsors | 11 | 1 |
| Partnerships | 8 | 1 |
| Contracts | 13 | 1 |
| Tasks | 13 | 1 |
| Catering | 10 | 1 |
| Transport | 12 | 1 |
| Post Production | 11 | 1 |
| Distribution | 10 | 1 |
| Editing | 34 | 80 |

Machine-readable listings, including **Airtable source table IDs**, are in `airtable_table_inventory.csv` and `.json`.

## 4. Native automations and exact relevant logic

| Automation | Deployment | Observed mechanism | New-system treatment |
|---|---|---|---|
| Update Shot List when Scene Name and Director are not empty | Deployed | Trigger when two Scene fields become non-empty; searches Shot List for scene link; next step creates Shot List record | Ensure one-to-many shot creation is controlled, idempotent, and never creates duplicate rows on repeated edits. Auto-create only with explicit rule for uncreated scene. |
| Send Cast Contract | Deployed | Cast Contract Status = Create Contract triggers custom script to an external document service and later conditionally updates cast | **Security priority:** script contains a hard-coded bearer credential. Revoke/rotate it, keep secrets server-side, avoid transferring it. Build documented generation, approval, delivery, signed status, and retry audit. |
| Automation 2 | Undeployed | Cast checkbox condition sets cast contract status to Signed | Do not silently enable; confirm authoritative signed document/signature evidence first. |
| Send Cast Details | Deployed | Explicit interface action triggers Gmail delivery of role details/attachments, then updates an email-sent flag | Create a verified outbound message workflow with preview, recipient confirmation, immutable send logs, duplicate protection, and tenant permissions. |

Ovation: 22 Automation Control Centre records specify workflow events and target tables, with keys like `AUTO-001`, retry/idempotency/test guidance and run logs. No native Airtable automation was returned for Ovation, so **do not claim these 22 are deployed**. Migrate specifications into a proper workflow engine with run history and approval gates, then activate only after automated tests.

## 5. Consolidated app structure — one database, modular workspaces

Use this **canonical hierarchy**:

`Organisation / Business Unit → IP / Show → Production / Season → Episode / Production Unit → Scene / Segment → Shot / Take → Shoot Day / Call Sheet → Media Asset → Post Version → Release / Distribution`.

People, companies, contracts, rights, tasks, budgets, locations, physical assets, services and approvals should be cross-cutting entities. Preserve source IDs in immutable `source_system/source_base/source_table/source_record_id` mapping, not as primary app identifiers.

| Module / navigation | Replaces or consolidates |
|---|---|
| Home / Executive Command | Ovation Executive dashboard, KPI & Targets, workflow health, decision calendar, tasks |
| Slate & Development | Ovation Slate & IP, sourcing, materials, coverage, packaging, gate reviews, decision log |
| Productions | Ovation Productions, Episodes & Production Units + S’appening Episodes; one show/production/season/episode hierarchy |
| Script & Breakdown | S’appening Scenes, scene links, documents, AI-assisted breakdown; SWDR integration by approved document/version ID rather than duplicating its full writing interface |
| Shot Lists & Boards | S’appening Shot List, scenes, director/camera instructions and versioned shot breakdowns |
| Schedule & Shoot Day Command | S’appening Shoot Days/date interfaces + Ovation Production Schedule; dynamic date, call sheet, cast/crew/locations/assets/props, conflicts, route/order and printable dispatch |
| People & Talent | Ovation Team & Crew, Crew Assignments, Cast & Contributors + S’appening Cast/Crew; unique people with multiple roles, engagement records, permissions and signed paperwork |
| Locations, Studio & Equipment | Both bases' locations/equipment, plus Ovation stage/bookings and S’appening props/wardrobe/transport/catering |
| Budgets & Procurement | Ovation Budget Lines, commitments, purchase orders, suppliers, finance/cost reports + S’appening Expenses; budget-to-actual, receipts and approvals |
| Documents, Contracts & Rights | Both bases' contracts/releases; Ovation chain of title, rights inventory/deals/licence windows, contract obligations, expiring usage permissions |
| Post Production & Delivery | Ovation Post & Delivery, service projects/jobs, delivery requirements + S’appening Editing/Post Production; stages, assignments, proofs, sign-offs and media outputs |
| Sales, Sponsors & Distribution | Both bases' sponsors, partnerships, commercial opportunities, company/contact records, Ovation buyer intelligence, licensing, exploitation and release/distribution |
| Governance & Finance | Ovation legal entities/SPVs, investment/funding, incentives, recoupment, board approvals, risks, cash forecasts; role-protected access |
| Operations & Automations | Tasks, SOP library, workflows, run logs, event triggers, approvals, notifications and audit trails |

The app should include permissions appropriate to production crews: the cast should not see private company finance, and a visiting camera operator should only see assigned call times, shot lists and relevant assets.

## 6. Data migration: must-fix mappings and exceptions

1. **Identity:** Deduplicate people/contacts across Cast, Crew, Team & Crew, contributors and companies. One person can be a collaborator in multiple productions, with role-specific assignments.
2. **Production ownership:** Ovation Productions currently has zero rows; S’appening has four populated episodes. Create one parent production for the legacy Liverpool series and link its four imported episodes, keeping it distinct from the new Bang On slate.
3. **Scenes/Editing:** S’appening's `Editing` table has 80 scene-like records and repeats many of the same 34 fields as `Scenes` (79 rows), including copied scene/shot/cast/crew links. **Do not blindly import as 80 unrelated scenes.** Reconcile by source record, episode and scene number; model post tasks independently.
4. **Shoot Days:** S’appening has 40 shoot-day records while the user-facing dated interfaces only cover eight selected dates. Preserve every record, verify any date duplicates and regenerate interfaces dynamically.
5. **Shot List:** Preserve 70 shot records and source scene/shot links; avoid duplicate creation from existing automation.
6. **Physical assets:** Existing locations (54), props (89), wardrobe (44), equipment (20), and cast (48) need proper cross-reference and booking availability rules.
7. **Selects/formulas/AI fields:** Preserve option lists, link semantics, derived values, and user-supplied notes. Replace Airtable lookups/rollups/formulas with documented computed data and tested server logic. Label generated suggestions distinctly from approved facts; no unreviewed AI into call sheets or contracts.
8. **Material quality:** At least one Episode 1 synopsis excerpt showed duplication/garbled text; add import validation and retain original side-by-side rather than silently rewriting creative material.
9. **Rights/governance:** Ovation's existing approval records name historical approvers and brands. Keep their history, but **do not automatically translate old Ovation voting/approval rules into Bang On Holdings**. Use the current founder/legal approvals when configured for the new company.
10. **Currency and finance:** Amounts in £, proper net/VAT/gross categories, role-locked financial data, explicit treatment of founder advances/IP costs and contractual recoupment waterfalls when approved.
11. **Attachment migration:** Export original files from Airtable attachments and verify hashes, names, permissions, and permanent storage; never depend on time-limited Airtable attachment URLs.
12. **Lineage:** Every imported record gets mapping ID, import batch, source modification time (if accessible), validation status and any manual conflict resolution.

## 7. UX and technical architecture agreed previously

- **Design reference:** `https://github.com/meta/astryx` for visual interaction ideas and a modern, clean, high-density production-command style, **subject to licence and suitability review**. Distinct original branding and interface, not a wholesale source clone.
- **Workflow inspection:** `https://github.com/morluto/rea` may inspect the two authorised Airtable bases, their accessible interfaces, filtering, detail panels, views, dashboards and interaction patterns. It is an inspection aid, **not** the database engine or permission to copy proprietary Airtable code/private APIs.
- **Application:** TypeScript + React/Next.js, responsive desktop/tablet, fast keyboard-centric lists, rich detail panels, calendars, kanban and timeline/scheduling views.
- **Persistence:** Neon PostgreSQL, explicit migrations, transactional multi-user writes, background job/outbox service, authenticated API, managed object storage and recoverable backup/snapshot policies.
- **Hosting:** Vercel with separate production/staging configuration; no Airtable dependency at runtime after complete verified migration.
- **Access:** organisations/teams, roles/permission rules, record-level restrictions when needed, invite/remove users, audit log, data export and incident recovery.
- **Workflows:** server-side jobs and reminders, event-based triggers, idempotency keys, approvals, retry policy, dead-letter queue and run-history dashboards.
- **Interoperability:** import/export CSV, JSON, PDF/call sheets, file attachments, approved SWDR story/script revisions, relevant calendars and notifications.
- **Automation/AI:** opt-in, review-first breakdowns and summaries; all consequential sends, contract state changes, legal approvals or expenses require attributable user action/appropriate approval.

## 8. Recommended Codex multi-agent ownership

1. **Orchestrator / integrator:** own domain map, contracts between agents, PR integration and release gates.
2. **Data + migration agent:** schema, source mappings, import validator, ETL, ACL and data-quality checks.
3. **Production workflow agent:** series/episode/scene/shot/schedule/call sheet/crew/asset operations.
4. **IP + legal/finance agent:** development/slate, rights, greenlights, expenses, purchase approvals and recoupment scaffolding.
5. **UI + design agent:** Astryx-inspired original design system, interactive views and responsive shell.
6. **Automation + integrations agent:** workflow rules, mail/contract generation, event scheduler, logs, retries, secure secrets.
7. **Independent QA agent:** real browser flows, persistence, role security, data migration reconciliations, accessibility and build/deploy verification.

**Implementation order:** foundation/auth/schema → populated Liverpool production migration → working scenes/shot lists/shoot-day command → production budgets/people/assets → Ovation IP/rights/greenlight → commercial/post/distribution → workflow engine and production hardening. Parallel agents should integrate early instead of producing disconnected screens. The current app must be useful and persistent from the first slice.

## 9. Acceptance gates before declaring migration complete

- All 90 source table schemas mapped, with disposition: canonical entity / related child / computed view / archive.
- Every source record and attachment exported, matched, assigned to a target, or explicitly archived. Reconcile **232 + 564 = 796** source record counts, including placeholders, and publish any excluded rows.
- Source links and target linked entities reconcile; no orphaned scene, cast, shoot-day or shot references.
- All 75 retrieved interface pages mapped to an accessible screen or a deliberate consolidated alternative; separately verify unpublished/draft pages not exposed by connector.
- Four native S’appening automations either reproduced safely, retired with justification, or left off as appropriate. Twenty-two Ovation workflow specs dispositioned, not silently considered working.
- Representative user journey: open an episode → choose scene → view script excerpt → attach cast/crew/props → generate shot list → allocate shoot day → verify calendar/conflicts → issue call sheet → upload footage → post handover → approve deliverable.
- Real persistent CRUD, search/filter/sort, permissions, attachment storage, import/export, revision history, audit and error-state tests. No fake dashboard counts or dead UI actions.
- Run migration twice in staging (idempotent), compare counts/links/attachments, verify deletion/restore, then approve a cutover window. Leave original Airtable sources untouched until user explicitly authorises a migration/cutover.
- Revoke the exposed legacy credential and store replacements in managed environment secrets; do not copy embedded credentials, unauthorised endpoints or old email defaults.

## 10. Evidence scope and unresolved verification

**Verified directly:** 90 table names and field types, record-count metadata for each table, 10 Ovation pages, 65 S’appening pages, 4 native automation definitions and deployment statuses, sample source records, and 22 Ovation automation specification rows.

**Not yet verified completely:** exact full record contents of every row, original attachment bytes, field config/options/formulas across every field, every table's custom view settings (Airtable returned rate limiting on some view queries), any unpublished/draft Ovation pages beyond the ten exposed, production-level visual fidelity using REA, and full runtime success/failure history of each native automation. These require a separate authorised exhaustive export/inspection step before claiming 100% migration fidelity.

This blueprint is a design and migration specification, **not a claim that the standalone app has been built or the Airtable data has been transferred**.
