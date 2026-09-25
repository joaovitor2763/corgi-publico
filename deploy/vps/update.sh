#!/usr/bin/env bash
# Pull, rebuild and restart. Data and .env untouched.
source "$(dirname "$0")/lib.sh"
say "Atualizando"
as_corgi "git pull --ff-only && pnpm install --frozen-lockfile && pnpm build:server && pnpm build:web:served"
# run_python sandbox image (cached layers make this a no-op when apps/python is unchanged).
docker build -q -t corgi-python:local "$REPO/apps/python" >/dev/null || warn "Imagem do Python falhou: docker build apps/python"
systemctl restart "${SERVICES[@]}"
# Startup takes 3–10 s (migrations, profile restore): wait up to 30 s before warning.
for _ in $(seq 30); do curl -sf http://127.0.0.1:8787/api/health >/dev/null && break; sleep 1; done
curl -sf http://127.0.0.1:8787/api/health && echo || warn "Servidor não respondeu: journalctl -u corgi-server -n 50"
