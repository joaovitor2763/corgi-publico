// The agent's working state for one conversation (main chat, side chat or a task's chat): its
// checklist and notes. Kept apart from the messages, so compaction and task pauses never lose it.
import type { Store } from "../platform/db.ts";
import { conversationId } from "./conversation-store.ts";
import type { Todo } from "./todos.ts";

export const WORK_KIND = "thread-work";

export interface ThreadWork {
  id: string;
  todos: Todo[];
  notes: string;
  updatedAt: string;
}

const workId = (threadId: string) => conversationId(threadId) ?? threadId;

export async function loadWork(db: Store, owner: string, threadId: string): Promise<ThreadWork> {
  const saved = await db.get<ThreadWork>(owner, WORK_KIND, workId(threadId));
  return {
    id: workId(threadId),
    todos: saved?.todos ?? [],
    notes: saved?.notes ?? "",
    updatedAt: saved?.updatedAt ?? new Date(0).toISOString(),
  };
}

export async function saveWork(
  db: Store,
  owner: string,
  threadId: string,
  patch: Partial<Pick<ThreadWork, "todos" | "notes">>,
) {
  const current = await loadWork(db, owner, threadId);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await db.put(owner, WORK_KIND, next);
  return next;
}
