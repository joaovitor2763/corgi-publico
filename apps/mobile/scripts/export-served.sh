#!/usr/bin/env bash
# Builds the web app the server serves, next to the live one, then swaps it in at once: a page
# opened mid-deploy never finds a half-written folder. Bundles of recent deploys stay (7 days),
# so a page the browser kept from before still loads its own code.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist/web-next
EXPO_NO_DOTENV=1 npx expo export --platform web --output-dir dist/web-next --clear
if [ -d dist/web/_expo ]; then
  # -n skips files already there (and may report that as an error on some systems): best effort.
  cp -Rnp dist/web/_expo/. dist/web-next/_expo/ || true
  find dist/web-next/_expo -type f -mtime +7 -delete
fi
rm -rf dist/web-prev
[ -d dist/web ] && mv dist/web dist/web-prev
mv dist/web-next dist/web
rm -rf dist/web-prev
