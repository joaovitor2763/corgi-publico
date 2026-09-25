import type { Message, ToolMessage } from "@copilotkit/react-native/headless";
import { pythonFilesOf, sentFileOf } from "./sent-file";
import type { TraceEntry } from "./work-trace";

/** Tools with their own chat card; everything else folds into the turn's work trace. */
const CARD_TOOLS = new Set([
  "search_mail",
  "read_mail_thread",
  "browse_web",
  "browser_task",
  "delegate_task",
  "agent_status",
  "create_goal",
  "watch_page",
  "remember_fact",
  "update_memory",
  "forget_memory",
  "show_results",
  "request_checkout",
  "send_file",
  "get_weather",
  "show_route",
  "update_todos",
]);

/** A weather lookup that failed (place not found) has no card: it shows as a failed step. */
const cardFor = (name: string, result?: ToolMessage) =>
  CARD_TOOLS.has(name) &&
  !(name === "get_weather" && result && /"error"\s*:/.test(String(result.content)));

type ToolCall = NonNullable<Extract<Message, { role: "assistant" }>["toolCalls"]>[number];
interface Turn {
  id: string;
  user?: string;
  trace: TraceEntry[];
  cards: { toolCall: ToolCall; toolMessage?: ToolMessage }[];
  /** The agent's opening line ("Vou buscar na Amazon."), shown as a normal message. */
  lead?: string;
  answer?: string;
  /** Files run_python made that the agent did not also send as a card in this turn. */
  generated: { id: string; name: string; mimeType: string; size: number }[];
}

/**
 * One user message and everything the agent did about it. Narration between tool calls
 * becomes trace notes, so a multi-step answer reads as one reply instead of many bubbles.
 */
export function groupTurns(messages: Message[], replying: boolean): Turn[] {
  const results = new Map<string, ToolMessage>();
  for (const message of messages)
    if (message.role === "tool") results.set(message.toolCallId, message);
  const turns: Turn[] = [];
  const replies = new Map<Turn, Message[]>();
  for (const message of messages) {
    if (message.role === "user") {
      const turn: Turn = {
        id: message.id,
        user: typeof message.content === "string" ? message.content : "",
        trace: [],
        cards: [],
        generated: [],
      };
      turns.push(turn);
      replies.set(turn, []);
    } else if (message.role === "assistant") {
      let turn = turns[turns.length - 1];
      if (!turn) {
        turn = { id: message.id, trace: [], cards: [], generated: [] };
        turns.push(turn);
        replies.set(turn, []);
      }
      replies.get(turn)?.push(message);
    }
  }
  const lastTurn = turns[turns.length - 1];
  for (const turn of turns) {
    const items = replies.get(turn) ?? [];
    const final = items[items.length - 1];
    const finalText =
      final && typeof final.content === "string" && final.content && !toolCallsOf(final).length
        ? final
        : undefined;
    for (const item of items) {
      const text = typeof item.content === "string" ? item.content.trim() : "";
      if (text && item !== finalText) {
        if (item === items[0]) turn.lead = text;
        else turn.trace.push({ kind: "note", id: item.id, text });
      }
      for (const toolCall of toolCallsOf(item)) {
        const toolMessage = results.get(toolCall.id);
        if (cardFor(toolCall.function.name, toolMessage)) {
          // One checklist per turn: its latest version.
          if (toolCall.function.name === "update_todos")
            turn.cards = turn.cards.filter(
              (card) => card.toolCall.function.name !== "update_todos",
            );
          turn.cards.push({ toolCall, toolMessage });
        } else {
          // A change prepared in a connected app also gets its approval card in the chat.
          if (
            toolCall.function.name === "use_app_tool" &&
            /"actionId"/.test(String(toolMessage?.content ?? ""))
          )
            turn.cards.push({ toolCall, toolMessage });
          turn.trace.push({
            kind: "tool",
            id: toolCall.id,
            name: toolCall.function.name,
            args: toolCall.function.arguments,
            state: toolMessage
              ? /"error"\s*:/.test(String(toolMessage.content))
                ? "failed"
                : "done"
              : replying && turn === lastTurn
                ? "running"
                : "stopped",
          });
        }
      }
    }
    const sent = new Set(
      turn.cards.flatMap(({ toolCall, toolMessage }) =>
        toolCall.function.name === "send_file"
          ? [sentFileOf(toolMessage?.content)?.file.id ?? ""]
          : [],
      ),
    );
    for (const item of items)
      for (const toolCall of toolCallsOf(item))
        if (toolCall.function.name === "run_python")
          for (const file of pythonFilesOf(results.get(toolCall.id)?.content))
            if (!sent.has(file.id) && !turn.generated.some((f) => f.id === file.id))
              turn.generated.push(file);
    turn.answer = finalText?.content as string | undefined;
  }
  return turns;
}

function toolCallsOf(message: Message): ToolCall[] {
  return "toolCalls" in message && Array.isArray(message.toolCalls)
    ? (message.toolCalls as ToolCall[])
    : [];
}
