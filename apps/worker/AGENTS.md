# apps/worker — browser worker

Standalone Playwright service (own `package.json` / lockfile, Dockerfile copies `src/`). The API is the
only client; every route but `/health` requires `WORKER_TOKEN`. See `README.md` for the HTTP API.

- `src/server.ts` — HTTP routes; `src/index.ts` — entry.
- `src/browser/` — session lifecycle, persistent Chromium profiles, network policy, proxy, downloads.
- `src/navigator/` — the agent in the browser:
  - `jev.ts` one DOM action per step via Jev; statuses `done`, `needs_login`, `ready_to_checkout`, `stuck`...
  - `items.ts` product cards from the DOM; `login.ts` private credential hand-off (agent never types
    passwords); `checkout.ts` re-verifies the order page before clicking the purchase button.

Typecheck separately: `cd apps/worker && npx tsc --noEmit`. Browser tests: `pnpm test:browser`.
