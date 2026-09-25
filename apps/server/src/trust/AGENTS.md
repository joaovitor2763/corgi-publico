# trust/ — Jev client and the trust guard

- `jev.ts` — Jev (TypeSafe System One via Impossibl `/v1/systemone`): structured yes/no and choice
  answers in ~0.5 s. Shared by memory, ideas and the guard. Undefined without a key.
- `guard.ts` — `TrustGuard`, one per chat turn (`agent/conversation.ts`) or task run (`agent/model.ts`):
  - `observe(source)` on every untrusted read (mail, web, browser tasks, app reads). Jev flags prompt
    injection and phishing/fraud; the tool result then carries a `warning` the model must surface.
  - `assess(change)` before every proposal (app writes, e-mail, events, checkout). Jev compares the
    change with the owner's own request (last 3 user messages, or the task prompt). Result is a
    `GuardFlag` on the proposal: `check` (confirm) or `high` (looks malicious).
- Flagged proposals never auto-run, never offer "always allow", and `high` needs `acknowledgeRisk`
  on approval (server-enforced in `approvals/actions.ts`; two-tap UI in `features/approvals/guard-notice.tsx`).
- Fail closed: no Jev key or a Jev error → any change after external content is `check`.
- Tasks persist flags in `task.state.suspicions` so a resumed task stays strict.

Changing thresholds or questions: re-run a live check against real phishing/benign samples, not only
`tests/trust.test.ts` (which uses a scripted Jev).

Calibration (2026-09-24, live Jev, 3 runs): real work/personal calendars and a Gmail inbox list → 0
false positives; fake bank, hidden AI instruction, CEO-PIX fraud, calendar invite with an injected
instruction → all caught. The questions name what is *not* an attack (invites, join links,
newsletters, receipts); threshold 0.7. The same call returns `shape` (text/list/timeline/table/
stats/cards) for presentation.
