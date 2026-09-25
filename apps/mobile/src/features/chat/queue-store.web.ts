// Queued messages survive a reload: kept in this browser per chat, sent when it reopens.
import type { QueuedMessage } from "./conversation-queue";

const key = (thread: string) => `corgi-queue:${thread}`;

export async function loadQueue(thread: string): Promise<QueuedMessage[]> {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(key(thread)) ?? "[]");
    return Array.isArray(list) ? list.filter((m) => typeof m?.text === "string") : [];
  } catch {
    return [];
  }
}

export async function saveQueue(thread: string, pending: readonly QueuedMessage[]) {
  try {
    if (pending.length) globalThis.localStorage?.setItem(key(thread), JSON.stringify(pending));
    else globalThis.localStorage?.removeItem(key(thread));
  } catch {
    // Private mode or storage blocked: the queue still works in memory.
  }
}
