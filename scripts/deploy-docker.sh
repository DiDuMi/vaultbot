#!/usr/bin/env sh
set -e

APP_DIR="${1:-/root/vaultbot}"

cd "$APP_DIR"

if command -v node >/dev/null 2>&1 && [ -d "node_modules/@prisma/client" ]; then
  if [ -f "scripts/preflight-project.js" ]; then
    node scripts/preflight-project.js
  elif [ -f "scripts/preflight-tenant.js" ]; then
    node scripts/preflight-tenant.js
  fi
fi

docker compose up -d --build
docker compose ps
