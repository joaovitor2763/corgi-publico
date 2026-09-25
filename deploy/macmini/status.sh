#!/usr/bin/env bash
# Is Corgi up? Services, health, Tailscale URL and the last log lines.
source "$(dirname "$0")/lib.sh"
for service in "${SERVICES[@]}" backup; do
  state="$(launchctl print "gui/$(id -u)/$(label "$service")" 2>/dev/null | awk '/state =/{print $3; exit}')"
  printf '%-8s %s\n' "$service" "${state:-não instalado}"
done
printf 'health   '; curl -sf http://127.0.0.1:8787/api/health || echo "sem resposta"; echo
TS="$(tailscale_cli || true)"; [ -n "$TS" ] && "$TS" serve status 2>/dev/null | head -3
echo; echo "Últimos backups:"; ls -1t "$BACKUPS"/corgi-*.tgz 2>/dev/null | head -3 || echo "  nenhum"
for service in "${SERVICES[@]}"; do echo; echo "── $service.log"; tail -n 5 "$LOGS/$service.log" 2>/dev/null; done
