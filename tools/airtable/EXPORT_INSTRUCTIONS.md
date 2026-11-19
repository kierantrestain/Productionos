# Exporting real Airtable source data to staging safely

The handoff pack does NOT contain the 796 record bodies or attachment bytes. Record counts are an audit snapshot, not an export. This omission is deliberate to avoid placing actor contact details, contractual information and unreleased IP inside a public repo or shared builder prompt.

Claude must use one of two authorised paths:

**A. Airtable connector in its own working environment:** read the two base schemas, selected fields and all paginated records. Persist securely for staging migration; fetch attachment bytes before temporary URLs expire. Keep an export manifest including field configurations, IDs, options, formulas, linked tables and view definitions if API permissions allow.

**B. Scoped read-only Airtable personal access token:** create a token in the Airtable UI giving `schema.bases:read` and `data.records:read` to ONLY these two bases; supply it as `AIRTABLE_PAT` via a secure local environment/deployment secret, not in chat or version control. Run from `04_migration_tools/`:

```bash
python3 export_airtable_readonly.py --schema-only
python3 export_airtable_readonly.py --with-records
python3 export_airtable_readonly.py --with-records --download-attachments
python3 reconcile_export.py --manifest private_exports/export_manifest.json --inventory ../01_source_audit/airtable_table_inventory.csv
```

The exporter is read-only: GET operations only. Its output (`private_exports/`) is gitignored, contains potentially sensitive information and must remain outside public GitHub. Attachment files may be very large; size limit 300 MB per file in this helper. Some Airtable attachments may fail due to expired permissions or unsupported hosts; record failures and re-fetch from Airtable if authorised. Do not consider this complete without a validated attachment manifest.

Important export semantics:

- Page through all 90 tables (100 Airtable records/page), and capture **field IDs**, type/options/formula config; verify linked record IDs resolve or are flagged.
- Do not convert `Editing` (80 rows) to 80 new scenes; reconcile against `Scenes` (79 rows).
- Track 4 Episodes, 79 Scenes, 70 Shots, 40 Shoot Days, 48 Cast, 7 Crew, 54 Locations, 89 Props, 44 Wardrobe, 20 Equipment from S’appening snapshot.
- 10 Ovation interface pages and 65 S’appening pages were observed. API metadata may not expose full visual/element configuration or unpublished drafts; record that gap and inspect through an authorised browser if available.
- On first/second import, use staging only. Verify 100% lineage or explicitly explained exclusions, link resolution, duplicate detection, file hashes, access and real screen visibility. **Never update or delete source Airtable records automatically.**
- No outgoing notifications, live signature requests, approvals or scheduled tasks should fire during import.
- The expected 796 row count may legitimately change after audit; log differences in a fresh manifest, never fabricate counts to match.
