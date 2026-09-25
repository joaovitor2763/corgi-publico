// Keeps the lists clean on their own: finished tasks, quiet side chats and old news are put away
// (never deleted: archived items stay readable and can be restored).
import type { AgentNotification, AgentTask } from "../../../../packages/domain/src/agent.ts";
import type { Store } from "../platform/db.ts";
import { shortTitle } from "./titles.ts";

const DAY = 24 * 60 * 60 * 1000;
export const TIDY = {
  /** A finished task leaves the lists after this. */
  taskDoneFor: 3 * DAY,
  /** A side chat nobody touched (not pinned) is archived after this. */
  threadQuietFor: 7 * DAY,
  /** Unread news older than this is marked read. */
  newsOlderThan: 3 * DAY,
};
const FINISHED = new Set<AgentTask["status"]>(["succeeded", "cancelled", "failed"]);

type Thread = {
  id: string;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  updatedAt: string;
  taskId?: string;
};

/** Archive (or restore) a task, and its side chat with it. */
export async function archiveTask(db: Store, owner: string, id: string, archived: boolean) {
  const task = await db.get<AgentTask>(owner, "tasks", id);
  if (!task) return undefined;
  const next = await db.compareAndSwap<AgentTask>(
    owner,
    "tasks",
    id,
    { updatedAt: task.updatedAt },
    { archivedAt: archived ? new Date().toISOString() : null },
  );
  const threadId = typeof task.state.threadId === "string" ? task.state.threadId : undefined;
  const thread = threadId ? await db.get<Thread>(owner, "threads", threadId) : undefined;
  if (thread && thread.archived !== archived)
    await db.put(owner, "threads", { ...thread, archived });
  return next ?? undefined;
}

export async function tidyUp(db: Store, now = Date.now()) {
  const old = (iso: string | undefined, age: number) => !!iso && now - Date.parse(iso) > age;
  for (const { owner, value: task } of await db.scan<AgentTask>("tasks"))
    if (FINISHED.has(task.status) && !task.archivedAt && old(task.updatedAt, TIDY.taskDoneFor))
      await archiveTask(db, owner, task.id, true);
  for (const { owner, value: thread } of await db.scan<Thread>("threads")) {
    const title = thread.title ? tidyTitle(thread.title) : thread.title;
    const archive =
      !thread.archived &&
      !thread.pinned &&
      !thread.taskId &&
      old(thread.updatedAt, TIDY.threadQuietFor);
    if (archive || title !== thread.title)
      await db.put(owner, "threads", { ...thread, title, archived: archive || thread.archived });
  }
  for (const { owner, value: note } of await db.scan<AgentNotification>("notifications"))
    if (!note.read && old(note.createdAt, TIDY.newsOlderThan))
      await db.put(owner, "notifications", { ...note, read: true });
}

/**
 * Side chats named before titles were short: the raw request ("Tarefa: …", a pasted link) becomes
 * a short title. Titles the person typed never look like that, so they are left alone.
 */
export function tidyTitle(title: string) {
  const raw = title.replace(/^Tarefa( em segundo plano)?:\s*/i, "");
  if (raw === title && !/https?:\/\//.test(title)) return title;
  return shortTitle(raw);
}
