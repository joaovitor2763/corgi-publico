# ideas/ — proactive suggestions

Pipeline: gather (the sources chosen in Ideias → Fontes, `sources.ts`: calendar, Gmail with its
search, Slack mentions/DMs/channels, Instagram DMs; plus memories and goals; `interpret.ts` turns
the person's words into those filters) → the chat model drafts
concrete actions citing signals → Jev keeps only the useful, grounded, doable ones. Dismissed titles
feed back into both stages. Ideas are suggestions; acting on one still goes through approvals.
`lifecycle.ts` (pure) decides what the app sees: a snoozed idea ("agendar para depois",
`snoozedUntil`) stays `new` but hidden, so the pipeline counts it as current and never drafts it
again; an idea open for `IDEA_TTL_DAYS` (7) without a decision reads as `expired` and moves to the
archive, where "restaurar" brings it back.
