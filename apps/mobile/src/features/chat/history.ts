// The chat keeps only the pages it has loaded: the latest one on open, older ones as the person
// scrolls up ("Carregar mensagens anteriores"). The server keeps the whole conversation.
import type { Message } from "@ag-ui/core";

export const PAGE = 80;

/**
 * Puts a freshly fetched latest page over what's loaded: everything loaded before the page's
 * first message stays, the page replaces the rest. Never drops messages it can't place.
 */
export function mergeLatest(loaded: Message[], page: Message[]) {
  if (!page.length) return loaded;
  const from = loaded.findIndex((m) => m.id === page[0].id);
  if (from >= 0) return [...loaded.slice(0, from), ...page];
  const known = new Set(page.map((m) => m.id));
  // The page starts after everything loaded (a long absence): keep both, in order.
  return [...loaded.filter((m) => !known.has(m.id)), ...page];
}

/** Older messages go in front of what's loaded (skipping any already there). */
export function prependOlder(loaded: Message[], older: Message[]) {
  const known = new Set(loaded.map((m) => m.id));
  return [...older.filter((m) => !known.has(m.id)), ...loaded];
}

/** A failure of the connection itself (the app was suspended or offline), not of the agent. */
export function isConnectionLoss(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /load failed|failed to fetch|network|aborted|NetworkError|conexão/i.test(message);
}

/** The conversation ends with the person's message: a retry would answer it. */
export function lastIsUnanswered(messages: Message[]) {
  const last = [...messages].reverse().find((m) => m.role === "user" || m.role === "assistant");
  return last?.role === "user";
}

/** Index of the person's latest message (-1 when there is none). */
export function lastUserIndex(messages: readonly { role: string }[]) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "user") return i;
  return -1;
}
