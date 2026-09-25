// Worker notes in a task's side chat (see server agent/chat-task.ts); pure, for tests.

/** Messages the task worker wrote (see server agent/chat-task.ts). */
export const TASK_NOTE = "task-note-";

/** What the person sees of a worker note: guidance for the model ("» …") stays hidden. */
export function noteText(text: string) {
  return text
    .split(/\n\n+/)
    .filter((part) => !part.trimStart().startsWith("»"))
    .join("\n\n")
    .trim();
}
