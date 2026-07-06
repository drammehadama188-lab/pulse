#!/usr/bin/env bash
#
# Damia Pulse — one-command deploy, same pattern as the admin app:
# build locally on the Mac, ship to the droplet over the 'prod' SSH alias
# (YubiKey), restart the service. Adama never SSHes in by hand.
#
# Usage (from the repo root on the Mac):
#   ./deploy/deploy.sh                  # full deploy (build + ship + restart)
#   ./deploy/deploy.sh --skip-build     # ship the existing dist/ as-is
#   ./deploy/deploy.sh --no-restart     # ship only (used by setup-server.sh)
#
# First-time setup: ./deploy/setup-server.sh (see deploy/SETUP.md)
#

set -euo pipefail

# ── Config (mirrors admin's deploy.sh) ────────────────────────────
# YubiKey lockdown: Apple's bundled ssh can't speak FIDO2 — everything goes
# through Homebrew ssh + the 'prod' alias in ~/.ssh/config.
SERVER_PATH="/var/www/damia-pulse"
SSH_TARGET="prod"
SSH_CMD="/opt/homebrew/bin/ssh"
URL="https://pulse.damiatracker.com"

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "${SCRIPT_DIR}/.." && pwd )"
cd "${PROJECT_ROOT}"

say()  { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

SKIP_BUILD=0
NO_RESTART=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --no-restart) NO_RESTART=1 ;;
    -h|--help)    sed -n '2,13p' "$0"; exit 0 ;;
    *) die "Unknown arg: $arg" ;;
  esac
done

say "Pre-flight checks"
command -v rsync >/dev/null || die "rsync not installed (brew install rsync)"
[ -x "${SSH_CMD}" ] || die "Homebrew ssh not at ${SSH_CMD} (brew install openssh)"
warn "YubiKey taps coming up — tap the key when it blinks"

# ── 1. Build the frontend ─────────────────────────────────────────
if [ "${SKIP_BUILD}" -eq 0 ]; then
  say "Building (npm run build)"
  npm run build
  ok "Built — dist/ is $(du -sh dist | cut -f1)"
else
  warn "Skipping build (--skip-build)"
fi

# ── 2. Ship dist/ (the built SPA) ─────────────────────────────────
say "Shipping dist/ → ${SERVER_PATH}/dist/"
rsync -az --delete -e "${SSH_CMD}" \
  dist/ "${SSH_TARGET}:${SERVER_PATH}/dist/"
ok "Static site uploaded"

# ── 3. Ship the backend ───────────────────────────────────────────
# server.js imports lib/ (zoho-books, email) and src/data/ (roster seeds) at
# startup — miss either and the service crashes with ERR_MODULE_NOT_FOUND.
# NEVER ship data/ (server-owned live state) or .env (secrets; setup-server.sh
# creates prod's own copy once).
say "Shipping backend (server.js, package files, lib/, src/data/)"
rsync -az -e "${SSH_CMD}" \
  server.js package.json package-lock.json \
  "${SSH_TARGET}:${SERVER_PATH}/"
rsync -az -e "${SSH_CMD}" \
  lib/ "${SSH_TARGET}:${SERVER_PATH}/lib/"
rsync -az --relative -e "${SSH_CMD}" \
  src/data/ "${SSH_TARGET}:${SERVER_PATH}/"
ok "Backend files uploaded"

# ── 4. Install production deps on the server ──────────────────────
say "Installing production deps on server (npm ci)"
"${SSH_CMD}" "${SSH_TARGET}" "cd ${SERVER_PATH} && npm ci --omit=dev --silent"
ok "Backend deps in sync"

# ── 5. Restart ────────────────────────────────────────────────────
if [ "${NO_RESTART}" -eq 1 ]; then
  warn "Skipping restart (--no-restart)"
else
  say "Restarting damia-pulse systemd service"
  "${SSH_CMD}" "${SSH_TARGET}" "systemctl restart damia-pulse"
  sleep 1
  "${SSH_CMD}" "${SSH_TARGET}" "systemctl is-active damia-pulse" \
    | grep -q "^active$" || die "Service didn't come back up — check 'journalctl -u damia-pulse -n 50' via ssh prod"
  ok "Backend running"
  printf "\n\033[1;32m✓ Deployed.\033[0m  %s\n\n" "${URL}"
fi
