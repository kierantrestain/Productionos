#!/bin/sh
# Calls the app's job runner every JOBS_EVERY seconds (default 300).
sleep 20
while true; do
  curl -fsS -m 120 -X POST -H "Authorization: Bearer ${CRON_SECRET}" http://app:3000/api/jobs/run >/dev/null 2>&1 || echo "$(date -u +%FT%TZ) job run failed (will retry)"
  sleep "${JOBS_EVERY:-300}"
done
