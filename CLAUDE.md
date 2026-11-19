# Instructions for Claude Code inside Productionos

This repository implements **Bang On Production OS**, a standalone film, television, unscripted, studio gameshow and commercial production management application. Do not build Mimic OS here.

Read `01_CLAUDE_MASTER_PROMPT.md` and the provided handoff files before making architecture decisions. The GitHub repo was EMPTY on 2026-11-19: initialise the application rather than claiming to modify existing working software.

Follow these non-negotiables:

- Working end-to-end flows, durable database persistence, secure permissions and automated tests come before polishing static dashboards.
- No Airtable dependence at runtime after a VERIFIED full migration; do not delete or modify Airtable.
- Do not invent imported casts, crew, episodes, attachments or numerical KPIs. Clearly label demo/test fixtures, never pass them off as source records.
- Keep source lineage (`base_id`, `table_id`, `record_id`, `import_batch`, `source_updated_at`, checksum, verification status).
- Do not collapse S’appening `Editing` records into 80 extra scenes without reconciliation against 79 `Scenes` records.
- Deployed S’appening automation count = 3; fourth is undeployed. Ovation 22 workflow-control rows are specs, not live automations.
- Never use hard-coded secrets; require external service credentials and API grants through safe environments. Do not commit source record dumps to a public repo.
- RBAC: organisation admin, executive, producer, production manager, department head, crew, cast, finance/legal, post, commercial, external reviewer; least privilege and production-level scoping.
- Financial transfers, contract emails, rights changes, approvals, release sends and deletions require server-side checks, confirmation and immutable audit.
- Define migrations, typed APIs, validation, indexes, error handling, background jobs, retry/idempotency, backup/restore.
- Browser test the entire journey with refresh and another role: show → episode → scene → shot list → resource assignment → shoot day → call sheet → post → delivery.
- Build an original professional interface with clear information hierarchy, sharp typography, responsive tables/calendar, dense but readable operations views; use Astryx if suitable, but don't copy Airtable branding or proprietary implementation.
- Separate legitimate user data from system-control configuration and external integrations. Protect PII.
- Commit coherent increments; use CI. Report only actually verified tests and deployments. No false 'complete'.

If a required Airtable credential, business account or deployment secret is absent, implement the appropriate secure adapter and migration tool, run local mock-only integration tests (clearly labelled), document exactly which production integration remains blocked. Never bypass access controls or invent a live migration.
