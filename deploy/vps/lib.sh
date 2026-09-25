# Shared by the VPS scripts (run as root on Ubuntu 24.04). Sourced, not run.
set -euo pipefail
RUN_AS="${CORGI_USER:-corgi}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUPS="${CORGI_BACKUP_DIR:-/home/$RUN_AS/backups}"
SERVICES=(corgi-server corgi-worker)
say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { warn "Rode como root (sudo)."; exit 1; }
as_corgi() { su - "$RUN_AS" -c "cd '$REPO' && $*"; }
env_get() { grep -E "^$1=" "$REPO/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
env_set() {
  if grep -qE "^$1=" "$REPO/.env"; then sed -i -E "s|^$1=.*|$1=$2|" "$REPO/.env"
  else printf '%s=%s\n' "$1" "$2" >>"$REPO/.env"; fi
}
ts_host() { tailscale status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,""))}catch{}})'; }
