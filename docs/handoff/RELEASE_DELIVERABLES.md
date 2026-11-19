# Delivery contract for Claude

Claude should return in its final answer (based on actual completed actions):

- **Working production URL on Vercel**; if deployment credentials/access are missing, explicitly state 'NOT DEPLOYED' instead of fabricating a URL.
- Exact GitHub repo, branch, commit SHA(s) and pull request reference (if used).
- Architecture/stack, DB migration status, hosting and object-storage configuration without secret values.
- Operational screenshots for real flows if permissible; do not leak private records publicly.
- Tested role accounts or secure invite procedure; NEVER disclose real account credentials.
- Automated test results: numbers, commands, date of run and passing/failing assertions, browser-test evidence.
- Airtable source mapping completion report covering all **90** tables, **75** observed interface pages, four native automations and 22 Ovation control specs.
- Migration reconciliation: rows imported and excluded, per-table counts vs dated source metadata, source↔target IDs, orphaned links, attachments stored/failed, duplicate collisions, second-import idempotency, unresolved rights/privacy issues.
- Open defects and exact blocked external integrations (e.g. signing service, email, financial connections) with owner-controlled next actions.
- Explicit statement that original Airtable remains intact until owner-approved cutover.

Never claim all imported if only metadata exists. Never claim a finished production app based on a deployable home screen.
