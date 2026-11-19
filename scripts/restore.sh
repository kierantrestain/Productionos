#!/usr/bin/env bash
# Restore a backup into a TARGET database (use a fresh staging DB, never production without sign-off).
# Usage: TARGET_DATABASE_URL=... scripts/restore.sh <file.dump> [--yes]
set -euo pipefail
FILE="${1:?backup file required}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
if [[ -f "$FILE.sha256" ]]; then sha256sum -c "$FILE.sha256"; else echo "warning: no checksum file"; fi
if [[ "${2:-}" != "--yes" ]]; then read -r -p "Restore into $TARGET_DATABASE_URL? Existing objects will be replaced. Type RESTORE: " ok; [[ "$ok" == "RESTORE" ]] || exit 1; fi
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$TARGET_DATABASE_URL" "$FILE"
echo "Restore complete."
