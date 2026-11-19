# Bang On Production OS

One independent production operating system for film, television, documentary, commercial and studio formats (panel shows, gameshows, podcasts). It consolidates the **Ovation OS** (68 tables) and **S’appening Production** (22 tables) Airtable bases into a single relational platform. It is not an Airtable clone.

> **Status (19 Nov 2026):** deployed on Vercel at **https://production-os-peach.vercel.app**, backed by Neon PostgreSQL. Migrations run automatically on every deploy. The first visit opens a one-time setup screen that creates your organisation and admin (optionally with a clearly flagged demo workspace). **Live Airtable migration has not run**: it needs a read-only Airtable token (see `docs/MIGRATION.md`).

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

## Make it yours (no code)

Organisation admins can tailor everything under **Customise** and **Automations**:

| Capability | What it does |
|---|---|
| **Production templates** | *New production* offers 12 types: feature film, scripted series, documentary, commercial, music video, studio gameshow, panel show, podcast, live event, corporate, reality and blank. A template builds the episodes or units, the running order, a budget top sheet (categories only), deliverables, the post pipeline and dated kickoff tasks. **Save as template** turns any production into your own reusable format. |
| **Terminology** | Rename record types organisation-wide (Scenes → Items) or per production (Running order, Rounds, Story beats, Set-ups). |
| **Custom fields** | Add text, number, money, date, yes/no, choice or link fields to any record type. They appear in forms, grid columns (inline-editable), filters and exports, and can be required on creation. |
| **Option lists** | Add your own choices to drop-downs (segment types, departments, categories). Status lists that drive approvals, delivery and conflicts stay locked. |
| **Defaults & approvals** | Currency, timezone, default VAT, the spend limits for PM, producer and executive approval, and the call-sheet contact policy. All of these change server-side behaviour, not just labels. |
| **Automation rules** | "When *record* *field* becomes *value* → create a task / set a field". Rules run with their creator's permissions, are idempotent per event, are evaluated at the moment of change, and are loop-guarded. |

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
