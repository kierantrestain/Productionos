# Release report — 20 Nov 2026

Branch `claude/zen-volta-h99wya` · production https://production-os-peach.vercel.app · Vercel READY · `/api/health` → db up, 14 migrations.
Statuses follow the acceptance matrix: PASS (real verified) = real browser/DB run here; PASS (mock/integration only) = network/model stubbed.

| ID | Item | Status | Evidence |
|---|---|---|---|
| P01 | Base, relational tables, inverse links, formulas | PASS (real verified) | `tests/integration/platform.test.ts`, `tests/e2e/platform.spec.ts` |
| P02 | Grid edit/paste/undo/filter/group/search/reload | PASS (real verified) | platform E2E (edit + reload); integration for filters/sorts |
| P03 | Attachments upload/download/delete + permissions | PASS (integration, DB storage provider) | `tests/integration/*` from platform branch; production uses `db` storage (S3 not configured) |
| P04 | Button field / app buttons update record, run automation | PASS (real verified) | `apps.spec.ts` "Mark as won" → persisted + automation logged activity |
| P05–P07 | App, pages, components; drag, inspector, autosave, reload; publish, versions, rollback | PASS (real verified) | `apps.spec.ts` builder journey; `apps.test.ts` conflicts/versions |
| P08 | Published CRM with real KPIs and actions | PASS (real verified) | KPIs asserted against fixture (6 open, £99,000, £54,000) |
| P09 | Production OS on the generic renderer | PASS (integration) | `apps.test.ts` Production OS |
| P10 | Client portal scoped (positive + negative) | PASS (real verified) | `apps.spec.ts` portal journey; `apps.test.ts` scope refusal |
| P11 | Forms: required + conditional fields, submission | PASS (integration + E2E submission) | portal form E2E; conditional logic in renderer |
| P12 | AI full-system plan → validate → revise → apply | PASS (mock/integration only) | `apps.test.ts` planner; live key not configured |
| P13 | Automation trigger once, schedule, retry, run log | PASS (integration) | `platform-services.test.ts`; hourly runner needs repo secrets |
| P14 | Airtable read sync / CSV / pack import idempotence | PASS (mock) + real local pack import | `docs/AIRTABLE_PACK_IMPORT.md`; reconciliation below |
| P15 | Scoped v2 REST API + OpenAPI | PASS (integration); live 401 without token verified | `/api/v2/openapi.json` 200 live |
| P16–P17 | Role privacy incl. widget table id, cross-base | PASS (integration) | platform hardening tests, `apps.test.ts` cross-base refusal |
| P18 | Concurrent edit conflicts, type-change preview | PASS (integration) | platform hardening tests; builder draft conflicts |
| P19–P20 | One visual system, light/dark, 390/768/1440/1600, axe | PASS (real verified locally) | axe WCAG A/AA: 0 violations on 6 key screens; no horizontal overflow at 390/768 |
| P21 | 10k/50k/100k performance | PASS (measured) | `docs/PERFORMANCE.md` |
| P22 | Legacy Production Suite | PASS (real verified) | `journey.spec.ts` 14 checks |
| P23 | CI/build/migrations/deploy | PASS | build, 97 integration + 17 E2E locally; Vercel READY |
| P24 | Docs current | PASS | README, PERFORMANCE, AIRTABLE_PACK_IMPORT, this report |

Live authenticated browser checks were **not** possible from this environment (demo passwords were rotated; no live credentials) — all browser journeys ran against a production build on a local database.

## Airtable pack reconciliation (local, non-production database)
Bases 3/3 · tables 149/149 · fields 3,147/3,147 · records 2,445/2,445 · links 5,934 resolved, 0 unresolved · views 277 (name+type only) · forms 49 · automations 15 translated (all disabled), 28 untranslatable (Gmail, external triggers, scripts…) · attachments 217 pending binary transfer · interface pages 169 need manual rebuild · rerun: 0 created / 2,445 unchanged · formulas: 3,108 exact matches, 342 explained (TODAY()/false omissions), 4 values flagged.

## Blocked / unfinished
- Production import of the Airtable pack: needs the production `DATABASE_URL` and an approved target workspace.
- `ANTHROPIC_API_KEY` and `SECRET_ENCRYPTION_KEY` not set on Vercel (AI features, Airtable sync tokens, SSO secrets stay disabled).
- Hourly scheduling: add `JOBS_URL` + `CRON_SECRET` repository secrets (and `CRON_SECRET` on Vercel).
- File storage in production is the database provider; S3/R2 credentials required for large files.
- Views still compute whole tables server-side (linear ≈ 8 ms per 1,000 rows); SQL push-down is next.
- Imported Airtable interface pages are inventoried, not rebuilt as apps; automations stay off until reviewed.

## Connected apps (Composio) and Sign in with ChatGPT — configuration

Built, tested with MOCK-ONLY fetchers (no live Composio/OpenAI traffic from this environment):

| Variable | Purpose |
|---|---|
| `COMPOSIO_API_KEY` | Enables connecting apps (Composio-managed sign-in), pulling data in, and agent app tools. Optional `COMPOSIO_API_BASE` (default `https://backend.composio.dev/api/v3`). |
| `OPENAI_SIWC_CLIENT_ID` | OpenAI-issued client ID for Sign in with ChatGPT (offered to selected partners). Register callback `https://<your-domain>/api/connect/chatgpt/callback`. Optional: `OPENAI_SIWC_CLIENT_SECRET`, `OPENAI_SIWC_SCOPES` (default `openid email profile offline_access`), `OPENAI_SIWC_RESOURCE`, `OPENAI_SIWC_API_BASE` (default `https://api.openai.com/v1`), `OPENAI_SIWC_MODEL` (default `gpt-5`). Use the values OpenAI's partner documentation gives you. |
| `SECRET_ENCRYPTION_KEY` | Required to store ChatGPT tokens (encrypted at rest). |

Unverified until a live run: Composio v3 paths for toolkits/auth configs/tool execution, and the exact
scopes/resource OpenAI requires for plan usage. These are configuration, not code changes.
