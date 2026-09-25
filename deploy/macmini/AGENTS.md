# deploy/macmini — run Corgi 24/7 on a Mac mini

Bash scripts sharing `lib.sh`. Guide for humans: `docs/DEPLOY.md`.

- `setup.sh` — idempotent: deps + Chromium, fills `.env` without overwriting (access key, worker
  token, loopback host, Tailscale URL), builds server + same-origin web app, installs launchd agents
  `com.corgi.{server,worker,backup}`, `pmset` no-sleep, `tailscale serve --bg 8787`.
- `update.sh` (pull, build, restart), `backup.sh` (stops server briefly, tars `.openmuse` + `.env`
  without browser profiles, keeps 14), `status.sh`, `ios.sh <https-url>` (native Release build to a device).

Rules: never expose with `tailscale funnel` or a public port; keep `HOST=127.0.0.1`; the iOS app needs
HTTPS. Do not run `setup.sh` on a development machine: it installs background services.
