#!/usr/bin/env bash
# One-time setup of Corgi on a Mac mini: dependencies, .env, build, background services,
# Tailscale HTTPS and nightly backups. Safe to run again; it never overwrites your .env values.
source "$(dirname "$0")/lib.sh"
cd "$REPO"

say "1/7 Ferramentas"
command -v brew >/dev/null || { warn "Instale o Homebrew: https://brew.sh e rode de novo."; exit 1; }
command -v node >/dev/null || brew install node
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' ||
  { warn "Node $(node -v) é antigo; rode: brew upgrade node"; exit 1; }
command -v pnpm >/dev/null || { corepack enable && corepack prepare pnpm@11.19.0 --activate; }

say "2/7 Dependências"
pnpm install --frozen-lockfile
pnpm --dir apps/worker exec playwright install chromium

say "3/7 Configuração (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  warn "Criei .env a partir do exemplo. Copie para ele suas chaves (IMPOSSIBL_API_KEY, COMPOSIO_API_KEY...) do outro Mac."
fi
TS="$(tailscale_cli || true)"
HOSTNAME_TS=""
if [ -n "$TS" ]; then
  HOSTNAME_TS="$("$TS" status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,""))}catch{}})')"
fi
[ -n "$(env_get OPENMUSE_ACCESS_KEY)" ] || { env_set OPENMUSE_ACCESS_KEY "$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-40)"; NEW_KEY=1; }
[ -n "$(env_get WORKER_TOKEN)" ] || env_set WORKER_TOKEN "$(openssl rand -hex 32)"
env_set HOST 127.0.0.1
env_set PORT 8787
env_set BROWSER_WORKER_URL http://127.0.0.1:8790
env_set TASK_WORKER_ENABLED true
if [ -n "$HOSTNAME_TS" ]; then
  env_set PUBLIC_API_URL "https://$HOSTNAME_TS"
  env_set ALLOWED_ORIGINS "https://$HOSTNAME_TS,http://localhost:8081"
else
  warn "Tailscale não encontrado ou desconectado: instale (https://tailscale.com/download/mac), faça login e rode este script de novo."
fi

say "4/7 Build (servidor + app web servido pelo próprio Corgi)"
pnpm build:server
pnpm build:web:served

say "5/7 Serviços em segundo plano (launchd)"
mkdir -p "$AGENTS" "$LOGS"
NODE="$(command -v node)"
PATH_ENV="$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
write_agent() { # name, then program arguments
  local name="$1"; shift
  local file="$AGENTS/$(label "$name").plist"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo "<key>Label</key><string>$(label "$name")</string>"
    echo '<key>ProgramArguments</key><array>'
    for arg in "$@"; do echo "<string>$arg</string>"; done
    echo '</array>'
    echo "<key>WorkingDirectory</key><string>$REPO</string>"
    echo "<key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH_ENV</string><key>NODE_ENV</key><string>production</string></dict>"
    echo '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>'
    echo "<key>StandardOutPath</key><string>$LOGS/$name.log</string>"
    echo "<key>StandardErrorPath</key><string>$LOGS/$name.log</string>"
    echo '</dict></plist>'
  } >"$file"
  launchctl bootout "gui/$(id -u)" "$file" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$file"
}
write_agent server "$NODE" dist/apps/server/src/index.js
write_agent worker "$NODE" --env-file=.env --import tsx apps/worker/src/index.ts
# Nightly backup at 03:30 (not KeepAlive: runs and exits).
BACKUP_PLIST="$AGENTS/$(label backup).plist"
cat >"$BACKUP_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$(label backup)</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$REPO/deploy/macmini/backup.sh</string></array>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
<key>StandardOutPath</key><string>$LOGS/backup.log</string>
<key>StandardErrorPath</key><string>$LOGS/backup.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)" "$BACKUP_PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$BACKUP_PLIST"

say "6/7 Mac sempre ligado"
echo "Vou pedir sua senha do Mac para: nunca dormir e religar sozinho após queda de energia."
sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1 || warn "Não ajustei o repouso; faça em Ajustes → Energia."

say "7/7 HTTPS privado com Tailscale"
if [ -n "$TS" ] && [ -n "$HOSTNAME_TS" ]; then
  "$TS" serve --bg 8787 || warn "Ative HTTPS em https://login.tailscale.com/admin/dns (HTTPS Certificates) e rode de novo."
  URL="https://$HOSTNAME_TS"
else
  URL="(configure o Tailscale e rode de novo)"
fi

sleep 3
say "Pronto"
curl -sf http://127.0.0.1:8787/api/health >/dev/null && echo "Servidor: OK" || warn "Servidor não respondeu; veja $LOGS/server.log"
echo "Abra no iPhone (com Tailscale ligado): $URL"
if [ "${NEW_KEY:-}" = 1 ]; then
  echo "Chave de acesso gerada (guarde no seu gerenciador de senhas):"
  echo "  $(env_get OPENMUSE_ACCESS_KEY)"
else
  echo "Chave de acesso: a OPENMUSE_ACCESS_KEY que já está no .env"
fi
echo "App nativo: rode no Mac com Xcode →  deploy/macmini/ios.sh $URL"
