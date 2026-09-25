// What of a long thread the model reads each turn. Muse Spark reads 1M tokens, so the thread
// goes whole until it gets big (~250k tokens). Past that, the older part becomes checkpoints:
// summaries that each point at the exact message range they cover (LCM-style, lossless: the
// originals stay searchable and readable by range with conversation_history). The cut only
// moves when a checkpoint is made, so the prompt prefix stays stable between turns.
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface Checkpoint {
  /** Message range covered, 0-based, end exclusive (shown to the model as 1-based). */
  from: number;
  to: number;
  summary: string;
  /** 1 = summary of messages; 2+ = summary of older checkpoints merged together. */
  level: number;
}

export const BUDGET = {
  /** Past this (tokens since the last checkpoint), make a checkpoint in the background. */
  compactAt: 250_000,
  /** Past this, compact before answering (the background one didn't happen in time). */
  hardLimit: 400_000,
  /** What stays verbatim after a checkpoint. */
  keepRecent: 120_000,
  /** Checkpoint summaries above this get their oldest ones merged into one. */
  summariesMax: 30_000,
  /** Tool results older than the last 5–15 turns and larger than this are shortened. */
  oldToolChars: 20_000,
};

export function textOf(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: { type: string; text?: string; name?: string; arguments?: unknown }) =>
      part.type === "text"
        ? (part.text ?? "")
        : part.type === "toolCall"
          ? `[${part.name}(${JSON.stringify(part.arguments ?? {}).slice(0, 200)})]`
          : part.type === "image"
            ? "[imagem]"
            : "",
    )
    .join("\n");
}

/** Rough token count (pt-BR and JSON average ~3.5 characters per token; images ~1.5k). */
export function tokens(messages: AgentMessage[]) {
  return messages.reduce((total, message) => {
    const content = (message as { content?: unknown }).content;
    const images = Array.isArray(content)
      ? content.filter((part: { type: string }) => part.type === "image").length
      : 0;
    return total + Math.ceil(textOf(message).length / 3.5) + images * 1500;
  }, 0);
}

/** The first user message at or after which the rest fits in `budget` tokens. */
export function cutFor(history: AgentMessage[], start: number, budget: number) {
  let cut = history.length;
  let used = 0;
  for (let index = history.length - 1; index >= start; index--) {
    used += tokens([history[index]]);
    if (used > budget) break;
    if (history[index].role === "user") cut = index;
  }
  // Always keep at least the latest turn, however big.
  if (cut === history.length)
    cut = history.findLastIndex((message) => message.role === "user") ?? start;
  return Math.max(cut, start);
}

/** Where the verbatim part starts, given the saved checkpoints (they must still fit the thread). */
export function verbatimStart(history: AgentMessage[], checkpoints: Checkpoint[]) {
  const last = checkpoints.at(-1);
  return last && last.to <= history.length ? last.to : 0;
}

/** The verbatim part, with big tool results older than the last 5–15 turns shortened. */
export function keptMessages(
  history: AgentMessage[],
  start: number,
  oldToolChars = BUDGET.oldToolChars,
) {
  const turns = history.flatMap((message, index) => (message.role === "user" ? [index] : []));
  // The boundary moves in steps of 10 turns (5 to 15 recent turns stay whole), not every turn:
  // each move changes the prompt there and the provider's cache of everything after it.
  const step = Math.floor(Math.max(0, turns.length - 5) / 10) * 10;
  const recentFrom = step > 0 ? turns[step] : 0;
  return history.slice(start).map((message, offset) => {
    if (start + offset >= recentFrom || message.role !== "toolResult") return message;
    const text = textOf(message);
    if (text.length <= oldToolChars) return message;
    return {
      ...message,
      content: [
        {
          type: "text" as const,
          text: `${text.slice(0, oldToolChars)}… (resultado antigo encurtado; chame a ferramenta de novo se precisar dos detalhes)`,
        },
      ],
    };
  });
}

/** How the checkpoints read in the model's context. */
export function checkpointContext(checkpoints: Checkpoint[]) {
  if (!checkpoints.length) return "";
  const parts = checkpoints.map(
    (c) =>
      `## Mensagens ${c.from + 1}–${c.to}${c.level > 1 ? " (resumo de resumos)" : ""}\n${c.summary}`,
  );
  return `# Earlier in this conversation (checkpoints)
Messages 1–${checkpoints.at(-1)?.to} are not shown word for word; these checkpoints summarize them, each with the message range it covers. To see the originals, call conversation_history with from/to (a range from a checkpoint) or a query; do that before saying you don't know something from earlier.

${parts.join("\n\n")}`;
}

/** The dropped part as plain lines for the summarizer, with message numbers. */
export function transcript(messages: AgentMessage[], offset = 0, maxChars = 1_200_000) {
  const lines = messages.flatMap((message, index) =>
    message.role === "user" || message.role === "assistant"
      ? [
          `[${offset + index + 1}] ${message.role === "user" ? "Pessoa" : "Corgi"}: ${textOf(message)}`,
        ]
      : [],
  );
  let text = lines.join("\n\n");
  if (text.length > maxChars) text = `…${text.slice(-maxChars)}`;
  return text;
}

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Search the whole thread (for the conversation_history tool): messages containing every word
 * of the query, or a numbered range. Numbers are 1-based positions in the thread.
 */
export function searchHistory(
  history: { role: string; text: string }[],
  input: { query?: string; from?: number; to?: number; limit?: number },
) {
  const numbered = history
    .map((message, index) => ({ n: index + 1, role: message.role, text: message.text }))
    .filter((item) => (item.role === "user" || item.role === "assistant") && item.text.trim());
  const limit = Math.min(input.limit ?? 12, 40);
  const words = fold(input.query ?? "")
    .split(/\s+/)
    .filter((word) => word.length > 1);
  const inRange = (n: number) =>
    n >= (input.from ?? 1) && n <= (input.to ?? (input.from ? input.from + 30 : history.length));
  const hits = numbered.filter(
    (item) =>
      (words.length ? words.every((word) => fold(item.text).includes(word)) : true) &&
      (input.from || input.to || !words.length ? inRange(item.n) : true),
  );
  return {
    total: history.length,
    matches: hits.length,
    messages: (words.length ? hits.slice(-limit) : hits.slice(0, limit)).map((item) => ({
      n: item.n,
      role: item.role === "user" ? "pessoa" : "corgi",
      text: item.text.length > 2000 ? `${item.text.slice(0, 2000)}…` : item.text,
    })),
  };
}
