import assert from "node:assert/strict";
import { test } from "node:test";
import { applyNotes, NOTES_MAX, notesContext } from "../apps/server/src/agent/notes.ts";
import {
  applyTodos,
  openTodos,
  todoContext,
  todoProgress,
  toPlan,
} from "../apps/server/src/agent/todos.ts";

test("a checklist keeps ids, allows one item in progress and reports dropped open items", () => {
  const first = applyTodos(
    [],
    [
      { text: "Ler o convite", status: "done" },
      { text: "Recusar o convite", status: "in_progress" },
      { text: "Avisar o organizador", status: "in_progress" },
    ],
  );
  assert.deepEqual(
    first.todos.map((t) => [t.id, t.status]),
    [
      ["t1", "done"],
      ["t2", "in_progress"],
      ["t3", "pending"],
    ],
  );
  assert.equal(first.warnings.length, 1);
  // Matched by id or by text; an open item that vanished comes back as dropped.
  const second = applyTodos(first.todos, [
    { id: "t1", text: "Ler o convite", status: "done" },
    { text: "recusar o convite", status: "done" },
    { text: "Resumir", status: "skipped" },
  ]);
  assert.equal(second.todos[1]?.id, "t2");
  assert.equal(second.todos[2]?.id, "t4");
  assert.deepEqual(second.dropped, ["Avisar o organizador"]);
  assert.match(second.warnings.join(), /without a reason/);
});

test("progress, context and plan read the same checklist", () => {
  const { todos } = applyTodos(
    [],
    [
      { text: "A", status: "done" },
      { text: "B", status: "in_progress" },
      { text: "C", status: "skipped", note: "sem acesso" },
      { text: "D", status: "pending" },
    ],
  );
  assert.deepEqual(todoProgress(todos).done, 1);
  assert.equal(todoProgress(todos).total, 3);
  assert.deepEqual(
    openTodos(todos).map((t) => t.text),
    ["B", "D"],
  );
  assert.match(
    todoContext(todos),
    /# Your checklist \(1\/3\)\n- \[x\] t1 A\n- \[>\] t2 B \(doing\)/,
  );
  assert.deepEqual(
    toPlan(todos).map((s) => s.status),
    ["succeeded", "running", "failed", "pending"],
  );
  assert.equal(toPlan(todos)[2]?.detail, "Pulado: sem acesso");
});

test("notes append, replace and refuse to overflow", () => {
  assert.equal(applyNotes("", { mode: "append", text: "evento abc" }).notes, "evento abc");
  assert.equal(applyNotes("a", { mode: "append", text: "b" }).notes, "a\nb");
  assert.equal(applyNotes("a", { mode: "replace", text: "c" }).notes, "c");
  const full = applyNotes("x".repeat(NOTES_MAX - 2), { mode: "append", text: "longer" });
  assert.match(full.rejected ?? "", /mode replace/);
  assert.equal(notesContext("  "), "");
  assert.match(notesContext("id 42"), /# Your working notes/);
});
