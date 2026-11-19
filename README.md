# Bang On Production OS

One independent production operating system for film, television, documentary, commercial and studio formats (panel shows, gameshows, podcasts). It consolidates the **Ovation OS** (68 tables) and **S’appening Production** (22 tables) Airtable bases into a single relational platform. It is not an Airtable clone.

> **Status (19 Nov 2026):** the application, database, workflows and tests are built and verified locally against PostgreSQL 16. **Not deployed** and **live Airtable migration not run**: this build environment has no Vercel, Neon or Airtable credentials, and those hosts are network-blocked. See [`docs/release/RELEASE_REPORT.md`](docs/release/RELEASE_REPORT.md).

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 (App Router), React 19, TypeScript 5.9 |
| Data | PostgreSQL (Neon in production), Drizzle ORM, SQL migrations in `drizzle/` |
| Auth | Email + password (scrypt), DB sessions (httpOnly cookie, hashed token), invitations, 11 roles + production-level membership |
| Files | Object storage adapter: S3-compatible (R2/S3) in production, local disk in dev; SHA-256 on write and verified on read |
| Jobs | Transactional outbox → workflow engine (leases, idempotency, retries, dead-letter); `/api/jobs/run` for Vercel Cron |
| Tests | Vitest integration tests on real Postgres; Playwright E2E |

## Workspaces

Command Centre · Slate & IP · Productions/Seasons/Episodes · Scenes, Segments & Shot Lists · Schedule & Shoot-Day Command · Cast, Crew & Talent · Locations & Resources · Budgets & Approvals · Post & Delivery · Rights & Contracts · Commercial & Distribution · Operations & Automations. Admin & Migration and a personal *My schedule* for cast/crew sit alongside these.

## Run locally

```bash
pnpm install
```

```bash
cp .env.example .env   # set DATABASE_URL, AUTH_SECRET, JOB_SECRET
```

```bash
pnpm db:migrate
```

```bash
DEMO_PASSWORD='choose-a-local-password' pnpm db:seed:demo   # optional, clearly flagged demo org
```

```bash
pnpm build && pnpm start
```

Verification:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

```bash
DEMO_PASSWORD='same-as-seed' pnpm test:e2e
```

## Deploy (Vercel + Neon)

1. Make this repository **private** before any real data is involved.
2. Create a Neon database. In Vercel, set `DATABASE_URL` (pooled), `DIRECT_URL`, `AUTH_SECRET`, `JOB_SECRET` / `CRON_SECRET`, `STORAGE_PROVIDER=s3` + bucket credentials.
3. Leave `ENABLE_REAL_EMAIL` and `ENABLE_REAL_SIGNATURE_REQUESTS` false until providers are contract-tested.
4. `vercel.json` runs migrations before the build and schedules the job runner (daily on Hobby; raise the frequency on Pro).

## Migration from Airtable (read-only)

See [`docs/MIGRATION.md`](docs/MIGRATION.md). Export with `tools/airtable/export_airtable_readonly.py` (GET-only, scoped PAT), then `pnpm import:airtable --dir <export> --org <slug>`. This defaults to a dry run; add `--apply` for staging. Both Airtable bases stay untouched until the owner approves cutover.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): domain model, permissions, workflows, business rules, integration boundaries
- [`docs/reports/INTERFACE_PAGES.md`](docs/reports/INTERFACE_PAGES.md): all 75 observed Airtable pages mapped to screens
- [`docs/MIGRATION.md`](docs/MIGRATION.md): 90-table disposition and import guarantees
- [`docs/reports/AUTOMATIONS.md`](docs/reports/AUTOMATIONS.md): automation migration and verification
- [`docs/release/ACCEPTANCE_MATRIX.md`](docs/release/ACCEPTANCE_MATRIX.md): the 30 acceptance scenarios with evidence
- `CLAUDE.md` and `docs/handoff/`, `docs/source/`: original handoff specification and source audit (metadata only, no records)

Mimic OS and SWDR are separate products. They integrate only through the token-scoped `/api/v1` contracts, never through shared database access.
