import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "@copilotkit/react-native/headless";
import { groupTurns } from "../src/features/chat/turns";

const call = (id: string, name: string, args = "{}") => ({
  id,
  type: "function" as const,
  function: { name, arguments: args },
});

test("narration between tools folds into one trace with a single final answer", () => {
  const messages = [
    { id: "u1", role: "user", content: "Puxa minha agenda de hoje?" },
    {
      id: "a1",
      role: "assistant",
      content: "Vou verificar.",
      toolCalls: [call("t1", "find_app_tools")],
    },
    { id: "r1", role: "tool", toolCallId: "t1", content: "{}" },
    { id: "a2", role: "assistant", content: "Vou puxar.", toolCalls: [call("t2", "use_app_tool")] },
    { id: "r2", role: "tool", toolCallId: "t2", content: '{"error":"x"}' },
    { id: "a3", role: "assistant", content: "Você tem 2 reuniões hoje." },
  ] as Message[];
  const [turn] = groupTurns(messages, false);
  assert.equal(turn?.lead, "Vou verificar.");
  assert.equal(turn?.answer, "Você tem 2 reuniões hoje.");
  assert.deepEqual(
    turn?.trace.map((entry) =>
      entry.kind === "note" ? entry.text : `${entry.name}:${entry.state}`,
    ),
    ["find_app_tools:done", "Vou puxar.", "use_app_tool:failed"],
  );
  assert.equal(turn?.cards.length, 0);
});

test("tools with their own card stay visible and pending tools show as running", () => {
  const messages = [
    { id: "u1", role: "user", content: "Busca relógios" },
    {
      id: "a1",
      role: "assistant",
      content: "",
      toolCalls: [call("t1", "browser_task"), call("t2", "use_app_tool")],
    },
  ] as Message[];
  const [turn] = groupTurns(messages, true);
  assert.equal(turn?.cards[0]?.toolCall.function.name, "browser_task");
  assert.deepEqual(turn?.trace, [
    { kind: "tool", id: "t2", name: "use_app_tool", args: "{}", state: "running" },
  ]);
  assert.equal(turn?.answer, undefined);
});

test("files the agent sends become cards; run_python files not sent stay as chips", () => {
  const messages = [
    { id: "u1", role: "user", content: "Faz o relatório" },
    { id: "a1", role: "assistant", content: "", toolCalls: [call("p", "run_python")] },
    {
      id: "r1",
      role: "tool",
      toolCallId: "p",
      content: JSON.stringify({
        ok: true,
        files: [
          { fileId: "f1", name: "relatorio.pdf", type: "application/pdf", size: 10 },
          { fileId: "f2", name: "dados.csv", type: "text/csv", size: 5 },
        ],
      }),
    },
    {
      id: "a2",
      role: "assistant",
      content: "",
      toolCalls: [call("s", "send_file", '{"fileId":"f1"}')],
    },
    {
      id: "r2",
      role: "tool",
      toolCallId: "s",
      content: JSON.stringify({ sent: true, file: { id: "f1", name: "relatorio.pdf" } }),
    },
    { id: "a3", role: "assistant", content: "Pronto." },
  ] as Message[];
  const [turn] = groupTurns(messages, false);
  assert.deepEqual(
    turn?.cards.map((card) => card.toolCall.function.name),
    ["send_file"],
  );
  assert.deepEqual(
    turn?.generated.map((file) => file.name),
    ["dados.csv"],
  );
});

test("a turn shows one checklist: its latest version", () => {
  const messages = [
    { id: "u1", role: "user", content: "Limpe a agenda" },
    {
      id: "a1",
      role: "assistant",
      content: "",
      toolCalls: [call("t1", "update_todos", '{"todos":[{"text":"A","status":"in_progress"}]}')],
    },
    { id: "r1", role: "tool", toolCallId: "t1", content: "{}" },
    {
      id: "a2",
      role: "assistant",
      content: "",
      toolCalls: [call("t2", "update_todos", '{"todos":[{"text":"A","status":"done"}]}')],
    },
    { id: "r2", role: "tool", toolCallId: "t2", content: "{}" },
    { id: "a3", role: "assistant", content: "Feito." },
  ] as Message[];
  const [turn] = groupTurns(messages, false);
  assert.deepEqual(
    turn?.cards.map((card) => card.toolCall.id),
    ["t2"],
  );
});
