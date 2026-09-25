#!/usr/bin/env bash
# One-time (and re-runnable) setup of Corgi on an Ubuntu 24.04 VPS, as root:
# deps + Chromium, .env completion (never overwrites), build, systemd services, nightly backup,
# firewall (only SSH and Tailscale in), and `tailscale serve` for private HTTPS.
# Expects: the repo cloned at /home/corgi/corgi (owned by corgi), .env copied in, Tailscale logged in.
source "$(dirname "$0")/lib.sh"
cd "$REPO"

say "1/6 Dependências e Chromium"
as_corgi "pnpm install --frozen-lockfile"
PW="$REPO/apps/worker/node_modules/.bin/playwright"
"$PW" install-deps chromium >/dev/null
as_corgi "apps/worker/node_modules/.bin/playwright install chromium"

say "2/6 Configuração (.env)"
[ -f .env ] || { warn "Copie o .env para $REPO/.env e rode de novo."; exit 1; }
chown "$RUN_AS:$RUN_AS" .env && chmod 600 .env
HOST_TS="$(ts_host)"
[ -n "$HOST_TS" ] || { warn "Tailscale não está logado: rode 'tailscale up' e aprove o link."; exit 1; }
[ -n "$(env_get OPENMUSE_ACCESS_KEY)" ] || { env_set OPENMUSE_ACCESS_KEY "$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-40)"; NEW_KEY=1; }
[ -n "$(env_get WORKER_TOKEN)" ] || env_set WORKER_TOKEN "$(openssl rand -hex 32)"
env_set HOST 127.0.0.1
env_set PORT 8787
env_set BROWSER_WORKER_URL http://127.0.0.1:8790
env_set TASK_WORKER_ENABLED true
env_set PUBLIC_API_URL "https://$HOST_TS"
env_set ALLOWED_ORIGINS "https://$HOST_TS"

say "3/6 Build"
as_corgi "pnpm build:server && pnpm build:web:served"

say "4/6 Serviços systemd"
NODE="$(command -v node)"
unit() { # name, description, command
  cat >"/etc/systemd/system/$1.service" <<UNIT
[Unit]
Description=$2
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=$RUN_AS
WorkingDirectory=$REPO
Environment=NODE_ENV=production
ExecStart=$3
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
}
unit corgi-server "Corgi API and web app" "$NODE dist/apps/server/src/index.js"
unit corgi-worker "Corgi browser worker" "$NODE --env-file=.env --import tsx apps/worker/src/index.ts"
cat >/etc/systemd/system/corgi-backup.service <<UNIT
[Unit]
Description=Corgi nightly backup
[Service]
Type=oneshot
ExecStart=/bin/bash $REPO/deploy/vps/backup.sh
UNIT
cat >/etc/systemd/system/corgi-backup.timer <<UNIT
[Unit]
Description=Corgi nightly backup at 03:30
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now corgi-server corgi-worker corgi-backup.timer >/dev/null
systemctl restart corgi-server corgi-worker

say "5/6 Firewall: só SSH e Tailscale entram"
ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow in on tailscale0 >/dev/null
ufw --force enable >/dev/null

say "6/6 HTTPS privado (tailscale serve)"
tailscale serve --bg 8787 >/dev/null

sleep 4
say "Pronto"
curl -sf http://127.0.0.1:8787/api/health >/dev/null && echo "Servidor: OK" || warn "Servidor não respondeu: journalctl -u corgi-server -n 50"
echo "URL (no app, campo Servidor): https://$HOST_TS"
[ "${NEW_KEY:-}" = 1 ] && echo "Chave de acesso gerada: $(env_get OPENMUSE_ACCESS_KEY)" || echo "Chave de acesso: OPENMUSE_ACCESS_KEY do .env"
