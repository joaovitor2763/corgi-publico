import assert from "node:assert/strict";
import { test } from "node:test";
import { type BaseEvent, EventType, type Message } from "@ag-ui/core";
import {
  conversationId,
  mergeWindow,
  messagesFromEvents,
  pageOf,
  setLive,
  withLive,
} from "../apps/server/src/agent/conversation-store.ts";

const user = (id: string): Message => ({ id, role: "user", content: id });
const reply = (id: string): Message => ({ id, role: "assistant", content: id });

test("a finished turn is rebuilt from its events: text, tool call with args, tool result", () => {
  const events = [
    { type: EventType.TEXT_MESSAGE_START, messageId: "a1", role: "assistant" },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "a1", delta: "Vou ver " },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "a1", delta: "o tempo." },
    { type: EventType.TEXT_MESSAGE_END, messageId: "a1" },
    {
      type: EventType.TOOL_CALL_START,
      toolCallId: "t1",
      toolCallName: "get_weather",
      parentMessageId: "a1",
    },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: "t1", delta: '{"place":' },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: "t1", delta: '"SP"}' },
    { type: EventType.TOOL_CALL_END, toolCallId: "t1" },
    { type: EventType.TOOL_CALL_RESULT, toolCallId: "t1", messageId: "r1", content: '{"ok":1}' },
    { type: EventType.TEXT_MESSAGE_START, messageId: "a2", role: "assistant" },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "a2", delta: "Leve guarda-chuva." },
  ] as BaseEvent[];
  const messages = messagesFromEvents(events);
  assert.deepEqual(
    messages.map((m) => [m.id, m.role]),
    [
      ["a1", "assistant"],
      ["r1", "tool"],
      ["a2", "assistant"],
    ],
  );
  const first = messages[0] as Message & { role: "assistant" };
  assert.equal(first.content, "Vou ver o tempo.");
  assert.equal(first.toolCalls?.[0].function.arguments, '{"place":"SP"}');
});

test("the app opens the latest page and asks for older ones, pages start on a user message", () => {
  const all = Array.from({ length: 10 }, (_, i) => [user(`u${i}`), reply(`a${i}`)]).flat();
  const last = pageOf(all, 5);
  assert.equal(last.messages[0].role, "user");
  assert.equal(last.messages.at(-1)?.id, "a9");
  assert.equal(last.hasMore, true);
  const older = pageOf(all, 4, last.messages[0].id);
  assert.equal(older.messages.at(-1)?.id, all[all.indexOf(last.messages[0]) - 1].id);
  assert.equal(pageOf(all, 100).hasMore, false);
});

test("saving the app's window keeps older stored messages and never drops any", () => {
  const stored = [user("u1"), reply("a1"), user("u2"), reply("a2")];
  assert.deepEqual(
    mergeWindow(stored, [user("u2"), reply("a2"), user("u3")]).map((m) => m.id),
    ["u1", "a1", "u2", "a2", "u3"],
  );
  // A window that doesn't start inside what's stored only adds what's new.
  assert.deepEqual(
    mergeWindow(stored, [user("x"), reply("a2")]).map((m) => m.id),
    ["u1", "a1", "u2", "a2", "x"],
  );
  assert.equal(conversationId("local-main"), "default");
  assert.equal(conversationId("rich-thread-abc"), undefined);
});

test("a stale app window never erases what the server saved after it", () => {
  const stored = [user("u1"), reply("a1"), user("u2"), reply("a2-saved-by-server")];
  // The app only knows up to u2 (it missed the answer) and saves its window.
  assert.deepEqual(
    mergeWindow(stored, [user("u1"), reply("a1"), user("u2")]).map((m) => m.id),
    ["u1", "a1", "u2", "a2-saved-by-server"],
  );
});

test("an app opened mid-turn sees the turn's progress laid over the saved conversation", () => {
  const saved = [{ id: "u1", role: "user" as const, content: "Oi" }];
  setLive("owner", "default", () => [
    ...saved,
    { id: "u2", role: "user" as const, content: "Pesquise a Nuvem Labs" },
    { id: "a2", role: "assistant" as const, content: "Procurando no Google…" },
  ]);
  assert.deepEqual(
    withLive("owner", "default", saved).map((m) => m.id),
    ["u1", "u2", "a2"],
  );
  setLive("owner", "default");
  assert.deepEqual(withLive("owner", "default", saved), saved);
});
