# Helpers ("ajudantes")

Small assistants Corgi calls. Each has a standing mission, its own chat, only the apps the person
allowed, an optional schedule and a daily budget. Code: `apps/server/src/fuzzies/` (the code name
is "fuzzy"), app: Menu › Ajudantes (`apps/mobile/src/features/fuzzies/`).

## What a helper is

`fuzzies` records (`packages/domain` `Fuzzy`): name, emoji, color, mission, instructions, apps
(toolkit slugs), web yes/no, schedule (days + time, São Paulo), `maxRunsPerDay`, its one
`threadId`, `learned` facts, `lastFinding`. Four templates: Radar (Slack/e-mail), Preparador
(meetings), Concorrentes (web), Cobrador (promises and deadlines).

## How it runs

A round is an ordinary background task (`input.fuzzyId`) run by the chat engine
(`agent/chat-task.ts`) **in the helper's own conversation**: its notes (`write_notes`) carry over
between rounds; its checklist starts fresh each round. Approvals, progress, recovery and the loop
guard are the same as for any task.

- **Started by**: its schedule (maintenance loop, claimed by moving `nextRunAt` first), Corgi's
  `ask_fuzzy`, the person ("Rodar agora" or a message in its chat).
- **Never overlapping**: a scheduled round skips while the last one is going; a request while one
  is going joins it as a follow-up.
- **Budget**: at most `maxRunsPerDay` rounds per local day.
- **Reporting**: the round ends with `report_finding`. `notify: true` becomes a notification (and a
  push); the same headline twice is not sent again; quiet rounds send nothing (the generic "task
  done" notice is skipped for helper rounds).

## Fewer powers than Corgi (enforced on the server)

In a helper's conversation (`fuzzies/tools.ts`, applied in `agent/conversation.ts`):

- The role at the top of the standing prompt is the helper's, and its identity is its own.
- Tools removed: `delegate_task`, `manage_task`, `create_routine`, `create_goal`, `watch_page`,
  `save_skill`, `remember_fact`, `update_memory`, `forget_memory`, `request_checkout`, `ask_fuzzy`,
  `create_fuzzy`; web tools too when `web` is off.
- Apps: every toolkit not in its list is "off" for it (the app permission check), and only its
  apps appear in its context.
- It gains `learn_fact` (its own job's facts, ≤ 50) and `report_finding`.
- It reads the person's memory but never writes it; its chat is not read by the memory review.

## Corgi's side

Corgi's context lists the active helpers with their missions, and it has `ask_fuzzy` (hand a
request over; the answer comes back in notifications) and `create_fuzzy` (only when the person
asked or agreed).
