#!/bin/sh
# Nightly logical backup (pg_dump custom format) with retention. Restore: see docs/SELF_HOSTING.md.
set -eu
mkdir -p /backups
while true; do
  f="/backups/bangon-$(date -u +%Y%m%dT%H%M%SZ).dump"
  if pg_dump -h db -U bangon -d bangon --format=custom --no-owner --no-privileges -f "$f"; then
    sha256sum "$f" > "$f.sha256"; echo "backup written $f"
  else echo "backup failed"; rm -f "$f"; fi
  find /backups -name 'bangon-*.dump*' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
  sleep 86400
done
