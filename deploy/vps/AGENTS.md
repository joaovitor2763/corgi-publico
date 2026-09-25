# deploy/vps — Corgi on an Ubuntu 24.04 VPS (root scripts, systemd)

Same shape as `deploy/macmini` with systemd: `setup.sh` (deps + Chromium, `.env` completion,
build, units `corgi-server`, `corgi-worker`, `corgi-backup.timer`, ufw: SSH + tailscale0 only,
`tailscale serve --bg 8787`), `update.sh`, `backup.sh`, `status.sh`. Services run as user `corgi`
from `/home/corgi/corgi`; the repo is pulled with a read-only deploy key.
Never open 8787/8790 publicly or use `tailscale funnel`.
