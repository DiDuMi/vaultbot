#!/usr/bin/env sh
set -e

APP_DIR="${1:-/root/vaultbot}"

cd "$APP_DIR"

docker compose up -d --build
docker compose ps
