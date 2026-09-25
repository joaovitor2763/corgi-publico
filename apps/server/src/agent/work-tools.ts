// The chat engine's working-memory tools (update_todos, write_notes), bound to one conversation.
import { defineTool } from "@copilotkit/runtime/v2";
import type { Store } from "../platform/db.ts";
import { applyNotes, notesDescription, notesInput } from "./notes.ts";
import { loadWork, saveWork } from "./thread-work.ts";
import { applyTodos, type Todo, todoDescription, todoInput, todoProgress } from "./todos.ts";

export function workTools(deps: {
  db: Store;
  owner: string;
  threadId: string;
  /** A background task mirrors its checklist as its plan (Activity shows the steps). */
  onTodos?: (todos: Todo[]) => Promise<void>;
}) {
  return [
    defineTool({
      name: "update_todos",
      description: todoDescription,
      parameters: todoInput,
      execute: async ({ todos: next }) => {
        const work = await loadWork(deps.db, deps.owner, deps.threadId);
        const { todos, warnings, dropped } = applyTodos(work.todos, next);
        await saveWork(deps.db, deps.owner, deps.threadId, { todos });
        await deps.onTodos?.(todos);
        const { done, total } = todoProgress(todos);
        return {
          todos,
          progress: `${done}/${total}`,
          ...(warnings.length ? { warnings } : {}),
          ...(dropped.length
            ? {
                dropped,
                note: "These open items are no longer on the list. If that was a mistake, send them again.",
              }
            : {}),
        };
      },
    }),
    defineTool({
      name: "write_notes",
      description: notesDescription,
      parameters: notesInput,
      execute: async (input) => {
        const work = await loadWork(deps.db, deps.owner, deps.threadId);
        const { notes, rejected } = applyNotes(work.notes, input);
        if (rejected) return { saved: false, error: rejected };
        await saveWork(deps.db, deps.owner, deps.threadId, { notes });
        return { saved: true, characters: notes.length };
      },
    }),
  ];
}
