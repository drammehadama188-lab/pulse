#!/usr/bin/env bash
# Deploy Damia Pulse on the droplet. Run ON THE SERVER from the repo directory:
#   ./deploy/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Pulling latest…"
git pull --ff-only

echo "→ Installing dependencies…"
npm ci

echo "→ Building frontend…"
npm run build

echo "→ Restarting service…"
sudo systemctl restart damia-pulse

echo "✓ Deployed. https://pulse.damiatracker.com"
