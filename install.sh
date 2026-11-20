#!/usr/bin/env bash
# Bang On OS — guided self-hosted install. Needs Docker with the compose plugin.
#   curl -fsSL <your repo>/install.sh | bash      or      ./install.sh
set -euo pipefail
cd "$(dirname "$0")"
say() { printf "\033[1m%s\033[0m\n" "$*"; }
command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null || { echo "The Docker compose plugin is required."; exit 1; }
gen() { openssl rand -base64 "${1:-32}" 2>/dev/null | tr -d '\n=/+' | cut -c1-"${2:-44}"; }
if [ -f .env ]; then say "Found an existing .env — keeping it. (Delete it to start over.)"; else
  say "Bang On OS setup"
  read -rp "Domain (e.g. os.yourcompany.com, or 'localhost' to try it out): " DOMAIN; DOMAIN=${DOMAIN:-localhost}
  echo "AI: 1) Private — runs on this server, nothing leaves it (needs ~8 GB RAM; a GPU helps)"
  echo "    2) Claude via Anthropic API (best quality; prompts go to Anthropic)"
  echo "    3) No AI"
  read -rp "Choose 1/2/3 [1]: " AI; AI=${AI:-1}
  read -rp "Store large files in MinIO object storage instead of the database? [y/N]: " FILES
  {
    echo "DOMAIN=$DOMAIN"; echo "APP_PORT=3000"
    echo "POSTGRES_PASSWORD=$(gen 32 40)"
    echo "SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32)"
    echo "CRON_SECRET=$(gen 32 48)"
    if [[ "${FILES:-n}" =~ ^[Yy] ]]; then
      echo "STORAGE_PROVIDER=s3"; echo "STORAGE_ENDPOINT=http://minio:9000"; echo "STORAGE_BUCKET=bangon-files"
      echo "STORAGE_ACCESS_KEY_ID=bangon"; echo "STORAGE_SECRET_ACCESS_KEY=$(gen 32 40)"
    else echo "STORAGE_PROVIDER=db"; fi
    case "$AI" in
      1) echo "AI_PROVIDER=local"; echo "LOCAL_AI_BASE_URL=http://ollama:11434/v1"; echo "LOCAL_AI_MODEL=qwen2.5:7b" ;;
      2) read -rp "Anthropic API key: " K; echo "AI_PROVIDER=anthropic"; echo "ANTHROPIC_API_KEY=$K" ;;
      *) echo "AI_PROVIDER=off" ;;
    esac
  } > .env
  chmod 600 .env
  say "Wrote .env (keep it private and backed up)."
fi
PROFILES=()
grep -q '^STORAGE_PROVIDER=s3' .env && PROFILES+=(--profile files)
grep -q '^AI_PROVIDER=local' .env && grep -q 'ollama:11434' .env && PROFILES+=(--profile ai)
mkdir -p backups && chmod 700 backups
say "Building and starting (first run takes a few minutes)…"
docker compose "${PROFILES[@]}" up -d --build
say "Waiting for the app to become healthy…"
for i in $(seq 1 90); do
  if docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"ok":true'; then
    DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
    say "✓ Bang On OS is running → https://$DOMAIN  (first visit opens the setup page to create the owner account)"
    grep -q '^AI_PROVIDER=local' .env && echo "  Private AI model downloads in the background: docker compose logs -f ollama-pull"
    exit 0
  fi; sleep 2
done
echo "The app didn't become healthy in time. Check: docker compose logs app"; exit 1
