#!/usr/bin/env bash
#
# Damia Pulse — ONE-TIME server setup, run from the Mac (no manual SSH).
# Does everything over the 'prod' SSH alias with YubiKey taps:
#   1. checks DNS for pulse.damiatracker.com
#   2. creates /var/www/damia-pulse and ships the code (via deploy.sh)
#   3. builds prod's .env: local .env minus the dev email blocker, plus
#      RESEND_API_KEY + PULSE_SYNC_KEY copied/created from admin's server .env
#   4. installs + starts the systemd service (port 4010)
#   5. installs the nginx site + HTTPS cert
#
# Safe to re-run: it won't overwrite an existing prod .env.
#
#   cd ~/damia/staff-app && ./deploy/setup-server.sh
#

set -euo pipefail

SERVER_PATH="/var/www/damia-pulse"
ADMIN_ENV="/var/www/damia-admin/.env"
SSH_TARGET="prod"
SSH_CMD="/opt/homebrew/bin/ssh"
DOMAIN="pulse.damiatracker.com"
DROPLET_IP="157.245.132.41"

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "${SCRIPT_DIR}/.." && pwd )"
cd "${PROJECT_ROOT}"

say()  { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

# ── 0. Pre-flight ─────────────────────────────────────────────────
say "Pre-flight"
[ -x "${SSH_CMD}" ] || die "Homebrew ssh not at ${SSH_CMD} (brew install openssh)"
[ -f .env ] || die "No local .env in ${PROJECT_ROOT} — prod .env is built from it"
RESOLVED="$(dig +short "${DOMAIN}" 2>/dev/null | tail -1 || true)"
if [ "${RESOLVED}" != "${DROPLET_IP}" ]; then
  die "DNS not ready: ${DOMAIN} resolves to '${RESOLVED:-nothing}', expected ${DROPLET_IP}. Add the A record in GoDaddy and wait a few minutes."
fi
ok "DNS: ${DOMAIN} → ${DROPLET_IP}"
warn "YubiKey taps coming up — tap the key when it blinks"

# ── 1. Create the directory + ship the code ───────────────────────
say "Creating ${SERVER_PATH} on the droplet"
"${SSH_CMD}" "${SSH_TARGET}" "mkdir -p ${SERVER_PATH}"
ok "Directory ready"

say "Shipping code (deploy.sh --no-restart)"
"${SCRIPT_DIR}/deploy.sh" --no-restart

# ── 2. Prod .env ──────────────────────────────────────────────────
say "Building prod .env"
if "${SSH_CMD}" "${SSH_TARGET}" "test -f ${SERVER_PATH}/.env"; then
  warn "Prod .env already exists — leaving it untouched"
else
  TMP_ENV="$(mktemp)"
  # Everything from the local .env EXCEPT the dev kill-switch. On prod that
  # line would silently block every invite and reset email.
  grep -v '^OUTBOUND_EMAIL' .env > "${TMP_ENV}"

  # Same Resend key as the admin app (one company, one sender address).
  # The key itself never leaves the droplet — copied server-side below.
  if ! grep -q '^RESEND_API_KEY=' "${TMP_ENV}"; then
    echo "# RESEND_API_KEY appended server-side from ${ADMIN_ENV}" >> "${TMP_ENV}"
  fi

  # KPI bridge: Pulse ↔ admin on the same box.
  grep -q '^ADMIN_SYNC_URL=' "${TMP_ENV}" || echo "ADMIN_SYNC_URL=http://127.0.0.1:4011" >> "${TMP_ENV}"

  rsync -az -e "${SSH_CMD}" "${TMP_ENV}" "${SSH_TARGET}:${SERVER_PATH}/.env"
  rm -f "${TMP_ENV}"

  # Server-side: copy the Resend key from admin's .env; create the shared
  # PULSE_SYNC_KEY in BOTH .envs if admin doesn't have one yet.
  "${SSH_CMD}" "${SSH_TARGET}" "
    set -e
    grep '^RESEND_API_KEY=' ${ADMIN_ENV} >> ${SERVER_PATH}/.env || echo 'WARN: no RESEND_API_KEY in admin .env — emails will not send until added'
    if ! grep -q '^PULSE_SYNC_KEY=' ${ADMIN_ENV}; then
      echo \"PULSE_SYNC_KEY=\$(openssl rand -hex 24)\" >> ${ADMIN_ENV}
      systemctl restart damia-admin
      echo 'Added PULSE_SYNC_KEY to admin .env and restarted damia-admin'
    fi
    grep '^PULSE_SYNC_KEY=' ${ADMIN_ENV} >> ${SERVER_PATH}/.env
    sed -i '/^OUTBOUND_EMAIL/d' ${SERVER_PATH}/.env
  "
  ok "Prod .env in place (Resend key + sync key wired to admin's)"
fi

# ── 3. Permissions ────────────────────────────────────────────────
# The service runs as www-data and writes data/*.json.
say "Setting ownership"
"${SSH_CMD}" "${SSH_TARGET}" "chown -R www-data:www-data ${SERVER_PATH}"
ok "www-data owns ${SERVER_PATH}"

# ── 4. systemd service ────────────────────────────────────────────
say "Installing damia-pulse service (port 4010)"
rsync -az -e "${SSH_CMD}" deploy/damia-pulse.service "${SSH_TARGET}:/etc/systemd/system/damia-pulse.service"
"${SSH_CMD}" "${SSH_TARGET}" "systemctl daemon-reload && systemctl enable --now damia-pulse"
sleep 1
"${SSH_CMD}" "${SSH_TARGET}" "systemctl is-active damia-pulse" \
  | grep -q "^active$" || die "Service didn't start — check 'journalctl -u damia-pulse -n 50' via ssh prod"
ok "damia-pulse running"

# ── 5. nginx + HTTPS ──────────────────────────────────────────────
say "Installing nginx site + certificate"
rsync -az -e "${SSH_CMD}" deploy/nginx-pulse.damiatracker.com.conf "${SSH_TARGET}:/etc/nginx/sites-available/${DOMAIN}"
"${SSH_CMD}" "${SSH_TARGET}" "ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN} && nginx -t && systemctl reload nginx"
"${SSH_CMD}" "${SSH_TARGET}" "certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --redirect"
ok "HTTPS live"

printf "\n\033[1;32m═══════════════════════════════════════════\033[0m\n"
printf "\033[1;32m✓ Pulse is live.\033[0m  https://%s\n" "${DOMAIN}"
printf "\033[1;32m═══════════════════════════════════════════\033[0m\n\n"
echo "Future deploys: ./deploy/deploy.sh"
