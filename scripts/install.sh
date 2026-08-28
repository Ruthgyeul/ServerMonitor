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

# Default the run user to whoever owns the checkout (so data/ stays writable),
# falling back to the invoking sudo user, then root.
RUN_USER="${RUN_USER:-$(stat -c '%U' "$REPO_DIR" 2>/dev/null || echo "${SUDO_USER:-root}")}"
if ! id "$RUN_USER" >/dev/null 2>&1; then
  err "RUN_USER '$RUN_USER' does not exist. Set RUN_USER=<existing user> and retry."
  exit 1
fi

NPM_BIN="$(command -v npm || true)"
NODE_BIN="$(command -v node || true)"
if [ -z "$NPM_BIN" ] || [ -z "$NODE_BIN" ]; then
  err "node and npm must be installed and on PATH (Node.js 18+)."
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js 18+ is required (found $($NODE_BIN -v))."
  exit 1
fi

log "Installing ServerMonitor from $REPO_DIR as user '$RUN_USER' on port $PORT"

# --- Build -----------------------------------------------------------------

# Run the build steps as the service user so file ownership is correct.
run_as_user() { sudo -u "$RUN_USER" bash -c "cd '$REPO_DIR' && $*"; }

log "Installing dependencies (npm ci)…"
run_as_user "'$NPM_BIN' ci"

log "Building (npm run build)…"
run_as_user "'$NPM_BIN' run build"

# The history/alert persistence directory (gitignored).
log "Ensuring data directory…"
install -d -o "$RUN_USER" -g "$(id -gn "$RUN_USER")" "$REPO_DIR/data"

# --- systemd unit ----------------------------------------------------------

UNIT_SRC="$REPO_DIR/deploy/servermonitor.service"
UNIT_DEST="/etc/systemd/system/${SERVICE}.service"
if [ ! -f "$UNIT_SRC" ]; then
  err "Unit template not found at $UNIT_SRC"
  exit 1
fi

log "Writing $UNIT_DEST"
# Render the template placeholders. Use | as the sed delimiter since paths contain /.
sed \
  -e "s|__RUN_USER__|$RUN_USER|g" \
  -e "s|__INSTALL_DIR__|$REPO_DIR|g" \
  -e "s|__NPM__|$NPM_BIN|g" \
  -e "s|__PORT__|$PORT|g" \
  "$UNIT_SRC" >"$UNIT_DEST"

# Best-effort validation (available on most systemd hosts).
if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze verify "$UNIT_DEST" || err "systemd-analyze reported issues (continuing)."
fi

log "Enabling and starting ${SERVICE}.service"
systemctl daemon-reload
systemctl enable --now "${SERVICE}.service"

log "Done. ServerMonitor is running on port $PORT."
echo "  Status:  systemctl status ${SERVICE}"
echo "  Logs:    journalctl -u ${SERVICE} -f"
echo "  Config:  edit ${REPO_DIR}/.env then: sudo systemctl restart ${SERVICE}"
