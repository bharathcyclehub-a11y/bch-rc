#!/usr/bin/env bash
# Runs ON the VPS, invoked by .github/workflows/deploy-vps.yml.
#
#   $APP_DIR/releases/<sha>/   one extracted standalone bundle per deploy
#   $APP_DIR/current           symlink -> the live release
#   $APP_DIR/shared/.env       runtime secrets (written by the workflow)
#
# Swap the symlink, reload pm2, health-check; on failure point the symlink
# back at the previous release and reload again.
set -euo pipefail

SHA="${1:?usage: remote-deploy.sh <git-sha>}"
APP_DIR="${APP_DIR:?APP_DIR not set}"
APP_PORT="${APP_PORT:-3000}"
INSTALL_CRONS="${INSTALL_CRONS:-false}"
KEEP_RELEASES=5
HEALTH_URL="http://127.0.0.1:${APP_PORT}/"

RELEASE="$APP_DIR/releases/$SHA"
INCOMING="$APP_DIR/incoming"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# Non-interactive SSH does not read ~/.bashrc, so node/pm2 installed via nvm
# (or into ~/.npm-global) are not on PATH. Load them explicitly.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export PATH="$HOME/.npm-global/bin:/usr/local/bin:$PATH"

command -v node >/dev/null || { echo "node not found on PATH"; exit 1; }
command -v pm2 >/dev/null || { echo "pm2 not found on PATH (npm i -g pm2)"; exit 1; }
# ecosystem.config.cjs uses util.parseEnv (Node >= 20.12).
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&b>=12)?0:1)' \
  || { echo "node $(node -v) is too old — need >= 20.12"; exit 1; }
[ -s "$APP_DIR/shared/.env" ] || { echo "missing $APP_DIR/shared/.env"; exit 1; }

log "extracting $SHA"
rm -rf "$RELEASE"
mkdir -p "$RELEASE"
tar -xzf "$INCOMING/release.tgz" -C "$RELEASE"
rm -f "$INCOMING/release.tgz"

PREVIOUS="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"

activate() {
  ln -sfn "$1" "$APP_DIR/current.tmp"
  mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
  APP_DIR="$APP_DIR" APP_PORT="$APP_PORT" \
    pm2 startOrReload "$APP_DIR/current/ecosystem.config.cjs" --update-env
}

healthy() {
  for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$HEALTH_URL" || true)"
    [ "$code" = "200" ] && return 0
    sleep 2
  done
  return 1
}

log "activating"
activate "$RELEASE"

if healthy; then
  log "healthy on :$APP_PORT"
else
  log "HEALTH CHECK FAILED for $SHA"
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ]; then
    log "rolling back to $(basename "$PREVIOUS")"
    activate "$PREVIOUS"
    healthy && log "rollback healthy" || log "ROLLBACK ALSO UNHEALTHY"
  fi
  pm2 logs bch-rc --lines 60 --nostream || true
  exit 1
fi

pm2 save >/dev/null

# Cron jobs (vercel.json "crons" do not exist off Vercel). Opt-in, because
# while Vercel is still live its crons already run — enabling both would
# double-run reconcile and shipment sync. Managed block only; the rest of
# the user's crontab is left untouched.
BEGIN="# >>> bch-rc managed crons >>>"
END="# <<< bch-rc managed crons <<<"
current_tab="$(crontab -l 2>/dev/null | sed "/^$BEGIN\$/,/^$END\$/d" || true)"
if [ "$INSTALL_CRONS" = "true" ]; then
  CRON="$APP_DIR/current/cron.sh"
  chmod +x "$CRON"
  printf '%s\n' "$current_tab" "$BEGIN" \
    "*/5 * * * * APP_DIR=$APP_DIR APP_PORT=$APP_PORT $CRON /api/cron/reconcile" \
    "0 */3 * * * APP_DIR=$APP_DIR APP_PORT=$APP_PORT $CRON /api/cron/sync-shipments" \
    "10 * * * * APP_DIR=$APP_DIR APP_PORT=$APP_PORT $CRON /api/cron/analytics-snapshots" \
    "$END" | sed '/./,$!d' | crontab -
  log "crons installed"
else
  printf '%s\n' "$current_tab" | sed '/./,$!d' | crontab -
  log "crons not installed (VPS_INSTALL_CRONS != true)"
fi

log "pruning old releases (keeping $KEEP_RELEASES)"
LIVE="$(readlink -f "$APP_DIR/current")"
ls -1dt "$APP_DIR"/releases/*/ | tail -n +$((KEEP_RELEASES + 1)) | while read -r dir; do
  [ "$(readlink -f "$dir")" = "$LIVE" ] || rm -rf "$dir"
done

log "done: $SHA live"
