# approvals/ — the review gate

`ActionService` is the only way anything writes outside the app (e-mail, calendar, connected-app
writes, browser checkout). Flow: `propose` (idempotent by key, content-hashed) → person approves the
exact `hash` → `execute` runs once → status `succeeded` / `failed` / uncertain.

- Never retry an uncertain external write automatically.
- Kind-specific validation belongs in `propose` (e.g. checkout policy), so no caller can skip it.
- Always-allow for app actions is stored by `connected-apps` (`AUTO_ALLOW`); never for purchases or
  send/share/delete tools, and never for a proposal the trust guard flagged.
- `guard` (from `trust/`) rides on the proposal; `risk: "high"` refuses approval without `acknowledgeRisk`.
