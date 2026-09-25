// A task's side chat: which thread belongs to which task, and where the task stands after a
// turn in it (the worker's or the person's). Kept apart from chat-task.ts so the chat engine can
// use it without importing the worker side.
import { type BaseEvent, EventType } from "@ag-ui/core";
import type { AgentTask } from "../../../../packages/domain/src/agent.ts";
import type { ActionProposal } from "../../../../packages/domain/src/index.ts";
import type { Store } from "../platform/db.ts";
import type { AgentService } from "./service.ts";
import { loadWork } from "./thread-work.ts";
import { openTodos, toPlan } from "./todos.ts";

export type Thread = {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  taskId?: string;
};

/** The task a side chat belongs to, if any. */
export async function taskIdOf(db: Store, owner: string, threadId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) return undefined;
  return (await db.get<Thread>(owner, "threads", threadId))?.taskId;
}

/** A task's side chat with work about to start or under way (the app waits for it). */
export async function taskThreadBusy(db: Store, owner: string, threadId: string) {
  const taskId = await taskIdOf(db, owner, threadId);
  if (!taskId) return false;
  const task = await db.get<AgentTask>(owner, "tasks", taskId);
  return task?.status === "queued" || task?.status === "running";
}

/** Whether a task runs as a side chat: open-ended work (and goal plans) with the Pi engine. */
export function runsAsChat(service: AgentService, task: AgentTask) {
  return (
    (task.kind === "agent" || task.kind === "plan") &&
    service.config.chatTasks !== false &&
    service.config.agentBackend === "pi"
  );
}

export function lastText(events: BaseEvent[]) {
  const texts = new Map<string, string>();
  let last: string | undefined;
  for (const event of events) {
    if (event.type === EventType.TEXT_MESSAGE_START && "messageId" in event)
      last = String(event.messageId);
    if (event.type === EventType.TEXT_MESSAGE_CONTENT && "delta" in event && "messageId" in event) {
      const id = String(event.messageId);
      texts.set(id, (texts.get(id) ?? "") + String(event.delta));
      last = id;
    }
  }
  return (last && texts.get(last)?.trim()) || "";
}

/**
 * Where a task stands after a turn: an approval waiting on the person, a question for them,
 * or done with the reply as its result.
 */
/**
 * Where a task stands after a turn: an approval waiting on the person, a question for them,
 * unfinished (its checklist has open items, or the turn stopped mid-work with nothing to say:
 * "queued", to continue), or done with the reply as its result.
 */
export async function taskOutcome(
  db: Store,
  owner: string,
  taskId: string,
  text: string,
  threadId?: string,
): Promise<Partial<AgentTask>> {
  // null clears the field in the stored task (the type only knows set-or-absent).
  const clear = null as unknown as undefined;
  const work = threadId ? await loadWork(db, owner, threadId) : undefined;
  const plan = work?.todos.length ? { plan: toPlan(work.todos) } : {};
  const actions = await db.list<ActionProposal>(owner, "actions");
  const waiting = actions
    .filter((action) => action.taskId === taskId && action.status === "awaiting_review")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (waiting[0])
    return {
      status: "waiting_approval",
      actionId: waiting[0].id,
      result: text,
      question: clear,
      ...plan,
    };
  const open = work ? openTodos(work.todos) : [];
  const question = text.split(/\n\n+/).at(-1)?.trim() ?? "";
  // A question ends the turn only while work is open (or untracked); after a finished list,
  // "Quer que eu…?" is an offer, not a blocker.
  if (question.endsWith("?") && (open.length || !work?.todos.length))
    return {
      status: "waiting_input",
      question: question.slice(0, 2000),
      result: text,
      actionId: null,
      ...plan,
    };
  if (open.length || !text.trim())
    return { status: "queued", result: text, question: clear, actionId: null, ...plan };
  return { status: "succeeded", result: text, question: clear, actionId: null, ...plan };
}

export async function settleTaskThread(
  service: AgentService,
  owner: string,
  taskId: string,
  events: BaseEvent[],
) {
  const task = await service.db.get<AgentTask>(owner, "tasks", taskId);
  // Running on the worker, stopped or cancelled: the person's turn doesn't change its state.
  if (!task || ["running", "queued", "paused", "cancelled"].includes(task.status)) return;
  const text = lastText(events);
  const threadId = typeof task.state.threadId === "string" ? task.state.threadId : undefined;
  let next = await taskOutcome(service.db, owner, taskId, text, threadId);
  // The person is in the chat: open steps are shown to them rather than re-run on their own.
  if (next.status === "queued") {
    const open = threadId ? openTodos((await loadWork(service.db, owner, threadId)).todos) : [];
    next = {
      ...next,
      status: "waiting_input",
      question: open.length
        ? `Ainda faltam: ${open.map((todo) => todo.text).join("; ")}. Diga "continua" e eu sigo.`
        : text || 'Parei no meio. Diga "continua" e eu sigo.',
    };
  }
  await service.db.compareAndSwap<AgentTask>(
    owner,
    "tasks",
    taskId,
    { status: task.status, updatedAt: task.updatedAt },
    { ...next, updatedAt: new Date().toISOString() },
  );
}
