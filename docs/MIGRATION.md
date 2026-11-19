# Airtable → Production OS migration

## Status: LIVE MIGRATION BLOCKED

No live Airtable data has been imported. The build environment has no `AIRTABLE_PAT`, and `api.airtable.com`
is unreachable from it (network policy). The importer is implemented and tested end-to-end against a
**synthetic** export (`tests/fixtures/airtable-synthetic`, clearly labelled, no source data). The two
Airtable bases have not been read, modified or deleted by this build, and must stay live until the owner
approves a cutover.

## Pipeline

1. **Export (read-only, owner-run).** Create a personal access token scoped to `schema.bases:read` and
   `data.records:read` on only `appGbXugVx1UAfw6B` (Ovation OS) and `appkx0tyAT1SDGSz5` (S’appening).
   Supply it as an environment variable, never in code or chat:
   ```bash
   cd tools/airtable
   AIRTABLE_PAT=… python3 export_airtable_readonly.py --with-records --download-attachments --out ../../private_exports
   python3 reconcile_export.py --manifest ../../private_exports/export_manifest.json --inventory ../../docs/source/airtable_table_inventory.csv
   ```
   `private_exports/` is gitignored and holds PII. Keep it on restricted storage.
2. **Dry run against staging.** This computes everything inside a transaction, then rolls it back:
   ```bash
   pnpm import:airtable --dir private_exports --org <staging-org-slug>
   ```
3. **Apply in staging.** Run `pnpm import:airtable --dir private_exports --org <staging-org-slug> --apply`
4. **Second run (idempotency proof).** Run the same `--apply` command again. The report must show
   `imported: 0, updated: 0` and every record `unchanged`, with no new operational rows.
5. **Reconcile.** Review the JSON report in `private_exports/import-report-<batch>.json`:
   per-table counts, record and field drift against the dated 19-Nov-2026 inventory (drift is listed, never
   "fixed"), Editing↔Scenes reconciliation, attachment results, unmapped fields and orphan links
   (`import_exceptions`). Resolve the exceptions, then repeat steps 2–4 if needed.
6. **Cutover**, only on explicit owner approval. Production uses a fresh export and the same steps.

## Guarantees (enforced by `tests/integration/import.test.ts`)

- **Lineage.** Every source record gets one `source_records` row, unique on (org, base, table, record), carrying
  a SHA-256 of its stable-JSON cells, the batch, the target entity and id, a status
  (`imported | updated | unchanged | archived | exception`) and the raw cells. Raw cells are visible to admins
  only, and temporary signed attachment URLs are scrubbed from them.
- **Idempotency.** The target is found through lineage, never by name. Unchanged hash means no write;
  a changed hash updates the existing row in place.
- **No side effects.** Rows are written directly, not through user mutations. Audit actions are `import`, and the
  only outbox event is a `suppressed` `import.completed`. No shot automation, emails, contracts or approvals fire.
- **Editing ≠ Scenes.** The 80 Editing records become `post_tasks` (kind `edit`). Each is matched to a scene by
  linked record, or else by (episode, scene number). Unmatched records become `reconciliation` exceptions
  and stay as unlinked post tasks. Editing never creates scenes.
- **All shoot days.** Every Shoot Days record is kept, including records that share a date. Linked scenes become
  `schedule_blocks`.
- **Shots.** Imported shots are never flagged auto-generated and never get a generation key.
- **Attachments.** Files are taken from the export manifest, their SHA-256 is re-verified, and they are stored in object
  storage with the original filename and `source_attachment_id`. A failed download, a hash mismatch or a file
  that was never downloaded (an expired URL) is recorded as an exception and never counted as stored.
- **Historical governance.** Ovation approvals are imported as `historical`, with no approver mapped to a current
  user. Ovation's 22 Automation Control Centre rows become `draft` / `blocked` workflow specifications.
- **Contracts.** An imported "Signed" status raises a `validation` exception, because no signature evidence has
  been verified. "Create Contract" is imported as a draft and triggers nothing.
- **Legacy production.** S’appening records hang off a single production, `S'appening (legacy import)`
  (`is_legacy_import = true`), which is kept apart from the new Bang On slate.
- **Creative text.** Episode synopses are copied verbatim into `synopsis_original` and are never rewritten.
- **Link removals.** A link removed in Airtable after an earlier import is not deleted from Production OS, because
  join rows carry no lineage and may have been added by users. The importer reports this; it does not apply it.

## Field mapping

Field names are matched to candidate lists, ignoring case and punctuation (`src/server/import/specs.ts`).
The pack did not include full per-field metadata, so the candidate lists are informed guesses that the
first real dry run will validate. Each unmatched, non-computed field appears once as an `unmapped_field`
exception, and its values stay in `source_records.raw`. Computed fields (formula, rollup, lookup, count,
autonumber, created/modified) are not imported. Their logic is re-implemented as server-side computation
where it matters.

## 90-table disposition

Generated from `src/server/import/disposition.ts`.

Canonical: 41 · Archived (records kept in lineage): 2 · Schema-only (0 records at audit): 47

| # | Base | Source table | Table ID | Audit records | Disposition | Notes |
|---:|---|---|---|---:|---|---|
| 1 | Ovation | Business Units & P&L | `tblys7iJlH3sMJJEN` | 8 | `business_units` | P&L figures stay in raw lineage; revenue target mapped when present |
| 2 | Ovation | Legal Entities & SPVs | `tblk1UW2hlhOTr9I5` | 1 | `legal_entities` | Historical Ovation entity; not auto-bound to Bang On |
| 3 | Ovation | Strategic Initiatives & Milestones | `tblswQ2lpq4DtJuUo` | 10 | `strategic_initiatives` |  |
| 4 | Ovation | Governance & Approvals | `tblMYEFhQ3PT99zMI` | 6 | `approval_requests` | historical=true; approvers never auto-assigned to current company |
| 5 | Ovation | Slate & IP | `tblkjPy09A3Y5yjqG` | 6 | `ip_projects` |  |
| 6 | Ovation | Development Materials | `tblNu192tq8gYMElw` | 36 | `development_materials` | Requires linked Slate & IP record |
| 7 | Ovation | Development & Greenlight Reviews | `tblKcYEZAJAACxKZG` | 6 | `greenlight_gates` | Imported as historical gate records |
| 8 | Ovation | Packaging & Attachments | `tblMT444gKdp6uhrg` | 0 | `packaging_items` | 0 records at audit |
| 9 | Ovation | Rights & Chain of Title | `tbl9W27htPh7sad3u` | 24 | `rights_entries` |  |
| 10 | Ovation | Capital Pools & Raises | `tblWI1eZJ563OLNCs` | 6 | `funding_sources` | kind=capital_pool; finance-restricted |
| 11 | Ovation | Investors & Capital Relationships | `tblhoY736Onmp7ebK` | 0 | schema_only | Covered by Funding & capital + Companies (investor) |
| 12 | Ovation | Funding Commitments & Finance Stack | `tblRInYVUaqrAMOkh` | 0 | schema_only | Covered by funding_sources |
| 13 | Ovation | Incentives & Rebates | `tbl666Zr8zkFMMfCL` | 0 | schema_only | Covered by funding_sources kind=incentive |
| 14 | Ovation | Productions | `tbljzVavneKQoldiY` | 0 | schema_only | Covered by productions |
| 15 | Ovation | Production Schedule | `tblk1ADu0xGK5FcsM` | 0 | schema_only | Covered by shoot_days / schedule_blocks |
| 16 | Ovation | Budget Lines | `tblqDFqxnDWfqtsfx` | 0 | schema_only | Covered by budgets / budget_lines |
| 17 | Ovation | Purchase Orders & Commitments | `tblcJzQwokvaNm9Lh` | 0 | schema_only | Covered by purchase_orders |
| 18 | Ovation | Suppliers & Vendors | `tblHnxXGfx1TGjKbr` | 0 | schema_only | Covered by companies kind=supplier |
| 19 | Ovation | Team & Crew | `tbl1Xc76mWpGPDNuH` | 2 | `people` | Not deduplicated by name; review for duplicates against S'appening Crew |
| 20 | Ovation | Crew Assignments & Availability | `tblKDNpCwfKUug4LM` | 0 | schema_only | Covered by engagements / availability_blocks |
| 21 | Ovation | Cast & Contributors | `tblMPMVlmIbmk3fjl` | 0 | schema_only | Covered by people / engagements |
| 22 | Ovation | Locations & Facilities | `tblnSvK5FiTULK2Yb` | 0 | schema_only | Covered by locations |
| 23 | Ovation | Equipment & Assets | `tblY06SsiHE16iiA2` | 0 | schema_only | Covered by resources kind=equipment |
| 24 | Ovation | Asset Bookings & Hires | `tblt1w9fUQck2pjaf` | 0 | schema_only | Covered by resource_bookings |
| 25 | Ovation | Post & Delivery Workflow | `tblzZeqrxrbVIeRVI` | 0 | schema_only | Covered by post_tasks / deliverables |
| 26 | Ovation | Delivery Requirements | `tbl8hFuyL0tM40czz` | 0 | schema_only | Covered by deliverables |
| 27 | Ovation | Companies & Partners | `tbl8RZ5iLRsQFpPe1` | 0 | schema_only | Covered by companies |
| 28 | Ovation | Contacts | `tbll1tB1ZkZnOH6OX` | 0 | schema_only | Covered by people |
| 29 | Ovation | Buyer & Market Intelligence | `tblVfK7t0dBdv4nMP` | 0 | schema_only | Covered by companies + sales_opportunities |
| 30 | Ovation | Sales & Licensing Pipeline | `tblXjR6d8Ah8aj4j7` | 0 | schema_only | Covered by sales_opportunities |
| 31 | Ovation | Rights Deals & Licence Windows | `tbl0eB6H9aapvTEl2` | 0 | schema_only | Covered by licence_windows |
| 32 | Ovation | Catalogue & Exploitation | `tbltFaNOXqFYPCtzN` | 0 | schema_only | Covered by releases / licence_windows |
| 33 | Ovation | Franchise & Derivative Rights | `tbl0aoUysZMvFEpos` | 0 | schema_only | Covered by rights_entries |
| 34 | Ovation | Contracts & Agreements | `tblUsBNQeuvEDgfdv` | 0 | schema_only | Covered by contracts |
| 35 | Ovation | Contract Obligations | `tbl7LD20N1Z0yS2zC` | 0 | schema_only | Covered by contract_obligations |
| 36 | Ovation | Bank Accounts | `tblkXBcxtpVjuNAcW` | 0 | schema_only | Deferred: sensitive banking data requires a finance connector; not stored |
| 37 | Ovation | Finance Transactions | `tbltu90im9sKo5ibJ` | 0 | schema_only | Covered by expenses; corporate ledger deferred |
| 38 | Ovation | Cash Forecast & Runway | `tblGD9joiGG2fkwUc` | 0 | schema_only | Deferred: corporate cash forecasting |
| 39 | Ovation | Risk Register | `tble6AX5q30HgGZgT` | 8 | `risks` |  |
| 40 | Ovation | KPIs & Targets | `tblh5LjFsQIDDYNpm` | 14 | `kpis` | Manual values carry an as-of date = source record date; no live metric key |
| 41 | Ovation | Board Meetings | `tbl6qu7c6XJsXnZqc` | 0 | schema_only | Covered by meetings kind=board |
| 42 | Ovation | Management Packs | `tbl4RQ519UNGOExSc` | 0 | schema_only | Covered by Command Centre + reports |
| 43 | Ovation | Strategic Partnerships | `tblN9LmsqcDNOjt3R` | 0 | schema_only | Covered by sponsor_deals kind=partnership |
| 44 | Ovation | Build Partner Buy Decisions | `tbl3hbagWldR5SNbj` | 0 | schema_only | Covered by decisions |
| 45 | Ovation | Acquisition Targets | `tblzWdQzcEWDl2ksP` | 0 | schema_only | Deferred: corporate M&A |
| 46 | Ovation | Brand & Commercial Integrations | `tblSDKwzYadAfuqZn` | 0 | schema_only | Covered by sponsor_deals / commercial_deliverables |
| 47 | Ovation | Release & Distribution | `tbl9VcjogrvZ7PrnL` | 0 | schema_only | Covered by releases |
| 48 | Ovation | Incidents & Issues | `tbleEi1rCVxF7Suea` | 0 | schema_only | Covered by risks / tasks |
| 49 | Ovation | Tasks | `tblRbyoznd2CGUhYF` | 30 | `tasks` | Assignees not auto-mapped to users |
| 50 | Ovation | SOP Library | `tblbnDjKHaazwXpTC` | 13 | `sops` |  |
| 51 | Ovation | Automation Control Centre | `tblkBhusxIPPTufev` | 22 | `workflow_definitions` | Imported as draft/blocked specifications — never live until reviewed and tested |
| 52 | Ovation | IP Sourcing & Acquisitions | `tbl0HcwrbK9CRDKBY` | 0 | schema_only | Covered by ip_projects stage=idea |
| 53 | Ovation | Packaging Overview | `tbl8tUS2Ep5rEsjcs` | 6 | `packaging_items` | Requires linked Slate & IP record |
| 54 | Ovation | Script Coverage & Creative Reviews | `tblZf6o2YKUTMLkMm` | 2 | `creative_reviews` |  |
| 55 | Ovation | Episodes & Production Units | `tblJlzTkh3qMwKSEI` | 0 | schema_only | Covered by episodes |
| 56 | Ovation | Production Cost Reports | `tblJIuNy0695hZUZM` | 0 | schema_only | Covered by budget summary (computed) |
| 57 | Ovation | Meetings & Actions | `tblYzuDNqYAvKJMX1` | 0 | schema_only | Covered by meetings + tasks |
| 58 | Ovation | Corporate Finance Monthly | `tblo03n3VexCz73RT` | 0 | schema_only | Deferred: corporate reporting |
| 59 | Ovation | Territories & Markets | `tblCDt33JnNl2FjUO` | 20 | `territories` |  |
| 60 | Ovation | Rights Inventory | `tbliHogEBonnE4crD` | 0 | schema_only | Covered by rights_entries |
| 61 | Ovation | Decision Log | `tblZ7Y1HnsachEDBA` | 0 | schema_only | Covered by decisions |
| 62 | Ovation | Exploitation Opportunities | `tblRWykGrQYdig1y9` | 0 | schema_only | Covered by sales_opportunities |
| 63 | Ovation | Rights Revenue | `tblsyVMB5thVLtKqT` | 0 | schema_only | Deferred: rights revenue ledger |
| 64 | Ovation | Workflow Queue | `tblIvD7lvfJBOBihI` | 6 | archived | Historical Airtable queue rows; superseded by outbox_events. Archived in lineage only |
| 65 | Ovation | Post Service Projects | `tblUvt8ahxuNBgdwb` | 0 | schema_only | Covered by productions kind + post_tasks |
| 66 | Ovation | Production Services Jobs | `tbliqDChqZ4muAAyI` | 0 | schema_only | Covered by productions + tasks |
| 67 | Ovation | Studio & Stage Bookings | `tblRs0Z3AE4FQxjZy` | 0 | schema_only | Covered by location_bookings |
| 68 | Ovation | Automation Run Log | `tblsGAc1AqnPdEhR9` | 6 | archived | Historical run log of spec rows; superseded by workflow_runs. Archived in lineage only |
| 69 | S’appening | Episodes | `tblrKqCF9PnjQ4bdt` | 4 | `episodes` | Under one legacy production; synopsis preserved verbatim in synopsis_original |
| 70 | S’appening | Cast | `tblDcjVHc65OC9H16` | 48 | `people` | + engagement kind=cast on legacy production |
| 71 | S’appening | Crew | `tblaDlMpofxpr93OY` | 7 | `people` | + engagement kind=crew on legacy production |
| 72 | S’appening | Scenes | `tblW1sDnBQzmdFpBP` | 79 | `scenes` | + scene_people, scene_resources, location; no automation fired |
| 73 | S’appening | Locations | `tblloD53Mvy1pUEzK` | 54 | `locations` |  |
| 74 | S’appening | Props | `tbl1itnh3XL8nqlJp` | 89 | `resources` | kind=prop |
| 75 | S’appening | Wardrobe | `tbloG4g2iedUFqRP0` | 44 | `resources` | kind=wardrobe |
| 76 | S’appening | Equipment | `tblBDx9WK9VkX3S7L` | 20 | `resources` | kind=equipment |
| 77 | S’appening | Shot List | `tbldAycWzelaDgau1` | 70 | `shots` | Never flagged auto-generated; no generation key |
| 78 | S’appening | Shoot Days | `tblsTWM2urZpWUxeR` | 40 | `shoot_days` | All records kept incl. duplicate dates; + schedule_blocks |
| 79 | S’appening | Marketing | `tbl9jRJK5Dd02i7HY` | 1 | `sponsor_deals` | kind=marketing |
| 80 | S’appening | Release Forms | `tblGb5n08jJfvEXeA` | 19 | `release_forms` |  |
| 81 | S’appening | Expenses | `tbllJvZ9H9Ow6J6I6` | 1 | `expenses` | Imported as submitted unless source says approved/paid |
| 82 | S’appening | Sponsors | `tbl3SdVP1H29sA5eQ` | 1 | `sponsor_deals` | + company kind=sponsor |
| 83 | S’appening | Partnerships | `tblxqpbUutLQjdr7B` | 1 | `sponsor_deals` | kind=partnership + company |
| 84 | S’appening | Contracts | `tblALxRmagNbPK2xI` | 1 | `contracts` | Imported 'signed' status flagged for evidence review |
| 85 | S’appening | Tasks | `tbl26XR8j5lufCo3K` | 1 | `tasks` |  |
| 86 | S’appening | Catering | `tbliGM5qp7GjHaKoK` | 1 | `catering_orders` |  |
| 87 | S’appening | Transport | `tblnNv8gvVBGSoIVv` | 1 | `transport_bookings` |  |
| 88 | S’appening | Post Production | `tblugisZl5kj9LLxR` | 1 | `post_tasks` |  |
| 89 | S’appening | Distribution | `tbl61L0vljlzfGqlI` | 1 | `releases` |  |
| 90 | S’appening | Editing | `tblHlxKEuO31ovAyL` | 80 | `post_tasks` | kind=edit, reconciled to Scenes; never creates scenes |
