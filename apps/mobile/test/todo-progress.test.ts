import assert from "node:assert/strict";
import test from "node:test";
import { planProgress, todoProgress, todosOf } from "../src/features/chat/todo-progress.ts";

test("the checklist comes from the server's result, or from the arguments while it streams", () => {
  const args = '{"todos":[{"text":"A","status":"done"},{"text":"B","status":"in_progress"}]}';
  const result = JSON.stringify({ todos: [{ id: "t1", text: "A", status: "done" }] });
  assert.deepEqual(todosOf(result, args), [{ id: "t1", text: "A", status: "done" }]);
  assert.equal(todosOf(undefined, args).length, 2);
  assert.deepEqual(todosOf(undefined, '{"todos":[{"text":"A","sta'), [], "half-written args");
  assert.deepEqual(todoProgress(todosOf(undefined, args)), { done: 1, total: 2, current: "B" });
});

test("a task's plan reads as progress without its skipped steps", () => {
  assert.deepEqual(
    planProgress([
      { title: "A", status: "succeeded" },
      { title: "B", status: "running" },
      { title: "C", status: "failed" },
      { title: "D", status: "pending" },
    ]),
    { done: 1, total: 3, current: "B" },
  );
});
