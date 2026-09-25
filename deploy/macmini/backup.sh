#!/usr/bin/env bash
# Nightly: stops the server for a few seconds so the database is copied consistently, archives
# .openmuse (without browser profiles: big, and only sign-ins), restarts, keeps the last 14.
source "$(dirname "$0")/lib.sh"
cd "$REPO"
DATA="$(env_get DATA_DIR)"; DATA="${DATA:-.openmuse}"
mkdir -p "$BACKUPS"
FILE="$BACKUPS/corgi-$(date +%Y-%m-%d-%H%M).tgz"
PLIST="$AGENTS/$(label server).plist"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
trap 'launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || true' EXIT
tar --exclude "browser-profiles" -czf "$FILE" "$DATA" .env
chmod 600 "$FILE"
ls -1t "$BACKUPS"/corgi-*.tgz | tail -n +15 | xargs rm -f 2>/dev/null || true
echo "$(date '+%F %T') backup: $FILE ($(du -h "$FILE" | cut -f1))"
