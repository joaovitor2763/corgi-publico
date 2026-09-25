# Models: how Corgi picks and how much it thinks

The person never has to know which model does what. **Automático** is the default; a fixed
model is an advanced choice (Menu › Modelo do assistente › Avançado).

## Automático (the default)

Automatic is **Muse Spark** (`meta/muse-spark-1.3-contributor`) today: the fastest per call and
the one that sees pictures. The pick is made per turn (`agent/conversation.ts` `resolveModel` →
`AgentService.modelId(owner, { vision })` → `pi-provider.ts` `autoModel`), so the policy can
change with new measurements without touching the rest. **GLM 5.3 Flash** stays available as a
fixed choice under Avançado. Side jobs (long-result digests, thread summaries, source filters)
use `SIDE_MODEL` in `agent/complete.ts`.

## How much it thinks

`reasoningFor(model, step, options)` in `agent/pi.ts`:

| Where | First model call of the turn (planning) | Following calls (tool steps, answer) |
| --- | --- | --- |
| Chat | Muse `medium` | Muse `low`: acts faster (~1.5 s less per step) |
| Background tasks (`chat-task.ts`) | Muse `medium` | `medium`: nobody is waiting |
| GLM (if fixed) | nothing sent: adaptive thinking | same |

## Why (measured on Impossibl, September 2026)

A chat turn that needs one tool (a multiplication with `calculate`: two model calls, ~11k-token
prompt), four runs each:

| Model | Per model call | Whole turn |
| --- | --- | --- |
| Muse Spark (medium, then low) | ~1.5–2.4 s (cache mostly missing) | **4–6 s** |
| GLM 5.3 Flash (adaptive; "low" on steps made no difference) | ~5–7 s (cache hitting) | 11–14 s |

First token for the same short question, no tools:

| | none | low | medium | adaptive (field omitted) |
| --- | --- | --- | --- | --- |
| Muse Spark | 4.0 s | 6.2 s | 7.7 s | 9.0 s |
| GLM 5.3 Flash | 3.2 s | 2.7 s | 3.5 s | 9.0 s (384 reasoning tokens) |

Prompt cache (Impossibl caches a repeated prefix implicitly; there is no cache-key or routing
field, see `https://impossibl.com/docs/prompt-caching.md`):

- **GLM (zai route):** hits reliably; misses are the first message after a few idle minutes.
- **Muse (meta route):** an identical 58k-token prefix every 5 s hit **1 in 7**, with or without
  `prompt_cache_key` / `cache_control`: provider side. At ~11k tokens a miss costs little (~2 s
  per call); on a ~160k conversation a miss costs 4–5 s before the first word, which is when
  thread checkpoints (`context-window.ts`) keep the window in check.

Keep the prefix byte-identical: static prompt (`chat-prompt.ts`), history exactly as sent
before, the turn's context right after the person's latest message (`pi.ts`).

## Watching it

- `GET /api/agent/timings`: where each chat turn's time went (every model call with its model,
  input tokens and cache).
- `GET /api/agent/timings/cache`: per model, hit rate, cached share and first-token time with and
  without a hit.
- Impossibl's request log (`GET /v1/requests`) shows the served route and cached tokens.

## Changing the policy

Change `autoModel` (which model) or `reasoningFor` (how much thinking) and their tests in
`tests/pi.test.ts`. Re-measure with the timings above before and after.
