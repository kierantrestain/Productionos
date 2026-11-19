#!/usr/bin/env bash
# Logical backup of the Production OS database (custom format, compressed).
# Usage: DATABASE_URL=... scripts/backup.sh [output-dir]
# Store backups in encrypted, access-controlled storage — they contain personal and commercial data.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR" && chmod 700 "$OUT_DIR"
FILE="$OUT_DIR/productionos-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$DATABASE_URL"
chmod 600 "$FILE"
sha256sum "$FILE" > "$FILE.sha256"
echo "Backup written: $FILE"
