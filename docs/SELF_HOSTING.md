# Self-hosting Bang On OS

Run the whole OS on your own server: the app, its database, automatic HTTPS, background jobs, nightly
backups and — optionally — private AI and object storage. One command installs it; one command upgrades it.

## What you need
- A Linux server (or any machine) with **Docker** and the compose plugin. 2 vCPU / 4 GB RAM is plenty
  without AI. For private AI add RAM for the model (7B ≈ 8 GB, 14B ≈ 16 GB; a GPU makes it fast).
- A domain name pointing at the server (for HTTPS). Use `localhost` to try it on your laptop.
- Ports 80 and 443 open.

## Install (5 minutes)
```bash
git clone <this repository> bangon && cd bangon
./install.sh
```
The installer asks for your domain, which AI to use (private / Claude / none) and where to keep files,
generates every secret into `.env`, builds and starts the stack, and waits until it is healthy. Open
`https://<your-domain>` — the first visit shows the setup page that creates the owner account.

## What runs (docker-compose.yml)
| Service | What it does |
|---|---|
| `app` | Bang On OS (Next.js standalone server). Applies database migrations automatically on every start. |
| `db` | PostgreSQL 16 with a persistent volume. |
| `caddy` | Automatic HTTPS (Let's Encrypt) and compression in front of the app. |
| `jobs` | Runs automations, schedules, waits, syncs and the outbox every 5 minutes (`JOBS_EVERY`). |
| `backup` | Nightly `pg_dump` to `./backups`, keeping 14 days (`BACKUP_KEEP_DAYS`), with SHA-256 checksums. |
| `minio` *(profile `files`)* | S3-compatible storage for attachments, for large media. |
| `ollama` *(profile `ai`)* | Private AI on your own hardware; downloads the model on first start. |

The app listens on `127.0.0.1:3000` only; the public reaches it through Caddy.

## Private AI — nothing leaves your servers
Choose **Private** in the installer, or set in `.env`:
```env
AI_PROVIDER=local
LOCAL_AI_BASE_URL=http://ollama:11434/v1     # or your own vLLM / LM Studio / LocalAI server
LOCAL_AI_MODEL=qwen2.5:7b                    # bigger is better: qwen2.5:14b/32b, llama3.1:70b
```
Every AI feature — AI fields, the system planner, the assistant, agents and automation AI steps — then
runs on that model. Things that would need a public service are switched off and say so: web research,
reading PDFs (images still work with a vision model) and connecting a public ChatGPT plan. Use a model
with tool calling (Qwen 2.5, Llama 3.1+) so the assistant and agents can look up and propose changes.
`AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` uses Claude instead; `AI_PROVIDER=off` disables AI.
Settings → Integrations & status always shows which AI is active and where data goes.

## Production Suite
The Production Suite is a separate app (repo `kierantrestain/Production-suite`) with its own install and
database. Set `SUITE_URL=https://suite.example.com` in `.env` to show a Production Suite link in the sidebar
and forward old suite links (`/production`, `/schedule`, …) to it.

## Day-2 operations
| Task | Command |
|---|---|
| Upgrade (backs up first, then rebuilds and migrates) | `./upgrade.sh` |
| Logs | `docker compose logs -f app` |
| Health | `curl -s https://<domain>/api/health` |
| Manual backup | `docker compose exec -T db pg_dump -U bangon -d bangon -Fc > backups/manual.dump` |
| Restore a backup | `docker compose exec -T db pg_restore -U bangon -d bangon --clean --if-exists < backups/<file>.dump` |
| Stop / start | `docker compose down` / `docker compose up -d` |

Keep `.env` and `./backups` private and copied off the server — they hold your secrets and data.
Behind a corporate proxy, build with `--build-arg HTTPS_PROXY=…` (and `--secret id=ca,src=ca.pem`).

## Verified
On a clean machine this stack was built and started from scratch: migrations applied, health OK over
HTTPS through Caddy, the first-run setup created the owner, a base was created from a template, the
job runner answered and the first backup was written. Private AI was verified against a simulated
OpenAI-compatible server (tests/integration/private-ai.test.ts); test it with your own model before
relying on it.
