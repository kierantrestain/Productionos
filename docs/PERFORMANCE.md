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
