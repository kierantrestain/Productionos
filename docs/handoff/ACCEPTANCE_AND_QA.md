# Production OS operational acceptance plan

No pass without actual runnable evidence. Use Playwright plus service integration tests against a real (non-production) PostgreSQL database. Keep test actors separate from live Airtable imports.

## A. Domain and persistence

1. New user belongs to Organisation A and cannot enumerate/read Organisation B's records by URL manipulation or API requests.
2. Producer creates a production/show, episode, scene/segment and shot; links persist after refresh, browser close/reopen and second authorised session.
3. User can create a standalone film/ad project with no season/episode (production unit / segments), and a series with seasons and episodes.
4. Scene links real cast, crew, props, wardrobe, location, equipment and shooting requirements. Resource/people records are reused across productions without accidental duplication.
5. Search, filter, sort, saved views and keyboard/accessibility behaviour operate with at least 79 scene records in fixtures.
6. Editing/post rows imported from S’appening do not become 80 extra scenes; 79 source scenes and 80 editing records remain separately traceable.

## B. Scheduling, call sheets, assets

7. Add scenes into a shoot day with locations, start/finish, travel, meal and call times. Overlap and room/kit/crew conflicts are detected without page reload.
8. Source's 40 shoot-day records are handled as actual records; UI does not assume there are only eight dates because there are eight day-specific interfaces.
9. Generate versioned print/PDF call sheet with latest approved schedule, address, parking/location, role-specific call times, contact policy and issue timestamp. Previous issued versions remain unchanged after rescheduling.
10. Cast/crew user sees assigned details but cannot view internal salaries, budget/funding or unrelated personal records.
11. Equipment double-book, conflicting crew availability, unsent contract, missing release and unconfirmed location produce visible actionable alerts.

## C. Automation, communications, legal

12. Updating scene name/director repeatedly yields **at most one** automatically created initial shot where rule says it should exist; a deliberate manual additional shot is never destroyed.
13. When a contact or signing provider is not connected, contract and cast email remain in draft/blocked status, never marked Delivered/Signed; no surprise outbound sends.
14. Live email requires authorised sender, preview, correct recipient, explicit confirmation, idempotency and immutable attempted/delivered/failed audit.
15. Legacy deployed automation bearer credential is not in app code, logs or test artifacts; source owner receives rotation notice.
16. All 22 Ovation automation-control rows are inventoried and assigned `implemented`, `paused`, `replaced`, `retired` or `blocked` with evidence; not assumed live.
17. Role-gated spending/greenlight decision checks actor permissions and records the approval chain.

## D. Finance, rights, post and delivery

18. Budget estimate, approved, committed, actual, variance and VAT are distinct. £ totals match line items and source labels; finance is invisible to a cast-only account.
19. Rights register shows chain-of-title evidence, territories, media, expiry, restrictions; missing clearance can block release approval.
20. Editing review has versioned deliveries, stakeholder comments, linked media and acceptance status. Uploads use protected URLs and permissions.
21. Sponsor integrations and commercials have deliverable tracking, stage, due date, obligations and production linkage.
22. Executive dashboards drill through to actual records and never show random or seeded data as production facts.

## E. Migration and release

23. All 90 table records receive documented disposition and mapping; mismatches are explicit. Actual field settings/formulas/options are fetched or flagged `NOT EXPORTED`.
24. Each imported record has unique lineage, exact source content checksum, import batch, and target mapping. Import twice: second run creates no duplicate operational records or new notifications.
25. Source foreign links resolve or appear in a documented exception queue. Attachment bytes are copied and hashed; expired URLs are flagged, not treated as success.
26. All 75 observed interface pages map to actual screens or deliberately consolidated functional alternatives; draft pages not seen are marked unverified.
27. Production app works at 1440px desktop, 1024px tablet, 390px mobile; keyboard navigation, contrast and touch targets tested.
28. Typecheck, lint, migration, unit, integration, Playwright, security tests and production build run clean. Deployment URL opens, authenticates and persists changes.
29. Backup/restore procedure is demonstrated in staging; all source Airtable bases are untouched.
30. A reviewer can reproduce the full journey: show → episode → scene → linked resources → shot → shoot day → call sheet → post edit → approved delivery; each action uses the database.

## Output
Use a machine-readable release matrix (`scenario`, `pass|fail|blocked`, `evidence`, `commit`, `owner`, `notes`), accompanied by live demo URL and exact test logs. A 'blocked' integration is acceptable only as an explicitly disclosed limitation, never counted as passed.
