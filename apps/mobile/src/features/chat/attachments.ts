// The chat sends context to the model as trailing lines: attached files with their IDs, and the
// task a message is about. People should see only their words, the file names and a task chip.
const FILES = /(?:^|\n\n)(?:Attached files|Attached documents): (.+?)(?=\n\nAbout task: |$)/s;
const ITEM = /(.+?) \((?:file|artifact) ID: ([\w-]+)\)(?:, |$)/g;
const TASK =
  /\n\nAbout task: (.+) \(task ID: ([\w-]+)\)\s*(?=\n\n(?:Attached files|Attached documents): |$)/;

export interface TaskRef {
  title: string;
  id: string;
}

export function splitAttachments(text: string): {
  text: string;
  files: { name: string; id: string }[];
  task?: TaskRef;
} {
  let rest = text;
  let task: TaskRef | undefined;
  const about = rest.match(TASK);
  if (about?.index !== undefined) {
    task = { title: about[1].trim(), id: about[2] };
    rest = rest.slice(0, about.index) + rest.slice(about.index + about[0].length);
  }
  const match = rest.match(FILES);
  const files =
    match?.index !== undefined
      ? [...match[1].matchAll(ITEM)].map(([, name, id]) => ({ name, id }))
      : [];
  if (match?.index !== undefined) rest = rest.slice(0, match.index);
  if (!task && !match) return { text, files };
  return { text: rest.trim(), files, ...(task ? { task } : {}) };
}

/** A message about a background task: the words, then the line the agent reads it by. */
export function aboutTask(text: string, task: TaskRef) {
  const title = task.title.replace(/\s+/g, " ").trim() || "Tarefa";
  return `${text.trim()}\n\nAbout task: ${title} (task ID: ${task.id})`;
}
