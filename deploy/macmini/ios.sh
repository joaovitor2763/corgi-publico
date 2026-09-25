#!/usr/bin/env bash
# Builds the native Corgi app (Release: code embedded, no Metro needed) and installs it on a
# connected iPhone (cable or same Wi-Fi, Developer Mode on).
#
#   APPLE_TEAM_ID=<your-team-id> [APP_BUNDLE_ID=com.you.corgi] deploy/macmini/ios.sh [https://your-server.ts.net]
#
# APPLE_TEAM_ID picks the signing team (a paid team: the app lasts a year; a Personal Team: 7 days).
# The server URL is only the pre-filled default: it can be changed on the app's sign-in screen.
source "$(dirname "$0")/lib.sh"
URL="${1:-}"
if [ -n "$URL" ]; then
  case "$URL" in https://*) ;; *) warn "O iOS exige HTTPS (use a URL do tailscale serve)"; exit 1 ;; esac
fi
[ -n "${APPLE_TEAM_ID:-}" ] || { warn "Defina APPLE_TEAM_ID (veja em Xcode → Settings → Accounts)."; exit 1; }
command -v xcodebuild >/dev/null || { warn "Instale o Xcode pela App Store."; exit 1; }
cd "$REPO/apps/mobile"
say "Gerando o projeto iOS assinado pelo time $APPLE_TEAM_ID"
EXPO_PUBLIC_API_URL="$URL" npx expo prebuild --platform ios --clean
say "Compilando e instalando no iPhone conectado"
echo "Se o iPhone não aparecer: desbloqueie, confie neste Mac e ligue o Modo de Desenvolvedor."
EXPO_PUBLIC_API_URL="$URL" npx expo run:ios --device --configuration Release
