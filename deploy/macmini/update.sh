#!/usr/bin/env bash
# Pull the latest Corgi, rebuild and restart the services. Your data and .env are untouched.
source "$(dirname "$0")/lib.sh"
cd "$REPO"
say "Atualizando"
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build:server
pnpm build:web:served
for service in "${SERVICES[@]}"; do restart "$service"; done
sleep 3
curl -sf http://127.0.0.1:8787/api/health && echo || warn "Servidor não respondeu; veja $LOGS/server.log"
