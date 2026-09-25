// A routine set to "approve safe things on its own": app actions its runs prepare go ahead
// without the person, but only those eligible for "always allow" (never a send, reply, delete or
// payment: `canAlwaysAllow` in connected-apps) and never one the trust guard flagged. The flag
// travels with the task the run creates (`task.input.autoApprove`, set by `runRoutine`).
import type { AgentTask } from "../../../../packages/domain/src/agent.ts";

/**
 * Whether this task may run the action on its own. `alwaysAllowable` is the action's
 * "always allow" eligibility (`canAlwaysAllow(tool, destructive)`); the caller checks the
 * trust guard separately, as it does for the person's own always-allow rules.
 */
export function taskAutoApproves(
  task: Pick<AgentTask, "input"> | null | undefined,
  alwaysAllowable: boolean,
) {
  return alwaysAllowable && task?.input.autoApprove === true;
}

/** What the model is told when a run may act on its own; the rule about sends stays. */
export const AUTO_APPROVE_NOTE =
  "Esta rotina pode executar sozinha ações seguras em apps (criar, atualizar); enviar, responder, apagar e pagar continuam esperando aprovação.";
