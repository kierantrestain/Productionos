#!/usr/bin/env python3
"""Read-only Airtable schema/record exporter; output may contain PRIVATE data.

Do not commit output files. Provide credentials via AIRTABLE_PAT environment variable.
Usage:
  AIRTABLE_PAT=... python export_airtable_readonly.py --schema-only
  AIRTABLE_PAT=... python export_airtable_readonly.py --with-records
  AIRTABLE_PAT=... python export_airtable_readonly.py --with-records --download-attachments

Airtable REST API accepts a Personal Access Token with schema.bases:read +
data.records:read and access to BOTH explicitly named bases. The exporter never
sends write requests. The optional attachment fetch retrieves files referenced
by the API; never publish exported documents or URLs.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASES = {
    'Ovation_OS': 'appGbXugVx1UAfw6B',
    'Sappening_Production': 'appkx0tyAT1SDGSz5',
}
API = 'https://api.airtable.com/v0'


def get_json(path, token, params=None):
    query = ('?' + urllib.parse.urlencode(params)) if params else ''
    url = API + path + query
    for attempt in range(9):
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}, method='GET')
        try:
            with urllib.request.urlopen(req, timeout=40) as response:
                content = response.read()
            time.sleep(0.26)
            return json.loads(content)
        except urllib.error.HTTPError as exc:
            status = exc.code
            if status in (429, 500, 502, 503, 504) and attempt < 8:
                delay = min(35, 2 ** attempt)
                print(f'Airtable HTTP {status}, retrying after {delay}s', file=sys.stderr)
                time.sleep(delay)
                continue
            msg = exc.read().decode('utf-8', errors='replace')[:400]
            raise RuntimeError(f'Airtable GET failed {status} for {path}: {msg}') from None
    raise RuntimeError('Airtable retries exhausted')


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def safe_name(name):
    return re.sub(r'[^A-Za-z0-9._-]+', '_', name)[:100]


def iter_attachments(obj):
    if isinstance(obj, dict):
        if all(k in obj for k in ('id', 'url', 'filename')) and str(obj.get('url','')).startswith('https://'):
            yield obj
        for value in obj.values():
            yield from iter_attachments(value)
    elif isinstance(obj, list):
        for value in obj:
            yield from iter_attachments(value)


def download_attachment(att, base_id, table_id, record_id, root, manifest):
    url = att['url']
    if not url.startswith('https://'):
        raise ValueError('Not an HTTPS attachment URL')
    name = safe_name(att.get('filename','attachment'))
    dest = root / base_id / table_id / record_id / f"{safe_name(str(att['id']))}_{name}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Download only Airtable-issued attachment URLs and never pass API bearer credentials.
    # Avoid leaking raw URLs in logs or manifest (signed URLs are temporary secrets).
    req = urllib.request.Request(url, method='GET', headers={'User-Agent':'ProductionOSReadOnlyExport/1'})
    h = hashlib.sha256(); size = 0
    with urllib.request.urlopen(req, timeout=90) as response, dest.open('wb') as f:
        while block := response.read(512 * 1024):
            size += len(block)
            if size > 300 * 1024 * 1024:
                dest.unlink(missing_ok=True)
                raise RuntimeError('Attachment too large for exporter safety cap (300MB)')
            f.write(block); h.update(block)
    try: os.chmod(dest, 0o600)
    except OSError: pass
    manifest.append({'base_id':base_id,'table_id':table_id,'record_id':record_id,'attachment_id':att.get('id'), 'filename':att.get('filename'), 'path':str(dest),'bytes':size,'sha256':h.hexdigest()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    exclusive = parser.add_mutually_exclusive_group()
    exclusive.add_argument('--schema-only', action='store_true', help='Only schema/field metadata (default)')
    exclusive.add_argument('--with-records', action='store_true', help='Export all record cells, including private fields')
    parser.add_argument('--download-attachments', action='store_true', help='Requires --with-records; downloads referenced attachment bytes')
    parser.add_argument('--out', default='private_exports', help='Local PRIVATE export directory (gitignored)')
    args = parser.parse_args()
    if args.download_attachments and not args.with_records: parser.error('--download-attachments requires --with-records')
    token = os.getenv('AIRTABLE_PAT','').strip()
    if not token:
        raise SystemExit('AIRTABLE_PAT is required, scoped to read schema/records for both bases. Never paste into chat/code.')
    root=Path(args.out).resolve()
    root.mkdir(parents=True, exist_ok=True)
    try: os.chmod(root, 0o700)
    except OSError: pass
    output = {'base_details': {}, 'tables': {}, 'attachment_manifest': []}
    print(f'Output is sensitive: {root}. DO NOT COMMIT OR SHARE PUBLICLY.', file=sys.stderr)
    for alias, base_id in BASES.items():
        schema = get_json(f'/meta/bases/{base_id}/tables', token)
        tables = schema.get('tables', [])
        write_json(root / alias / 'schema.json', schema)
        output['base_details'][base_id]={'name':alias,'table_count':len(tables)}
        print(f'{alias}: {len(tables)} tables', file=sys.stderr)
        for table in tables:
            table_id=table['id']
            if not args.with_records:
                output['tables'][f'{base_id}/{table_id}']={'name':table['name'],'field_count':len(table.get('fields',[])),'count':'NOT_EXPORTED'}
                continue
            params={'pageSize':100,'returnFieldsByFieldId':'true'}
            records=[]
            while True:
                batch=get_json(f'/{base_id}/{table_id}', token, params)
                records.extend(batch.get('records',[]))
                if not batch.get('offset'): break
                params['offset']=batch['offset']
            write_json(root / alias / 'records' / f'{table_id}.json', {'base_id':base_id,'table_id':table_id,'table_name':table['name'],'records':records})
            output['tables'][f'{base_id}/{table_id}']={'name':table['name'],'field_count':len(table.get('fields',[])),'count':len(records)}
            print(f"  {table['name']}: {len(records)} records", file=sys.stderr)
            if args.download_attachments:
                for rec in records:
                    for att in iter_attachments(rec.get('fields',{})):
                        try:
                            download_attachment(att, base_id, table_id, rec['id'], root/'attachments', output['attachment_manifest'])
                        except Exception as exc:
                            output['attachment_manifest'].append({'base_id':base_id,'table_id':table_id,'record_id':rec['id'],'attachment_id':att.get('id'),'status':'FAILED','error':str(exc)[:200]})
    write_json(root / 'export_manifest.json', output)
    print('Finished (read-only). Reconcile manifest and secure outputs before using in staging.', file=sys.stderr)

if __name__=='__main__': main()
