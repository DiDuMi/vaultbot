#!/usr/bin/env sh
set -eu

APP_DIR="${1:-/root/vaultbot}"
TARGET_REF="${2:-origin/main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3002/health/ready}"
KEEP_COMPOSE="${KEEP_COMPOSE:-1}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-vaultbot-postgres-1}"
POSTGRES_USER_VALUE="${POSTGRES_USER:-vaultbot}"
POSTGRES_DB_VALUE="${POSTGRES_DB:-vaultbot}"
WAIT_SECONDS="${WAIT_SECONDS:-30}"

timestamp() {
  date +"%Y%m%d_%H%M%S"
}

log() {
  printf '%s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required command: $1"
    exit 1
  fi
}

require_cmd git
require_cmd docker
require_cmd curl

cd "$APP_DIR"
mkdir -p "$BACKUP_DIR"

TS="$(timestamp)"
ENV_BACKUP="$BACKUP_DIR/.env.backup_$TS"
COMPOSE_BACKUP="$BACKUP_DIR/docker-compose.yml.backup_$TS"
DB_BACKUP="$BACKUP_DIR/backup_$TS.sql"

if [ -f ".env" ]; then
  cp ".env" "$ENV_BACKUP"
  chmod 600 "$ENV_BACKUP" 2>/dev/null || true
  log "Backed up .env -> $ENV_BACKUP"
fi

if [ -f "docker-compose.yml" ]; then
  cp "docker-compose.yml" "$COMPOSE_BACKUP"
  log "Backed up docker-compose.yml -> $COMPOSE_BACKUP"
fi

if docker ps --format '{{.Names}}' | grep -Fx "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
  docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER_VALUE" "$POSTGRES_DB_VALUE" > "$DB_BACKUP"
  log "Backed up database -> $DB_BACKUP"
else
  log "Skipped database backup: container $POSTGRES_CONTAINER is not running"
fi

if command -v node >/dev/null 2>&1 && [ -f "scripts/preflight-tenant.js" ] && [ -d "node_modules/@prisma/client" ]; then
  node scripts/preflight-tenant.js
fi

git fetch origin
git reset --hard "$TARGET_REF"
log "Checked out $TARGET_REF"

if [ "$KEEP_COMPOSE" = "1" ] && [ -f "$COMPOSE_BACKUP" ]; then
  cp "$COMPOSE_BACKUP" "docker-compose.yml"
  log "Restored production docker-compose.yml customization"
fi

if [ -f ".env" ]; then
  chmod 600 ".env" 2>/dev/null || true
fi

docker compose up -d --build
docker compose ps

i=0
while [ "$i" -lt "$WAIT_SECONDS" ]; do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    log "Health check passed: $HEALTH_URL"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

log "Health check failed after ${WAIT_SECONDS}s: $HEALTH_URL"
exit 1
