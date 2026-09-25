# apps/server — API and agent engine

Entry points: `src/index.ts` (API), `src/worker-entry.ts` (standalone task worker).
`src/app.ts` is the composition root: it builds every service and mounts the HTTP routes. Keep
business rules out of it; routes parse input, call a domain service, return JSON.

## Domains (`src/`)

| Folder | Responsibility |
| --- | --- |
| `platform/` | Shared kernel: config, `Store` (PGlite/Postgres records), auth, files, errors, log. No domain imports. |
| `agent/` | Chat + task engine: `ConversationAgent` (AG-UI), Pi/Impossibl provider, model task runner, durable `TaskWorker`, prompts, step labels, `AgentService`. |
| `approvals/` | `ActionService`: propose → versioned hash → approve/deny → execute once. |
| `commerce/` | Checkout spending policy and page price parsing. Pure functions. |
| `connected-apps/` | Composio: accounts, per-app permission (`ask`/`read`/`off`), tool wrapping, always-allow rules. |
| `browser/` | Server side of the browser worker (sessions, checkout review/confirm, console). |
| `computer/` | Optional Docker Linux workspace (argv-only, no host shell). |
| `workspace/` | Google mail/calendar (sample or live) and Google OAuth. |
| `memory/` | Memory v2 (docs/MEMORY.md): `book.ts` owns every change (evidence, lineage, forget = retract + 30-day restore), Jev gate, chat tools, hourly review of the person's chats, nightly reflection (validated merge/supersede/retire, alignment, people), `/api/agent/memory` routes. |
| `ideas/` | Smart ideas pipeline: gather signals → model drafts → Jev filters. |
| `routines/` | Wall-clock schedules (São Paulo by default): weekly, biweekly, monthly (day or Nth weekday), quarterly; DST-safe `nextRun`, `normalizeSchedule`. `auto-approve.ts`: a routine's run may approve always-allowable app actions itself (never sends, deletes, payments). |
| `finance/` | CSV spending analysis. |
| `push/` | Web Push to the home-screen app: VAPID keys, devices, choices; `pushFor` maps new notifications (docs/NOTIFICATIONS.md). |
| `fuzzies/` | Helpers ("ajudantes", docs/HELPERS.md): records, schedule and daily budget, runs as tasks in the helper's own chat, fewer tools and only its apps, `ask_fuzzy` / `create_fuzzy` for Corgi, `learn_fact` / `report_finding` for the helper. |
| `apify/` | Apify scrapers with the person's API token (encrypted): store search, input schema, capped runs; tools only when connected (docs/APIFY.md). |
| `trust/` | Jev client + `TrustGuard`: flags phishing/injection in what the agent reads and changes that follow content instead of the owner. |

## Conventions

- New capability = new domain folder (or file in an existing one) + wiring in `app.ts` / `agent/service.ts`.
  Do not grow `agent/service.ts` (already ~1.3k lines); move logic into the owning domain.
- Persist through `Store` records (`db.put(owner, kind, doc)`); every record is owner-scoped.
- Throw `AppError(message, status)` for user-facing failures; never leak provider payloads (`platform/log.ts`).
- Anything that writes outside the app goes through `approvals/`.
