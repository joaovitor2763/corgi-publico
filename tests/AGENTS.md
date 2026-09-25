# tests/ — server and worker suite

Run with `pnpm test` (node --test through tsx). Files are flat and named after the domain they cover.

- Use fixtures in `helpers/` (`pi-model.ts` local HTTP model, `browser.ts`, `computer.ts`, `model.ts`).
- Use `createStore()` (in-memory PGlite) and `createApp(db, config)` with an explicit sample `Config`.
- No real network, keys or accounts: `.env` is not loaded under `node --test`, and a test asserts it.
- Test behavior (a task survives restart, a checkout is refused) rather than internals.
