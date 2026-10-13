#!/usr/bin/env bash
# Manual "Deploy to VPS" for when GitHub Actions is unavailable (it is
# disabled on the bharathcyclehub-a11y account: "Actions has been disabled
# for this user"). Run as root in the hPanel browser terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/bharathcyclehub-a11y/bch-rc/<sha>/deploy/vps/manual-deploy.sh | bash -s <sha>
#
# Builds commit <sha> from the public repo ON the VPS, packs it exactly like
# .github/workflows/deploy-vps.yml, checks that native sharp loads in the
# bundle BEFORE switching (12 Oct 2026 incident), then runs the repo's
# remote-deploy.sh (switch, health-check, automatic rollback). The env comes
# from /var/www/bch-rc/shared/.env as it is — this script never rewrites it.
# remote-deploy.sh (re)installs the managed crons — INSTALL_CRONS=true below.
set -euo pipefail
SHA="${1:?usage: manual-deploy.sh <full-git-sha>}"
APP_DIR=/var/www/bch-rc
WORK=/root/bch-rc-build
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export PATH="$HOME/.npm-global/bin:/usr/local/bin:$PATH"
echo "node $(node -v) — building $SHA"

# Report (never print) the courier credentials the new code reads.
for k in DELHIVERY_API_TOKEN DELHIVERY_PICKUP_LOCATION SHIPROCKET_EMAIL; do
  if grep -qE "^(export +)?$k=.+" "$APP_DIR/shared/.env"; then echo "env $k: set"; else echo "env $k: NOT set"; fi
done

rm -rf "$WORK"
git clone --quiet https://github.com/bharathcyclehub-a11y/bch-rc.git "$WORK"
cd "$WORK"
git checkout --quiet "$SHA"
npm ci --no-audit --no-fund
grep -vE '^(export +)?VERCEL(_[A-Z0-9_]*)?=' "$APP_DIR/shared/.env" > .env.production
NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=3072 nice -n 10 npm run build
B=.next/standalone
cp -r public "$B/public"
mkdir -p "$B/.next"
cp -r .next/static "$B/.next/static"
cp deploy/vps/ecosystem.config.cjs deploy/vps/cron.sh "$B/"
find "$B" -maxdepth 1 -name '.env*' -delete
rm -f .env.production
echo "--- checking sharp in the new bundle"
if ! (cd "$B" && node -e "require('sharp')"); then
  echo "sharp missing/broken in bundle — copying the installed linux build"
  mkdir -p "$B/node_modules/@img"
  rm -rf "$B/node_modules/sharp"
  cp -r node_modules/sharp "$B/node_modules/sharp"
  cp -r node_modules/@img/. "$B/node_modules/@img/"
  (cd "$B" && node -e "require('sharp')") || { echo "ABORT: sharp still fails — live site NOT changed"; exit 1; }
fi
echo "SHARP OK"
echo "$SHA" > "$B/REVISION"
mkdir -p "$APP_DIR/incoming"
tar -czf "$APP_DIR/incoming/release.tgz" -C "$B" .
cp deploy/vps/remote-deploy.sh "$APP_DIR/incoming/"
# INSTALL_CRONS=true is required: remote-deploy.sh REWRITES the crontab and,
# without it, drops the managed reconcile / sync-shipments / analytics jobs
# (13 Oct 2026: a manual deploy without it removed them).
APP_DIR="$APP_DIR" APP_PORT=3000 INSTALL_CRONS=true bash "$APP_DIR/incoming/remote-deploy.sh" "$SHA"
echo "live revision: $(cat "$APP_DIR/current/REVISION")"
(cd "$APP_DIR/current" && node -e "require('sharp'); console.log('live sharp OK')")
echo "courier webhook route: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/webhooks/delhivery) (200 = new code live)"
crontab -l | grep sync-shipments || true
rm -rf "$WORK"
echo "DONE"
