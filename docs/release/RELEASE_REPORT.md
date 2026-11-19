# Release report: Production OS v0.1.0 (19 Nov 2026)

## 1. Deployment status

**NOT DEPLOYED. No Vercel URL exists.** The build environment had no Vercel or Neon credentials, and `api.vercel.com`, `console.neon.tech` and `api.airtable.com` were unreachable under its network policy. The app is production-built and verified locally. Deployment steps are in `README.md` → *Deploy*. `vercel.json` runs migrations before each build.

## 2. Repository

Branch `claude/zen-volta-h99wya` on `kierantrestain/Productionos`. No pull request was opened. **The repository was public at handoff.** No private records, credentials, exports or attachments are committed (credential scan clean). Make the repository private before any real data enters the system.

## 3. Verified results (all commands run on 19 Nov 2026)

| Check | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | **pass**, 0 errors (TypeScript 5.9.3) |
| Lint | `pnpm lint` | **pass**, 0 errors, 0 warnings |
| Integration tests (real PostgreSQL 16.15) | `pnpm test` | **28 / 28 passed** in 4 files: journey 9, security 7, import 8, workflows 4 |
| Production build | `pnpm build` | **pass**, 36 dynamic routes |
| Browser E2E (Chromium, production build) | `pnpm test:e2e` | **11 / 11 passed**, on two consecutive runs against accumulated data |
| Migrations | `pnpm db:migrate` | 4 migrations applied (schema, DB guards, post-task keys, history-purge switch) |
| Backup → restore | `scripts/backup.sh` → `scripts/restore.sh` | Checksum OK; scenes 112/112, shots 91/91, audit 796/796, approval decisions 3/3 identical; all 3 immutability triggers restored |
| Credential scan | `git grep` bearer/PAT/API-key patterns | clean |

Defects found and fixed during QA, each with a regression test or re-run:
1. Kit demand was **summed** across a unit's sequential scenes (false "26 cameras needed"). It is now the per-day peak, summed across units on the same date.
2. Mobile layout overflowed by 137 px (top-bar search and grid min-width). Now 0 px at 390 and 1024.
3. A redundant client refresh after create could swallow an immediate navigation. Removed; the server action revalidates.
4. Imported *pending* historical Ovation approvals could have appeared as decidable (raised by Agent A). Now read-only and excluded from the inbox.
5. A stale server process served old HTML after a rebuild (environment, not app). The E2E process now restarts the server by port.

## 4. Architecture delivered

See `docs/ARCHITECTURE.md`. In summary: Next.js 15 / React 19 / TypeScript; PostgreSQL via Drizzle (77 tables) with DB-enforced guards (append-only audit log and approval decisions, immutable issued call sheets, money checks); 11-role RBAC with production-level membership and field redaction; transactional outbox workflow engine; S3-compatible storage with SHA-256 integrity; token-scoped `/api/v1` for SWDR and Mimic OS.

## 5. Migration status

| Item | Status |
|---|---|
| 90-table disposition | Complete (`docs/MIGRATION.md`): 41 canonical (784 audit records), 2 archived to lineage (12), 47 zero-record schema-only tables whose function the canonical model covers |
| Importer | Built and tested on a synthetic export: lineage, idempotent re-run, Editing↔Scenes reconciliation, attachment hashing, exception queue, no side effects |
| Live record import (796 snapshot records) | **BLOCKED**: no `AIRTABLE_PAT`; Airtable API unreachable from this environment |
| Attachments | **BLOCKED**: same reason; 0 imported |
| Field configs/options/formulas | **BLOCKED**: `NOT_EXPORTED` until the schema export runs |
| Airtable bases | **Untouched**: never accessed. Cut over only on explicit owner approval |

## 6. Outstanding blockers (owner actions)

1. **Make the GitHub repo private** before any real data is used.
2. **Revoke or rotate the legacy bearer credential** in S’appening’s *Send Cast Contract* script.
3. **Vercel + Neon:** connect the repo, provision Neon, and set `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `CRON_SECRET` and the storage variables.
4. **Object storage:** create an S3/R2 bucket (local disk is dev-only and refused on Vercel).
5. **Airtable migration:** issue a read-only PAT (`schema.bases:read`, `data.records:read`, both bases only) and run the exporter. Then run `pnpm import:airtable` as a dry run, then `--apply` into staging, twice, and review reconciliation and exceptions. Expect field-name mapping refinements after the first real dry run.
6. **Email / e-signature:** choose providers, add keys, and contract-test them before setting the `ENABLE_*` flags. The e-signature adapter is a stub that refuses to send.
7. **Ovation’s 22 automation specs:** review each after import. They stay blocked until implemented and tested.
8. **CI:** the GitHub Actions workflow is committed but has not run in this session (pushing is the first trigger).

## 7. Known limitations

- Call-sheet PDF uses the browser's print / save-as-PDF on a print-styled immutable snapshot; there is no server-side PDF renderer.
- No automated accessibility (axe/contrast) audit was run. The skip link, focus rings, ARIA labels, keyboard reorder controls and coarse-pointer touch sizing are implemented but not measured.
- Search/filter/sort/saved views on the 79-scene fixture are implemented, but not covered by a dedicated automated assertion or a performance benchmark.
- Weather is entered manually (no external weather service).
- The demo seed (`is_demo` org, every name prefixed "Demo") exists for evaluation and E2E. It is not source data.
