# Importing an Airtable export pack

`pnpm import:airtable-pack` turns a **read-only Airtable export pack** (the `Airtable_Migration_Pack/` layout:
`00_MANIFEST.json`, `bases/<name>/{01_schema,02_interfaces,03_automations,04_records,05_mapping}`) into new native
Bang On OS bases. It never contacts Airtable and never changes the source.

```bash
pnpm import:airtable-pack --dir <pack> --org <org-slug>            # dry run: validates and reports, writes nothing
pnpm import:airtable-pack --dir <pack> --org <org-slug> --apply    # creates/updates the native bases
pnpm import:airtable-pack --dir <pack> --org <org-slug> --apply --bases sinaport   # one base (folder, id or name)
```

`--create-org "<name>" --owner-email <email>` creates a fresh organisation for local or staging rehearsals. The
owner's random password is never printed. Reports go to `./private-import/` (JSON + Markdown). That folder is
gitignored because reports name confidential tables. **Never commit the pack or the reports.**

## Guarantees

- **New bases only.** Each Airtable base becomes a new base (`bases.template_key = airtable:<baseId>`). Existing
  bases and app data are never overwritten.
- **Idempotent and resumable.** Bases, tables, fields, views, forms and automations are tracked in `migration_map`
  (`org, "airtable", kind, sourceId → targetId`). Records are tracked by `base_records.source_ref =
  <baseId>/<tableId>/<recordId>`, which is unique per table. A rerun creates only what is missing and updates
  values that changed. An interrupted run is finished by running it again; each base's structure is one
  transaction, and records go in 200-row batches.
- **No side effects.** Records are written without outbox events. Imported automations are always created
  **disabled**. No AI, email or webhook runs during import.
- **Lineage.** Source IDs appear in table and field descriptions, in `migration_map`, and in each record's
  `source_ref`. The original record creation time is kept natively in `base_records.created_at`, so Airtable
  "Created time" fields map to our native `createdTime`.
- **Nothing invented.** Links to records missing from the export are listed as unresolved, never created. Views
  get their names and types only, because saved filters, sorts and layouts are not exported. Interface page
  layouts are inventoried for manual rebuild.

## Type mapping

| Airtable | Bang On OS | Notes |
|---|---|---|
| singleLineText, email, url, number, currency, percent, rating, checkbox, date, dateTime, duration, singleSelect, multipleSelects | same type | Select choice IDs are kept, so values and automation conditions map 1:1 |
| multilineText, richText | longText | Rich text keeps its Markdown source |
| phoneNumber | phone | |
| multipleRecordLinks | link | One field per Airtable field, with each side wired to its own inverse. "Single record" preference kept |
| multipleLookupValues | lookup | Same link and target field |
| rollup | lookup (+ warning) | The export doesn't include the aggregation function, so the same linked values are shown; pick the aggregation manually |
| count | count | Count filters are not supported (warning) |
| formula | formula | `{fieldId}` references re-pointed. Unsupported functions become a text snapshot with a warning |
| createdTime | createdTime | Native, from the preserved creation time |
| lastModifiedTime | dateTime snapshot | |
| autoNumber | number | Original numbers kept |
| createdBy, lastModifiedBy, collaborators | singleLineText | "Name &lt;email&gt;"; Airtable users aren't workspace members |
| multipleAttachments | attachment | Metadata only, `pendingTransfer: true`. File bytes are not in the export |
| aiText | aiText | Generated values kept; the prompt is not exported |
| button | button | The action is not exported |
| anything else, or invalid in source | longText snapshot | Warning in the report |

Forms become **form views**: field order, required flags and help text are kept, and sections are flattened.
Read-only and prefilled elements are noted. Automations are translated where possible: record created, form
submitted and record-matches-conditions triggers; update-record, create-record (linked back to the trigger
record) and if/else steps. External steps (Gmail, Calendar, custom scripts, external-connection triggers) are
listed as untranslated.

## Fidelity check

After applying, every native formula is recomputed and compared with the exported value. Differences are
classified as expected or unexplained:

- **Expected:** `TODAY()`/`NOW()` used directly or through another formula; `RECORD_ID()`, since new IDs are
  assigned by design; Airtable `NaN`; blank vs 0/false, since Airtable omits false values.
- **Unexplained:** anything else, listed with one sample per field to verify by hand.
