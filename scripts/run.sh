#!/bin/bash

# Load KIOSK_USER / KIOSK_URL from .env if present
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
fi

KIOSK_USER="${KIOSK_USER:-$(whoami)}"
KIOSK_URL="${KIOSK_URL:-http://localhost:3000}"

# DISPLAY Setup
export DISPLAY=:0

# Kill any existing Firefox processes for the kiosk user
pkill -u "$KIOSK_USER" firefox

# Activate the firefox kiosk mode
firefox --kiosk "$KIOSK_URL"