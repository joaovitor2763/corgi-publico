# Apify: ready-made scrapers

Some jobs are slow or blocked in the assistant's browser: fifty places from Google Maps, public
Instagram or LinkedIn profiles, marketplace listings, reviews. [Apify](https://apify.com) has
ready-made scrapers ("actors") for these. The person connects their own account with an API token;
the server never ships one.

## Connecting

Ajustes › Apps: Apify is listed like any other app (its official logo, under Dados and in search; with the connected apps once on). Tap it and paste the token (Apify › Settings › API & Integrations) and pick the spend cap
per run (US$ 0,25 to 5; default 0,50). The server checks the token with `GET /v2/users/me` before
keeping it, encrypted with `TOKEN_ENCRYPTION_KEY` (or, when the server has none, a key it makes once
and keeps in the database, like the push keys). Disconnecting deletes it.

Routes (`apps/server/src/apify/routes.ts`): `GET /api/apify`, `POST /api/apify/connect`,
`PUT /api/apify/limit`, `POST /api/apify/disconnect`.

## What the assistant gets

Only after Apify is connected (never mentioned otherwise), three tools join the chat and background
tasks (`apify/tools.ts`, added per run through `PiOptions.moreTools`):

| Tool | Apify API | Notes |
| --- | --- | --- |
| `apify_search` | `GET /v2/store?search=` | Top 8 by popularity: `usuario/nome`, users, rating, price model. |
| `apify_input` | `GET /v2/acts/:id/builds/default` | The input schema cut to fields, types, required, defaults, examples. |
| `apify_run` | `POST /v2/acts/:id/run-sync-get-dataset-items` | Waits up to 240 s; `maxTotalChargeUsd` = the person's cap, `maxItems` ≤ 200. |

The token travels in the `Authorization` header, never in a URL. Actor names are validated before
they reach a path. Results are compacted to ~30k characters (with a `truncated` note) and go
through `TrustGuard.review` like any web content: data, never instructions. Out of credit (402) and
timeouts (408) come back as plain errors the model can explain.

## Cost

Each run is capped by Apify itself at the chosen dollar limit, so a run can't cost more than that.
There is no monthly total in the app yet; Apify's console shows usage and can set a monthly limit
on the account.
