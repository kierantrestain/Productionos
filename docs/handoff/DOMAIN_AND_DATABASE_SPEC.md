# Canonical Production OS domain and database specification

## Objective
Build ONE independently persistent multi-user production platform by consolidating overlapping Ovation (IP, oversight, governance, finance, rights) and S’appening (hands-on shoots) models. The new app should not expose users to 90 database tables in navigation.

## Authoritative lifecycle
`organisation → business_unit → ip_project/show → production → season → episode_or_unit → scene_or_segment → shot_or_take → shoot_day/schedule_block → ingest/media_asset → post_task/version → deliverable/release`

A production MAY be a standalone commercial/film without season/episode, so do not enforce a television-only hierarchy. Scenes and segments differ: scripted scene numbers versus non-scripted/game show rounds, questions, challenges, graphics and running-order blocks. Support both natively. Productions may have several simultaneous units, locations and crews. Reference time zones explicitly (Europe/London defaults), and store all timestamps UTC.

## Suggested groups of actual PostgreSQL entities

**Tenancy and control:** `organisations`, `business_units`, `users`, `memberships`, `roles`, `grants`, `teams`, `saved_views`, `audit_events`, `source_records`, `import_batches`, `merge_conflicts`, `attachments`.

**IP and development:** `ip_projects`, `show_formats`, `development_materials`, `script_revisions`, `creative_reviews`, `packaging_items`, `greenlight_gates`, `approvals`, `ip_assets`, `rights_chain_entries`, `rights_permissions`, `rights_territories`, `licence_windows`.

**Production:** `productions`, `production_units`, `seasons`, `episodes`, `segments`, `scenes`, `scene_breakdowns`, `shots`, `storyboards`, `shot_versions`, `shoot_days`, `schedule_blocks`, `callsheets`, `callsheet_versions`, `callsheet_recipients`, `production_documents`.

**Participants:** `people`, `companies`, `engagements` (many roles/companies/productions per person), `crew_assignments`, `cast_assignments`, `availability_blocks`, `contacts`, `release_forms`, `contracts`, `contract_signatures`, `contract_obligations`.

**Resources:** `locations`, `facilities`, `location_bookings`, `equipment`, `equipment_bookings`, `props`, `prop_requirements`, `wardrobe_items`, `wardrobe_requirements`, `transport_bookings`, `catering_orders`, `supplier_accounts`.

**Money and approvals:** `budgets`, `budget_lines`, `cost_transactions`, `expenses`, `purchase_orders`, `commitments`, `finance_sources`, `payment_milestones`, `cash_forecasts`, `approval_requests`, `risk_items`, `finance_reports`.

**Post and distribution:** `media_assets`, `ingest_batches`, `post_tasks`, `edit_versions`, `review_comments`, `deliverables`, `delivery_requirements`, `release_plans`, `distribution_channels`, `sponsor_deals`, `commercial_integrations`, `rights_deals`, `sales_opportunities`, `licence_revenues`.

**Operations:** `tasks`, `comments`, `mentions`, `activity_logs`, `sops`, `workflow_definitions`, `workflow_versions`, `workflow_runs`, `outbox_events`, `notification_deliveries`, `job_leases`.

Don't literally build every suggested table before the first operational slice. Implement the full lifecycle incrementally, use properly typed migrations, and map every source table in `90_table_mapping_matrix.csv`. If a source table has no records, preserve its functional requirement but do not generate placeholder production data.

## Minimum relational invariants

- `scenes(episode_id, source_scene_key)` and `shots(scene_id, unique_business_key)` are distinct; no direct shot duplication when scene detail is updated.
- A `person` can have simultaneous cast + crew contracts and multiple production engagements. Do not deduplicate on name alone; use verified identifiers/manual review.
- `schedule_blocks` link each scene/segment to shoot day, time, crew, location and resource locks; conflicts are computed and shown before issue.
- A `call_sheet` is a versioned snapshot of the actual scheduled plan with issuance/recipient receipts; editing the underlying schedule after issuing does not silently rewrite prior PDF.
- `post_tasks` link back to source scenes/shots and media, without replacing original source breakdown rows.
- All rights are scoped by territory, medium, permitted uses, dates, parties, signed evidence, and any restrictions; missing paperwork is visible as a blocker.
- Store money in minor units and currency codes; tax/VAT, gross/net, actual versus committed versus forecast, exchange-date and costs by show/episode are distinct.
- File metadata and immutable hashes live in DB; bytes go to protected object storage; signed time-limited URLs and per-file access checks. File deletion is reversible by retention policy.
- Every source import is idempotent: unique `(source_base_id,source_table_id,source_record_id)` plus source hash/version. Import writes should not trigger production notifications, emails or real-life contracts.
- Audit significant actions (who/when/from/to) and preserve revision history where operationally important.

## Essential flows

**Scripted:** choose project → season/episode → editable breakdown → scene/cast/props/wardrobe/kit/location → shots → schedule → call sheet → ingest → edit/review → signed delivery.

**Unscripted/panel/game show:** choose show/format → episode → running order/segments/rounds/challenges → guest/panel booking → graphics/questions/props/software cues → studio set/equipment booking → multi-camera shot plan → shoot day → media/post → scheduled release.

**Executive:** submit IP → review and attachment packs → approved budget/rights/legal checks → decision/greenlight → allocate capital → track production health → licensing/distribution/sponsor pipeline → KPI reporting.

## Data provenance and original systems
Source map record: `id`, `source_system='airtable'`, `base_id`, `table_id`, `record_id`, `target_entity_type`, `target_id`, `import_batch_id`, `source_modified_at?`, `source_hash`, `migration_status`, `resolution_note`, `imported_at`. Preserve source data for forensic compare in secure migration staging; do not expose to ordinary crew screens.

Historical Ovation brands and governance records must not auto-assign current Bang On founders/cap table. Bind IP and contracts to the real legal entity owning them, explicitly. Do not infer founder percentages from old approvals.
