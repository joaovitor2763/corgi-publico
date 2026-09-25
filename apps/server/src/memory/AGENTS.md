# memory/ — what the agent remembers (docs/MEMORY.md)

- `book.ts`: the only place that changes memories. Save with evidence, correct = supersede (new id,
  lineage kept), forget = retract (restorable 30 days, then purged; also the tombstone reviews
  check), explain, the diary (`memory-log`), people and alignment readers.
- `memory.ts`: the `MemoryItem` type, `isActive`, recall ranking (shared words × salience × recency).
- `memory-gate.ts`: Jev decides lasting / sensitive / tag / duplicate-or-replaces, and picks what
  matters for a request. Without Jev the chat still saves (untagged); the review keeps nothing.
- `tools.ts`: chat tools (remember, update, forget, explain). `routes.ts`: `/api/agent/memory*`.
- `consolidate.ts`: hourly review of the person's own chats (never task threads); quotes are checked
  in code. `dream.ts`: nightly reflection; operations validated in code (`validateOps`).
  `upkeep.ts`: when each runs (called from the agent's maintenance loop).

Never write `memories` records directly elsewhere, and never put `memory-log` or dream diaries in a
prompt other than the reflection's.
