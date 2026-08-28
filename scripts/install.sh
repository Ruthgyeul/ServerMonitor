#!/usr/bin/env bash
#
# Bare-metal installer for ServerMonitor: builds the app and installs a systemd
# service so it runs on boot and restarts on failure. This is the non-Docker
# path — on a real host it reads /proc, /sys and the host tools directly.
#
# Usage (from a clone of the repo):
#   sudo ./scripts/install.sh
#
# Configurable via environment variables:
#   RUN_USER=<user>   Service account to run as (default: the repo directory's owner)
#   PORT=<port>       Port to listen on (default: 3000)
#   SERVICE=<name>    systemd unit name (default: servermonitor)
#   DATA_DIR=<path>   History/alert persistence dir (default: <repo>/data, or .env's DATA_DIR)
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="${SERVICE:-servermonitor}"
PORT="${PORT:-3000}"

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
err() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; }

# --- Preconditions ---------------------------------------------------------

if [ "$(id -u)" -ne 0 ]; then
  err "This script installs a systemd unit and must run as root (use sudo)."
  exit 1
fi

# Default the run user to whoever owns the checkout (so builds and data/ stay
# writable), falling back to the invoking sudo user, then root.
RUN_USER="${RUN_USER:-$(stat -c '%U' "$REPO_DIR" 2>/dev/null || echo "${SUDO_USER:-root}")}"
if ! id "$RUN_USER" >/dev/null 2>&1; then
  err "RUN_USER '$RUN_USER' does not exist. Set RUN_USER=<existing user> and retry."
  exit 1
fi
RUN_GROUP="$(id -gn "$RUN_USER")"

NPM_BIN="$(command -v npm || true)"
NODE_BIN="$(command -v node || true)"
if [ -z "$NPM_BIN" ] || [ -z "$NODE_BIN" ]; then
  err "node and npm must be installed and on PATH (Node.js 20.9+)."
  exit 1
fi

# Next.js 16 requires Node >= 20.9.0 (see package-lock engines). Enforce the full
# minimum, not just the major, so a 18.x / 19.x / 20.0-20.8 host fails clearly here.
NODE_VER="$("$NODE_BIN" -p 'process.versions.node')"
NODE_MAJOR="${NODE_VER%%.*}"
NODE_MINOR_REST="${NODE_VER#*.}"
NODE_MINOR="${NODE_MINOR_REST%%.*}"
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 9 ]; }; then
  err "Node.js 20.9.0+ is required (found v$NODE_VER)."
  exit 1
fi

# Effective persistence directory: DATA_DIR env > .env's DATA_DIR > <repo>/data.
# A relative value resolves against the repo (matching process.cwd() at runtime).
read_env_value() {
  local key="$1"
  [ -f "$REPO_DIR/.env" ] || return 0
  grep -E "^${key}=" "$REPO_DIR/.env" | tail -n 1 | cut -d '=' -f2- |
    sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^['\"]//" -e "s/['\"]\$//"
}
DATA_DIR="${DATA_DIR:-$(read_env_value DATA_DIR)}"
DATA_DIR="${DATA_DIR:-$REPO_DIR/data}"
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$REPO_DIR/$DATA_DIR" ;; esac

log "Installing ServerMonitor from $REPO_DIR as user '$RUN_USER' on port $PORT"
log "Persistence directory: $DATA_DIR"

# --- Build -----------------------------------------------------------------

# If the run user doesn't own the checkout, hand it ownership first so `npm ci`
# and `npm run build` (which write node_modules/.next) don't hit EACCES.
CURRENT_OWNER="$(stat -c '%U' "$REPO_DIR" 2>/dev/null || echo '')"
if [ "$CURRENT_OWNER" != "$RUN_USER" ]; then
  log "Setting ownership of $REPO_DIR to $RUN_USER"
  chown -R "$RUN_USER:$RUN_GROUP" "$REPO_DIR"
fi

# Run the build steps as the service user so file ownership is correct.
run_as_user() { sudo -u "$RUN_USER" bash -c "cd '$REPO_DIR' && $*"; }

log "Installing dependencies (npm ci)…"
run_as_user "'$NPM_BIN' ci"

log "Building (npm run build)…"
run_as_user "'$NPM_BIN' run build"

log "Ensuring data directory…"
install -d -o "$RUN_USER" -g "$RUN_GROUP" "$DATA_DIR"

# --- systemd unit ----------------------------------------------------------

# Only request journal-read groups that actually exist — an unknown group makes
# systemd fail the unit with 216/GROUP.
FOUND_GROUPS=""
for group in systemd-journal adm; do
  if getent group "$group" >/dev/null 2>&1; then
    FOUND_GROUPS="${FOUND_GROUPS:+$FOUND_GROUPS }$group"
  fi
done
GROUPS_LINE=""
[ -n "$FOUND_GROUPS" ] && GROUPS_LINE="SupplementaryGroups=$FOUND_GROUPS"

# Escape sed replacement metacharacters (& | \) so paths/values with them render
# literally (e.g. a checkout under /srv/R&D/...).
esc() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }

UNIT_SRC="$REPO_DIR/deploy/servermonitor.service"
UNIT_DEST="/etc/systemd/system/${SERVICE}.service"
if [ ! -f "$UNIT_SRC" ]; then
  err "Unit template not found at $UNIT_SRC"
  exit 1
fi

log "Writing $UNIT_DEST"
sed \
  -e "s|__RUN_USER__|$(esc "$RUN_USER")|g" \
  -e "s|__INSTALL_DIR__|$(esc "$REPO_DIR")|g" \
  -e "s|__NPM__|$(esc "$NPM_BIN")|g" \
  -e "s|__PORT__|$(esc "$PORT")|g" \
  -e "s|__JOURNAL_GROUPS__|$(esc "$GROUPS_LINE")|g" \
  "$UNIT_SRC" >"$UNIT_DEST"

# Best-effort validation (available on most systemd hosts).
if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze verify "$UNIT_DEST" || err "systemd-analyze reported issues (continuing)."
fi

log "Enabling and (re)starting ${SERVICE}.service"
systemctl daemon-reload
systemctl enable "${SERVICE}.service"
# restart (not just start) so re-running the installer picks up a new build/port
# on an already-active service.
systemctl restart "${SERVICE}.service"

log "Done. ServerMonitor is running on port $PORT."
echo "  Status:  systemctl status ${SERVICE}"
echo "  Logs:    journalctl -u ${SERVICE} -f"
echo "  Config:  edit ${REPO_DIR}/.env then: sudo systemctl restart ${SERVICE}"
echo "           (changing a NEXT_PUBLIC_* value needs a rebuild: rerun this installer)"
