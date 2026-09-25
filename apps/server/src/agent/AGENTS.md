# agent/ — chat and task engine

- `conversation.ts` — `ConversationAgent`: AG-UI chat turn, tool definitions (mail, browser, apps,
  memory, routines, `request_checkout`), in-turn approvals. Tool results are untrusted.
- `pi.ts` / `pi-provider.ts` — `AGENT_BACKEND=pi`: pi-ai against Impossibl Chat Completions with an
  allow-listed model set (`IMPOSSIBL_MODELS`). No fallback provider. Pictures attached to the last 3
  user messages are sent inline with them (`images` option).
- `model.ts` — delegated task runner (plans, steps, evidence, artifacts); `worker.ts` — SQL-leased
  `TaskWorker` that resumes interrupted tasks.
- `service.ts` — `AgentService`: snapshots, tasks, goals, monitors, ideas, routines, settings.
  Too large (~1.3k lines): when you touch a section, move it into its owning domain.
- Context: the thread goes whole up to ~250k tokens (`BUDGET` in `context-window.ts`). Past that,
  `thread-summary.ts` makes a checkpoint in the background (summary + exact message range, LCM-style;
  stored in `thread-checkpoints`), keeping ~120k recent tokens verbatim; old checkpoints merge into
  higher levels. Past 400k it compacts before answering. `conversation_history` reads any range.
- `complete.ts` — one-shot completions for side jobs; `SIDE_MODEL` (DeepSeek v4.1 Flash, fastest in our
  benchmark) also digests app results that exceed the cap.
- Latency: `timings.ts` records where each chat turn's time went (model calls with tokens/cache,
  tools) for the last 50 turns: `GET /api/agent/timings`. Chat runs a step's tool calls in parallel
  (`parallelTools`; browser tools stay serial); per-turn context goes after the latest message so
  the prefix stays cacheable.
- `conversation-store.ts` — chat turns survive the phone: the server saves each finished turn
  (rebuilt from its AG-UI events) and reports `running` on GET /api/conversation. The app loads the
  latest page (`limit`, `before` for older pages) and saves only its window; the server merges and
  gives the model the full history.
- Working memory per conversation (`thread-work.ts`, record `thread-work`): `update_todos` (`todos.ts`,
  full-list replace, one in_progress, dropped items reported) and `write_notes` (`notes.ts`, 4000 chars),
  both in `work-tools.ts`, shown to the model every turn via `chatContext` and never touched by compaction.
- Background tasks are side chats (`chat-task.ts`, `task-thread.ts`): the checklist mirrors the task's
  `plan`; a turn with open items or cut mid-work is continued (≤2 nudges) instead of reported as done.
- Prompt cache (Impossibl): implicit, prefix-based; no cache-key or routing field exists (`prompt_cache_key`
  is not sent). Keep the prefix byte-identical: static prompt, history as sent before, per-turn context
  right after the latest user message. Measured: zai (GLM) hits reliably; meta (Muse) route hits ~1 in 7
  even with an identical prefix (provider side). Per-model hit rate: `GET /api/agent/timings/cache`.
- Models: **Automático** by default (Muse today: fastest per call, sees pictures; picked per turn) and
  thinking per step (`reasoningFor`: plan with thought, tool steps lighter in chat; tasks think every step). See docs/MODELS.md. Loops: the same call
  a third time is refused, the fifth ends the turn (`repeatedCall`). Task flow: docs/TASKS.md.
- `chat-prompt.ts` — static system prompt (cache-friendly) + per-turn `chatContext`.
- `step-label.ts` — timeline labels in pt-BR from tool name + args.
- `routes.ts` — `/api/agent/*` HTTP routes; `runtime.ts` — CopilotKit runtime factory.

Changing a tool: update its zod input, the prompt text that mentions it, `step-label.ts`, and a test.
