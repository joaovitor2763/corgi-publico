// Queued messages survive the app closing: saved on the phone per chat, sent when it reopens.
import * as FileSystem from "expo-file-system/legacy";
import type { QueuedMessage } from "./conversation-queue";

const path = (thread: string) =>
  `${FileSystem.documentDirectory}queue-${thread.replace(/[^\w-]/g, "_")}.json`;

export async function loadQueue(thread: string): Promise<QueuedMessage[]> {
  try {
    const list = JSON.parse(await FileSystem.readAsStringAsync(path(thread)));
    return Array.isArray(list) ? list.filter((m) => typeof m?.text === "string") : [];
  } catch {
    return [];
  }
}

export async function saveQueue(thread: string, pending: readonly QueuedMessage[]) {
  try {
    if (pending.length) await FileSystem.writeAsStringAsync(path(thread), JSON.stringify(pending));
    else await FileSystem.deleteAsync(path(thread), { idempotent: true });
  } catch {
    // Best effort: the queue still works in memory.
  }
}
