#!/usr/bin/env sh
set -e

if [ -n "${DATABASE_URL:-}" ]; then
  npx prisma migrate deploy >/dev/null 2>&1 || npx prisma migrate deploy
fi

exec "$@"
