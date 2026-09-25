# browser/ — server side of the browser worker

`BrowserService` talks to `apps/worker` over HTTP with `WORKER_TOKEN` (never sent to clients). It
maps chat threads to browser sessions, runs `browser_task` (Jev navigator), reviews a checkout page
before proposing it, and calls `confirmCheckout` only after approval. `browser-console.ts` renders
a screenshot-only takeover console: remote page code never runs in our document.
