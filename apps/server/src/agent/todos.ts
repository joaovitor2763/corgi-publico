// update_todos: the agent's checklist for a conversation, replaced whole on each call (one call,
// no id juggling). The server keeps it honest: one item in progress, a reason for skipping, and
// items that silently disappeared are reported back.
import { z } from "zod";
import type { TaskStep } from "../../../../packages/domain/src/agent.ts";

export type TodoStatus = "pending" | "in_progress" | "done" | "skipped";
export interface Todo {
  id: string;
  text: string;
  status: TodoStatus;
  note?: string;
}

export const TODO_MAX = 15;

export const todoInput = z.object({
  todos: z
    .array(
      z.object({
        id: z
          .string()
          .regex(/^[a-z0-9_-]{1,12}$/)
          .optional()
          .describe("Keep the id of an existing item; omit for a new one"),
        text: z.string().trim().min(1).max(160),
        status: z.enum(["pending", "in_progress", "done", "skipped"]).default("pending"),
        note: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe("Why it was skipped, or a short result"),
      }),
    )
    .max(TODO_MAX),
});

export const todoDescription =
  "Your checklist for this conversation, replaced whole on each call (send every item, done ones included). For work with 3+ steps or that continues after an approval or pause. At most one in_progress; mark done right after each step is verified; skipped needs a note saying why. Keep ids stable. Max 15 short items. Returns the list, progress and anything you dropped.";

const OPEN = new Set<TodoStatus>(["pending", "in_progress"]);

export function openTodos(todos: readonly Todo[]) {
  return todos.filter((todo) => OPEN.has(todo.status));
}

export function applyTodos(previous: readonly Todo[], next: z.infer<typeof todoInput>["todos"]) {
  const warnings: string[] = [];
  const byId = new Map(previous.map((todo) => [todo.id, todo]));
  const byText = new Map(previous.map((todo) => [todo.text.toLowerCase(), todo]));
  const used = new Set<string>();
  let counter = previous.reduce((max, todo) => {
    const n = Number(/^t(\d+)$/.exec(todo.id)?.[1] ?? 0);
    return Math.max(max, n);
  }, 0);
  let running = false;
  const todos: Todo[] = next.map((item) => {
    const match =
      (item.id && byId.get(item.id)) || byText.get(item.text.toLowerCase()) || undefined;
    let id = item.id ?? match?.id;
    if (!id || used.has(id)) id = `t${++counter}`;
    used.add(id);
    let status = item.status;
    if (status === "in_progress") {
      if (running) {
        status = "pending";
        warnings.push(`Only one item can be in_progress; "${item.text}" was set to pending.`);
      }
      running = true;
    }
    if (status === "skipped" && !item.note)
      warnings.push(`"${item.text}" is skipped without a reason: add a note saying why.`);
    return { id, text: item.text, status, ...(item.note ? { note: item.note } : {}) };
  });
  // Open items that vanished: the model re-plans on purpose, never by accident.
  const dropped = openTodos(previous)
    .filter((todo) => !used.has(todo.id))
    .map((todo) => todo.text);
  return { todos, warnings, dropped };
}

export function todoProgress(todos: readonly Todo[]) {
  const counted = todos.filter((todo) => todo.status !== "skipped");
  return {
    done: counted.filter((todo) => todo.status === "done").length,
    total: counted.length,
    current: todos.find((todo) => todo.status === "in_progress"),
  };
}

const MARK: Record<TodoStatus, string> = {
  done: "[x]",
  in_progress: "[>]",
  pending: "[ ]",
  skipped: "[–]",
};

/** The checklist as the model sees it each turn. */
export function todoContext(todos: readonly Todo[]) {
  if (!todos.length) return "";
  const { done, total } = todoProgress(todos);
  return `# Your checklist (${done}/${total})\n${todos
    .map(
      (todo) =>
        `- ${MARK[todo.status]} ${todo.id} ${todo.text}${todo.status === "in_progress" ? " (doing)" : ""}${todo.note ? ` — ${todo.note}` : ""}`,
    )
    .join("\n")}`;
}

/** The checklist as a task's plan (the Activity tab shows it as steps with progress). */
export function toPlan(todos: readonly Todo[]): TaskStep[] {
  return todos.map((todo) => ({
    id: todo.id,
    title: todo.text,
    status:
      todo.status === "done"
        ? "succeeded"
        : todo.status === "in_progress"
          ? "running"
          : todo.status === "skipped"
            ? "failed"
            : "pending",
    ...(todo.status === "skipped" && todo.note ? { detail: `Pulado: ${todo.note}` } : {}),
  }));
}
