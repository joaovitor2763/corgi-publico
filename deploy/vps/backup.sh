#!/usr/bin/env bash
# Nightly: stop the API a few seconds for a consistent copy of .openmuse (+ .env, without browser
# profiles), restart, keep the last 14. Archives are root-readable only.
source "$(dirname "$0")/lib.sh"
cd "$REPO"
DATA="$(env_get DATA_DIR)"; DATA="${DATA:-.openmuse}"
mkdir -p "$BACKUPS" && chmod 700 "$BACKUPS"
FILE="$BACKUPS/corgi-$(date +%Y-%m-%d-%H%M).tgz"
systemctl stop corgi-server
trap 'systemctl start corgi-server' EXIT
tar --exclude "browser-profiles" -czf "$FILE" "$DATA" .env
chmod 600 "$FILE"
ls -1t "$BACKUPS"/corgi-*.tgz | tail -n +15 | xargs -r rm -f
echo "$(date '+%F %T') backup: $FILE ($(du -h "$FILE" | cut -f1))"
