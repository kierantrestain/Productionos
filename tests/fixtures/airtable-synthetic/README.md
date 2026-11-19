# Synthetic Airtable export fixture

**Entirely synthetic test data. Not source data.** No record here came from the Ovation OS or
S'appening Airtable bases. Names are of the form "Synthetic Cast 1". Table IDs match the dated
inventory so reconciliation can be exercised; field IDs and record IDs are invented.

Layout matches `tools/airtable/export_airtable_readonly.py` output. Deliberate edge cases:
two shoot days on the same date, an Editing record with no matching scene (`recSynEd4`), an orphan
link (`recSynGhost`), one attachment with a correct SHA-256, one with a wrong hash, and one
attachment that was never downloaded.
