#!/usr/bin/env bash
# Run a VPS script from your machine over SSH:  deploy/vps/remote.sh update | status | backup
# CORGI_SSH: the SSH host or alias of your server (default "corgi-vps", see docs/DEPLOY.md).
# CORGI_DIR: where the code lives on it (default /home/corgi/corgi).
set -euo pipefail
case "${1:-}" in update | status | backup) ;; *) echo "uso: $0 update|status|backup"; exit 1 ;; esac
ssh "${CORGI_SSH:-corgi-vps}" "bash ${CORGI_DIR:-/home/corgi/corgi}/deploy/vps/$1.sh"
