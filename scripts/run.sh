#!/bin/bash

# Read a single KEY=value out of .env without sourcing (executing) the file,
# since dotenv values aren't guaranteed to be safe shell syntax.
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"

read_env_value() {
    local key="$1"
    [ -f "$ENV_FILE" ] || return 0
    grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d '=' -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^['\"]//" -e "s/['\"]\$//"
}

KIOSK_USER="${KIOSK_USER:-$(read_env_value KIOSK_USER)}"
KIOSK_USER="${KIOSK_USER:-$(whoami)}"
KIOSK_URL="${KIOSK_URL:-$(read_env_value KIOSK_URL)}"
KIOSK_URL="${KIOSK_URL:-http://localhost:3000}"

# DISPLAY Setup
export DISPLAY=:0

# Kill any existing Firefox processes for the kiosk user
pkill -u "$KIOSK_USER" firefox

# Activate the firefox kiosk mode
firefox --kiosk "$KIOSK_URL"