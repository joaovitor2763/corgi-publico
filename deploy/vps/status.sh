#!/usr/bin/env bash
# Services, health, Tailscale URL, last backups and log lines.
source "$(dirname "$0")/lib.sh"
for s in "${SERVICES[@]}" corgi-backup.timer; do printf '%-18s %s\n' "$s" "$(systemctl is-active "$s")"; done
printf 'health             '; curl -sf http://127.0.0.1:8787/api/health || echo "sem resposta"; echo
tailscale serve status 2>/dev/null | head -2
echo; echo "Últimos backups:"; ls -1t "$BACKUPS"/corgi-*.tgz 2>/dev/null | head -3 || echo "  nenhum"
for s in "${SERVICES[@]}"; do echo; echo "── $s"; journalctl -u "$s" -n 5 --no-pager -o cat; done
echo; echo "── erros recentes (2 h)"
journalctl -u corgi-server --since "-2h" --no-pager -o cat | grep -E '"?(phase|context)"?|Error' | tail -n 20 || true
