# System ownership and boundaries

**Production OS — Claude — `kierantrestain/Productionos`:** film/TV/game show production operations, show/IP slate oversight, studio scheduling, cast/crew, shot lists, budgets, legal/rights, post/distribution, commercial workflow. Independent auth, PostgreSQL schema and storage, Vercel deployment.

**Mimic OS — Codex — other repository:** business operating system, cross-business analytics, CRM-like/workflow/executive coordination. No shared production tables, credentials, database migrations or commits. Later integration may consume permitted Production OS events/API endpoints (e.g. budget health, project status), subject to RBAC and explicit separate user consent. Publish event contracts and API version instead of sharing database access.

**SWDR — separate existing screenplay production/writing platform:** production imports locked/approved scripts and revision metadata; do not implement its writing UI here. Future Webhook/API should require validated production ownership, conflict policy, scene-ID mapping, immutable revision snapshots and authorisation.

**Airtable — source only during migration:** read-only extract or explicit secure export, idempotent import; no edit/delete. Do not rely on Airtable for real-time app persistence after cutover.

**Optional external services:** mail (provider config), document/signing (explicit legally valid provider), calendars, storage, scheduled jobs. All services are mocked/disabled in dev until scoped credentials and owner approval. No email, contract or financial transfer from importing a record.

**REA:** optional authorised observations of Airtable visible interfaces; not a substitute for database access or legal authorisation to inspect a third-party service.

**Astryx:** component/design reference; check licence and React ecosystem support, use original brand language.
