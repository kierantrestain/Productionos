#!/usr/bin/env python3
"""Compare private Airtable export manifest against dated source inventory."""
import argparse
import csv
import json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--manifest', required=True, help='private_exports/export_manifest.json')
p.add_argument('--inventory', default='../01_source_audit/airtable_table_inventory.csv')
a=p.parse_args()
manifest=json.loads(Path(a.manifest).read_text())
with Path(a.inventory).open(newline='') as f: expected=list(csv.DictReader(f))
base_ids={'Ovation OS':'appGbXugVx1UAfw6B','S’appening Production':'appkx0tyAT1SDGSz5'}
observed=manifest.get('tables',{})
issues=[]; counts=[]
for table in expected:
    key=f"{base_ids[table['source_base']]}/{table['table_id']}"
    actual=observed.get(key)
    if actual is None:
        issues.append(f'MISSING TABLE: {table["source_base"]}/{table["table"]}')
        continue
    exp_count=int(table['records'])
    received=actual.get('count')
    field_count=int(table['fields'])
    if int(actual.get('field_count',0))!=field_count:
        issues.append(f'FIELD COUNT DRIFT: {table["table"]}: {field_count} -> {actual.get("field_count")}')
    if isinstance(received,int):
        counts.append((exp_count, received))
        if received!=exp_count: issues.append(f'RECORD COUNT DRIFT: {table["table"]}: {exp_count} -> {received}')
    else: issues.append(f'RECORDS NOT EXPORTED: {table["table"]}')
if len(observed)!=len(expected):issues.append(f'TABLE INVENTORY DRIFT: {len(expected)} expected vs {len(observed)} export')
print(f"Tables: {len(observed)} exported / {len(expected)} dated inventory")
print(f"Compared record counts: {len(counts)}/{len(expected)}; 19-Nov reference sum={sum(x for x,y in counts)}; actual sum={sum(y for x,y in counts)}")
print(f'Issues: {len(issues)}')
for issue in issues:print(' - '+issue)
print('Note: source may legitimately have changed since 19-Nov-2026. Investigate drift instead of overwriting it.')
if issues:raise SystemExit(2)
