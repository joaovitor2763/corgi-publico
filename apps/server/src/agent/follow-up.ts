// Steering a task from its own window: "confirma com a Jéssica", "usa o endereço de casa".
// Each task is its own side conversation: the original request, what it answered, then the
// person's follow-ups in order. A follow-up re-queues the task with all of that as context, so
// it continues where it was instead of the main chat guessing from a one-line summary.
import type { AgentTask } from "../../../../packages/domain/src/agent.ts";
import { AppError } from "../platform/errors.ts";
import type { AgentService } from "./service.ts";

export interface FollowUp {
  text: string;
  at: string;
  /** What the task had answered when the person wrote this. */
  previousResult?: string;
  /** An answer to the task's question (recorded by `service.answer`). */
  answer?: boolean;
  /** The question it answers, so the model sees its own question before the answer. */
  question?: string;
}

const STEERABLE = new Set<AgentTask["kind"]>(["agent", "plan"]);

export function followUpsOf(task: AgentTask): FollowUp[] {
  return Array.isArray(task.state.followUps) ? (task.state.followUps as FollowUp[]) : [];
}

export async function followUpTask(service: AgentService, owner: string, id: string, text: string) {
  const task = await service.getTask(owner, id);
  if (task.status === "waiting_input") return service.answer(owner, id, text);
  if (!STEERABLE.has(task.kind))
    throw new AppError("Esta tarefa não aceita instruções. Peça no chat.", 409);
  const followUp: FollowUp = {
    text,
    at: new Date().toISOString(),
    ...(task.result ? { previousResult: task.result.slice(0, 8000) } : {}),
  };
  // A task that is working right now restarts with the new instruction.
  if (task.status === "running") service.worker.abort(id);
  const next = await service.db.compareAndSwap<AgentTask>(
    owner,
    "tasks",
    id,
    { status: task.status, updatedAt: task.updatedAt },
    {
      status: "queued",
      leaseId: null,
      leaseUntil: null,
      error: null,
      question: null,
      result: "",
      state: { ...task.state, followUps: [...followUpsOf(task), followUp], card: null },
      updatedAt: followUp.at,
    },
  );
  if (!next) throw new AppError("A tarefa mudou; atualize e tente de novo", 409);
  await service.db.put(owner, "run-events", {
    id: crypto.randomUUID(),
    taskId: id,
    kind: "status",
    date: followUp.at,
    title: "Nova instrução sua",
    detail: text,
  });
  return next;
}
