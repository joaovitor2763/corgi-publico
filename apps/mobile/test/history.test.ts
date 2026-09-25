import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@ag-ui/core";
import {
  isConnectionLoss,
  lastUserIndex,
  mergeLatest,
  prependOlder,
} from "../src/features/chat/history.ts";
import { noteText } from "../src/features/chat/task-note-text.ts";

const m = (id: string): Message => ({ id, role: "user", content: id });

test("a fresh latest page replaces the tail and keeps older loaded pages", () => {
  const loaded = ["a", "b", "c", "d"].map(m);
  assert.deepEqual(
    mergeLatest(loaded, ["c", "d", "e", "f"].map(m)).map((x) => x.id),
    ["a", "b", "c", "d", "e", "f"],
  );
  assert.deepEqual(
    mergeLatest(loaded, ["x", "y"].map(m)).map((x) => x.id),
    ["a", "b", "c", "d", "x", "y"],
  );
});

test("older pages go in front without duplicates", () => {
  assert.deepEqual(
    prependOlder(["c", "d"].map(m), ["a", "b", "c"].map(m)).map((x) => x.id),
    ["a", "b", "c", "d"],
  );
});

test("connection losses are told apart from agent errors", () => {
  assert.equal(isConnectionLoss(new Error("Load failed")), true);
  assert.equal(isConnectionLoss(new TypeError("Failed to fetch")), true);
  assert.equal(isConnectionLoss(new Error("Pi run failed or was interrupted")), false);
});

test("retry is offered only when the last message has no answer", async () => {
  const { lastIsUnanswered } = await import("../src/features/chat/history.ts");
  assert.equal(lastIsUnanswered([m("q")]), true);
  assert.equal(lastIsUnanswered([m("q"), { id: "a", role: "assistant", content: "ok" }]), false);
});

test("the person's latest message is found past the answer and its tool calls", () => {
  assert.equal(lastUserIndex([]), -1);
  assert.equal(
    lastUserIndex([
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
      { role: "assistant" },
      { role: "tool" },
      { role: "assistant" },
    ]),
    2,
  );
});

test("a task note shows its words and hides the guidance meant for the model", () => {
  assert.equal(
    noteText("Aprovada e executada: Recusar convite\n\n» Continue a tarefa a partir daqui."),
    "Aprovada e executada: Recusar convite",
  );
});
