# View engine performance — measured

Reproduce: `pnpm tsx scripts/bench-views.ts 10000 50000 100000` (refuses hosted databases).
Machine: 4 vCPU / 15 GB cloud container, local PostgreSQL 16, Node 22. Table: 6 fields (text, number,
single select, date, link → 200 clients, formula). Median of 3 runs (unpaged: 1 run), milliseconds.

## Before (2026-11-20, commit 3f47de0)

| Rows | Unpaged grid load | Filter (select + number) | Sort (number) | Search |
|---:|---:|---:|---:|---:|
| 10,000 | 130 ms (4.9 MB payload) | 327 | 3,069 | 985 |
| 50,000 | 498 ms (24.8 MB payload) | 1,558 | **20,618** | 4,814 |

## After (paged grid, cached Intl formatters, shared collator, lazy memoised display text)

| Rows | First page (500) | Filter (select + number) | Sort (number) | Sort (formula) | Search | Grid initial load | Payload |
|---:|---:|---:|---:|---:|---:|---:|---|
| 10,000 | 92 | 94 | 86 | 102 | 268 | 100 | 252 KB |
| 50,000 | 344 | 608 | 551 | 642 | 1,113 | 389 | 252 KB |
| 100,000 | 825 | 1,079 | 1,126 | 1,329 | 2,584 | 839 | 252 KB |

The grid now loads the first 1,000 matching rows (then 5,000 more per "Load more"); filters, sorts,
groups and search always run across **all** matching rows on the server.

## Known limits (honest)

- Every view still loads and computes the whole table on the server; time grows linearly
  (≈ 8 ms per 1,000 rows). Next step: push plain-field filters/sorts into SQL (jsonb expressions +
  expression indexes) and cache computed formula/rollup values between requests.
- Search over 100,000 rows takes ~2.6 s.
- Hosted (Neon, eu-west-2) latency adds network round-trips; not benchmarked here because the
  script refuses to write test data to production.

## Large-table engine (SQL fast path)

Tables with ≥ `FAST_VIEW_MIN_ROWS` records (default 3,000) filter, sort, search and page **in Postgres**;
formulas, lookups and rollups are then computed only for the rows on the page. Record-specific reads
(detail pages, agents, automation checks) load only those records. Dashboard KPIs and charts grouped by
a single select are aggregated in SQL. Anything SQL can't reproduce exactly (sorting by a formula, a
date bucketed chart, a self-linked table) falls back to the in-memory engine, so results never change —
`tests/integration/capacity.test.ts` checks the SQL path returns identical ids, order and counts for every
supported filter/sort operator.

Measured locally (`pnpm tsx scripts/bench-views.ts 50000 100000 200000`, page 500, median of 3, ms):

| Rows | Single record | Grid page | Filter (select + number) | Sort (number) | Search | Sort by formula (in-memory fallback) |
|---:|---:|---:|---:|---:|---:|---:|
| 50,000 | 19 | 30 | 51 | 55 | — | 561 |
| 100,000 | 28 | 44 | 74 | 77 | 569 | 1,239 |
| 200,000 | 39 | 68 | 129 | 128 | 976 | 2,997 |

Before this change a 100,000-row grid page took ~830 ms and search ~2.4 s; 200,000-row search took ~5 s.
Large-table search covers stored values, select names, people and linked records' names among the
fields the viewer can see; formula/lookup results are searched on smaller tables only.
