#!/usr/bin/env bash
# Upgrade a self-hosted Bang On OS: back up, pull the latest code, rebuild, migrate (automatic on start).
set -euo pipefail
cd "$(dirname "$0")"
PROFILES=(); grep -q '^STORAGE_PROVIDER=s3' .env && PROFILES+=(--profile files); grep -q '^AI_PROVIDER=local' .env && grep -q 'ollama:11434' .env && PROFILES+=(--profile ai)
echo "Backing up the database first…"
docker compose exec -T db sh -c 'pg_dump -U bangon -d bangon --format=custom' > "backups/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ).dump"
git pull --ff-only
docker compose "${PROFILES[@]}" up -d --build
echo "Upgraded. Health: $(docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health)"
