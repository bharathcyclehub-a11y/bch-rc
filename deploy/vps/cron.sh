#!/usr/bin/env bash
# Calls one cron route on the local app with the CRON_SECRET bearer, the way
# Vercel Cron does. The secret is read at run time from shared/.env so it
# never appears in the crontab.
set -euo pipefail
ROUTE="${1:?usage: cron.sh /api/cron/<name>}"
APP_DIR="${APP_DIR:?}"
SECRET="$(grep -E '^CRON_SECRET=' "$APP_DIR/shared/.env" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
[ -n "$SECRET" ] || { echo "CRON_SECRET missing" >&2; exit 1; }
curl -fsS -m 120 -o /dev/null \
  -H "Authorization: Bearer $SECRET" \
  "http://127.0.0.1:${APP_PORT:-3000}${ROUTE}"
