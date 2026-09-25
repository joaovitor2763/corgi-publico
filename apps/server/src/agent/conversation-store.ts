// Chat turns survive the phone. iOS suspends a web app the moment you switch away; the run
// keeps going on the server (CopilotKit's runner is detached from the request), so the server
// also saves the finished turn to the conversation instead of relying on the app to do it.
// While a turn runs, GET /api/conversation says so and the app waits instead of erroring.
import { type BaseEvent, EventType, type Message } from "@ag-ui/core";
import type { Store } from "../platform/db.ts";

/** Threads with a turn in progress, per owner ("owner:thread"). */
const running = new Map<string, number>();
const key = (owner: string, thread: string) => `${owner}:${thread}`;

/** The conversation id the app saves under: the main chat is "default", side chats are UUIDs. */
export function conversationId(threadId: string) {
  if (threadId === "local-main" || threadId === "default") return "default";
  return /^[0-9a-f-]{36}$/i.test(threadId) ? threadId : undefined;
}

export function markRunning(owner: string, threadId: string, on: boolean) {
  const id = conversationId(threadId);
  if (!id) return;
  const k = key(owner, id);
  const count = (running.get(k) ?? 0) + (on ? 1 : -1);
  if (count > 0) running.set(k, count);
  else running.delete(k);
}

export function isRunning(owner: string, thread: string) {
  return running.has(key(owner, thread));
}

/**
 * A running turn's events without the tool calls still being written (their arguments are
 * half a JSON object) or waiting for a result: what an app may show without tripping on them.
 */
export function finishedSoFar(events: BaseEvent[]) {
  const answered = new Set(
    events.flatMap((e) =>
      e.type === EventType.TOOL_CALL_RESULT && "toolCallId" in e ? [String(e.toolCallId)] : [],
    ),
  );
  return events.filter(
    (e) =>
      !(
        "toolCallId" in e &&
        e.type !== EventType.TOOL_CALL_RESULT &&
        !answered.has(String(e.toolCallId))
      ),
  );
}

/** The conversation as it stands mid-turn (what was sent plus what the run has added so far). */
const live = new Map<string, () => Message[]>();

export function setLive(owner: string, threadId: string, snapshot?: () => Message[]) {
  const id = conversationId(threadId);
  if (!id) return;
  if (snapshot) live.set(key(owner, id), snapshot);
  else live.delete(key(owner, id));
}

/** Saved messages with the running turn's progress laid over them, so an open app follows it. */
export function withLive(owner: string, thread: string, saved: Message[]) {
  const snapshot = live.get(key(owner, thread));
  return snapshot ? mergeWindow(saved, snapshot()) : saved;
}

/** The messages a run added, rebuilt from its AG-UI events. */
export function messagesFromEvents(events: BaseEvent[]): Message[] {
  const out: Message[] = [];
  const assistant = new Map<string, Message & { role: "assistant" }>();
  const byCall = new Map<string, { id: string; name: string; args: string }>();
  const ensure = (id: string) => {
    let message = assistant.get(id);
    if (!message) {
      message = { id, role: "assistant", content: "" };
      assistant.set(id, message);
      out.push(message);
    }
    return message;
  };
  for (const event of events as (BaseEvent & Record<string, unknown>)[]) {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_START:
        ensure(String(event.messageId));
        break;
      case EventType.TEXT_MESSAGE_CONTENT: {
        const message = ensure(String(event.messageId));
        message.content = `${message.content ?? ""}${String(event.delta ?? "")}`;
        break;
      }
      case EventType.TOOL_CALL_START: {
        const parent = ensure(String(event.parentMessageId ?? event.toolCallId));
        const call = { id: String(event.toolCallId), name: String(event.toolCallName), args: "" };
        byCall.set(call.id, call);
        parent.toolCalls = [
          ...(parent.toolCalls ?? []),
          { id: call.id, type: "function", function: { name: call.name, arguments: "" } },
        ];
        break;
      }
      case EventType.TOOL_CALL_ARGS: {
        const call = byCall.get(String(event.toolCallId));
        if (!call) break;
        call.args += String(event.delta ?? "");
        for (const message of assistant.values())
          for (const toolCall of message.toolCalls ?? [])
            if (toolCall.id === call.id) toolCall.function.arguments = call.args;
        break;
      }
      case EventType.TOOL_CALL_RESULT:
        out.push({
          id: String(event.messageId),
          role: "tool",
          toolCallId: String(event.toolCallId),
          content: String(event.content ?? ""),
        });
        break;
    }
  }
  // An assistant message with neither text nor tool calls says nothing.
  return out.filter(
    (message) =>
      message.role !== "assistant" || message.content || (message.toolCalls?.length ?? 0) > 0,
  );
}

/**
 * Saves the conversation as it stands after a run: what the app sent plus what the run added.
 * Skips when the app already saved something newer (it has more messages than this run knows).
 */
export async function saveRun(
  db: Store,
  owner: string,
  threadId: string,
  sent: Message[],
  events: BaseEvent[],
) {
  const id = conversationId(threadId);
  if (!id) return;
  const added = messagesFromEvents(events);
  if (!added.length) return;
  const saved = await db.get<Stored>(owner, "conversations", id);
  const messages = mergeWindow(saved?.messages ?? [], [...sent, ...added]);
  // The app already saved something newer (a later turn): keep it.
  if ((saved?.messages.length ?? 0) > messages.length) return;
  await db.put(owner, "conversations", { id, messages });
}

type Stored = { id: string; messages: Message[] };

/** The last `limit` messages before `before` (a message id), and whether older ones exist. */
export function pageOf(messages: Message[], limit: number, before?: string) {
  const end = before ? messages.findIndex((m) => m.id === before) : messages.length;
  const stop = end < 0 ? messages.length : end;
  // Start a page on a user message so a tool result never loses the call it answers.
  let start = Math.max(0, stop - limit);
  while (start > 0 && messages[start].role !== "user") start--;
  return { messages: messages.slice(start, stop), hasMore: start > 0, total: messages.length };
}

/**
 * The app keeps only its loaded window. Saving it replaces the stored conversation from the
 * window's first message on and keeps everything older.
 */
export function mergeWindow(stored: Message[], window: Message[]) {
  if (!window.length) return stored;
  const from = stored.findIndex((m) => m.id === window[0].id);
  const inWindow = new Set(window.map((m) => m.id));
  // Replace the tail only when the window has everything stored there (a stale app window must
  // never erase an answer the server saved while the app was away).
  if (from >= 0 && stored.slice(from).every((m) => inWindow.has(m.id)))
    return [...stored.slice(0, from), ...window];
  // The window doesn't start inside what's stored: never drop anything, only add what's new.
  const known = new Set(stored.map((m) => m.id));
  return [...stored, ...window.filter((m) => !known.has(m.id))];
}

/**
 * "Try again" and "edit": drop a message and everything after it, so the model never sees the
 * answer being replaced. Unknown ids change nothing.
 */
export function truncateAt(stored: Message[], id: string) {
  const at = stored.findIndex((m) => m.id === id);
  return at < 0 ? stored : stored.slice(0, at);
}

/** What the model gets as history: stored messages older than the app's window, then the window. */
export async function fullHistory(db: Store, owner: string, threadId: string, window: Message[]) {
  const id = conversationId(threadId);
  if (!id || !window.length) return window;
  const saved = await db.get<Stored>(owner, "conversations", id);
  return saved ? mergeWindow(saved.messages, window) : window;
}
