# connected-apps/ — Composio

- `composio.ts` — `ComposioService`: connected accounts (multi-account, identity lookup via read-only
  tools only), default account per app, tool search/inspect/execute.
- `composio-tools.ts` — agent-facing tools, per-app permission (`ask` = reads free, writes reviewed;
  `read`; `off`), and always-allow rules (`AUTO_ALLOW`, id `TOOL@account`, 30-day expiry). Tools that
  send, reply, forward, post, share, pay or delete (`canAlwaysAllow`) always ask. Read results pass
  through the trust guard's `inspect` hook.

Reads may run immediately; writes become `app.action` proposals. Composio results are untrusted
data. Tests must not reach Composio (guarded by `NODE_TEST_CONTEXT`; `.env` is not loaded in tests).

Results: `compact.ts` drops noise (etags, Slack blocks, preview images, false flags) and never shortens
lists. Over 60k chars, a side model digests the result for the request and the raw result stays
readable with `app_result_page` (in memory, last 20). Never silently cut a list.
