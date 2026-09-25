// The agent's checklist as the app reads it (from update_todos, or a task's plan). Pure, for tests.

export type TodoStatus = "pending" | "in_progress" | "done" | "skipped";
export interface TodoItem {
  id?: string;
  text: string;
  status: TodoStatus;
  note?: string;
}

const STATUSES = new Set<TodoStatus>(["pending", "in_progress", "done", "skipped"]);

function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined; // arguments still streaming
  }
}

/** The list from the tool's result (the server's cleaned version) or, while running, its args. */
export function todosOf(result: unknown, args: unknown): TodoItem[] {
  for (const source of [parsed(result), parsed(args)]) {
    const list = (source as { todos?: unknown } | undefined)?.todos;
    if (!Array.isArray(list)) continue;
    return list.flatMap((item) => {
      const todo = item as Partial<TodoItem>;
      if (typeof todo?.text !== "string" || !todo.text.trim()) return [];
      const status = STATUSES.has(todo.status as TodoStatus)
        ? (todo.status as TodoStatus)
        : "pending";
      return [{ id: todo.id, text: todo.text, status, ...(todo.note ? { note: todo.note } : {}) }];
    });
  }
  return [];
}

export function todoProgress(todos: readonly TodoItem[]) {
  const counted = todos.filter((todo) => todo.status !== "skipped");
  return {
    done: counted.filter((todo) => todo.status === "done").length,
    total: counted.length,
    current: todos.find((todo) => todo.status === "in_progress")?.text,
  };
}

/** A task's plan (steps) as progress: "3/5", and the step being worked on. */
export function planProgress(plan: readonly { title: string; status: string }[]) {
  const counted = plan.filter((step) => step.status !== "failed");
  return {
    done: counted.filter((step) => step.status === "succeeded").length,
    total: counted.length,
    current: plan.find((step) => step.status === "running")?.title,
  };
}
