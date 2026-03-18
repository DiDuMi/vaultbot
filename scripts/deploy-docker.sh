#!/usr/bin/env sh
set -e

APP_DIR="${1:-/root/vaultbot}"

cd "$APP_DIR"

if command -v node >/dev/null 2>&1 && [ -f "scripts/preflight-tenant.js" ] && [ -d "node_modules/@prisma/client" ]; then
  node scripts/preflight-tenant.js
fi

docker compose up -d --build
docker compose ps
