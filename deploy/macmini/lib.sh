# Shared by the Mac mini scripts. Sourced, not run.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/Corgi"
BACKUPS="${CORGI_BACKUP_DIR:-$HOME/CorgiBackups}"
SERVICES=(server worker)
label() { echo "com.corgi.$1"; }
say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
# Tailscale CLI: standalone install, Homebrew, or the one inside the Mac App Store app.
tailscale_cli() {
  if command -v tailscale >/dev/null; then command -v tailscale
  elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
    echo /Applications/Tailscale.app/Contents/MacOS/Tailscale
  fi
}
env_get() { grep -E "^$1=" "$REPO/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
env_set() { # sets or replaces KEY=value in .env
  if grep -qE "^$1=" "$REPO/.env"; then
    sed -i '' -E "s|^$1=.*|$1=$2|" "$REPO/.env"
  else
    printf '%s=%s\n' "$1" "$2" >>"$REPO/.env"
  fi
}
restart() { launchctl kickstart -k "gui/$(id -u)/$(label "$1")"; }
