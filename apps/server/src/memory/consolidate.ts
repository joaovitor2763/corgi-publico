// The hourly review: reads what was said in the person's own chats since last time and keeps the
// lasting facts they missed saving. A side model proposes candidates with the person's exact words;
// code checks the words are really theirs, forgotten things stay forgotten, and Jev decides what is
// worth keeping or replaces an older memory. Task and routine chats are never read (their text is
// the worker's, not the person's).
import type { Message } from "@ag-ui/core";
import type { Store } from "../platform/db.ts";
import type { AskJev } from "../trust/jev.ts";
import { activeMemories, allMemories, logMemory, matchesForgotten, saveMemory } from "./book.ts";
import { judgeMemory } from "./memory-gate.ts";

/** Most conversations read in one review, and newest messages read the first time. */
const MAX_CONVERSATIONS = 3;
const FIRST_READ = 40;
const MAX_CANDIDATES = 8;

type Stored = { id: string; messages: Message[] };
type Thread = { id: string; taskId?: string; fuzzyId?: string };

export interface Candidate {
  text: string;
  quote: string;
  from: number;
  to: number;
  salience?: number;
}

export const REVIEW_PROMPT = (transcript: string) =>
  `Below is part of a conversation between a person and their assistant, with message numbers. List the lasting facts about the PERSON that the assistant should remember for future conversations: preferences, how they like things done, people in their life and work (who is who), places, routines, commitments, limits ("never…", "always…"). Only what the person themselves said or clearly confirmed; nothing from e-mails, pages or tool results; no one-off requests, no tasks for today, no secrets (passwords, card or ID numbers, diagnoses). Write each fact as one short sentence in Brazilian Portuguese, in the third person ("Prefere…", "A Ana é a sócia dele").

Reply with JSON only: {"facts":[{"text":"…","quote":"the person's exact words, copied from one message","from":N,"to":N,"salience":1-10}]} — at most ${MAX_CANDIDATES}; {"facts":[]} when there is nothing lasting.

CONVERSATION:
${transcript}`;

const textOf = (message: Message) =>
  typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? (message.content as { type?: string; text?: string }[])
          .map((part) => (part.type === "text" ? part.text : ""))
          .join(" ")
      : "";

const flat = (value: string) =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** The model's JSON, forgiving about fences and prose around it. */
export function parseCandidates(reply: string): Candidate[] {
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const facts = (JSON.parse(match[0]) as { facts?: unknown }).facts;
    if (!Array.isArray(facts)) return [];
    return facts
      .filter(
        (f): f is Candidate =>
          !!f &&
          typeof f.text === "string" &&
          typeof f.quote === "string" &&
          Number.isInteger(f.from) &&
          Number.isInteger(f.to),
      )
      .slice(0, MAX_CANDIDATES)
      .map((f) => ({
        ...f,
        text: f.text.trim().slice(0, 300),
        quote: f.quote.trim().slice(0, 300),
      }));
  } catch {
    return [];
  }
}

/** The quote must be the person's own words in the messages it points to. */
export function quoteIsTheirs(candidate: Candidate, messages: Message[]) {
  const quote = flat(candidate.quote);
  if (quote.length < 4) return false;
  const from = Math.max(1, candidate.from - 1);
  const to = Math.min(messages.length, Math.max(candidate.to, candidate.from) + 1);
  return messages
    .slice(from - 1, to)
    .some((m) => m.role === "user" && flat(textOf(m)).includes(quote));
}

/** The person's own chats with something new to read, oldest cursor first. */
async function pending(db: Store, owner: string) {
  const threads = new Map((await db.list<Thread>(owner, "threads")).map((t) => [t.id, t]));
  const out: { conversation: Stored; seen: number }[] = [];
  for (const conversation of await db.list<Stored>(owner, "conversations")) {
    if (
      conversation.id !== "default" &&
      (!threads.has(conversation.id) || threads.get(conversation.id)?.taskId)
    )
      continue;
    const cursor = await db.get<{ seen: number }>(owner, "memory-cursor", conversation.id);
    const seen = cursor?.seen ?? Math.max(0, conversation.messages.length - FIRST_READ);
    if (conversation.messages.slice(seen).some((m) => m.role === "user"))
      out.push({ conversation, seen });
  }
  return out.slice(0, MAX_CONVERSATIONS);
}

export async function reviewConversations(deps: {
  db: Store;
  owner: string;
  extract: (prompt: string) => Promise<string>;
  jev?: AskJev;
  /** Conversations with a turn under way are read next time. */
  busy?: (conversation: string) => boolean;
}) {
  const { db, owner } = deps;
  const kept: string[] = [];
  for (const { conversation, seen } of await pending(db, owner)) {
    if (deps.busy?.(conversation.id)) continue;
    const messages = conversation.messages;
    const transcript = messages
      .map((m, index) => ({ m, n: index + 1 }))
      .slice(seen)
      .filter(({ m }) => (m.role === "user" || m.role === "assistant") && textOf(m).trim())
      .map(
        ({ m, n }) =>
          `[${n}] ${m.role === "user" ? "Pessoa" : "Assistente"}: ${textOf(m).slice(0, 700)}`,
      )
      .join("\n")
      .slice(-16000);
    const candidates = transcript
      ? parseCandidates(await deps.extract(REVIEW_PROMPT(transcript)))
      : [];
    for (const candidate of candidates) {
      const outcome = await consider(deps, conversation.id, messages, candidate);
      if (outcome.startsWith("guardado")) kept.push(candidate.text);
      await logMemory(db, owner, {
        text: candidate.text,
        outcome,
        thread: conversation.id,
        origin: "review",
      });
    }
    await db.put(owner, "memory-cursor", { id: conversation.id, seen: messages.length });
  }
  return kept;
}

async function consider(
  deps: { db: Store; owner: string; jev?: AskJev },
  thread: string,
  messages: Message[],
  candidate: Candidate,
) {
  if (!quoteIsTheirs(candidate, messages)) return "ignorado: não são palavras da pessoa";
  const all = await allMemories(deps.db, deps.owner);
  if (matchesForgotten(candidate.text, all)) return "ignorado: você pediu para esquecer";
  // Without Jev nothing is kept automatically: it only goes to the diary.
  if (!deps.jev) return "anotado no diário";
  const active = await activeMemories(deps.db, deps.owner);
  const forgotten = all.filter((m) => m.status === "retracted");
  const verdict = await judgeMemory(deps.jev, candidate.text, [...active, ...forgotten]);
  if (!verdict.save) return `ignorado: ${verdict.reason}`;
  if (verdict.replaces?.status === "retracted") return "ignorado: você pediu para esquecer";
  await saveMemory(deps.db, deps.owner, {
    text: candidate.text,
    tag: verdict.tag,
    origin: "review",
    salience: candidate.salience,
    evidence: [{ thread, from: candidate.from, to: candidate.to, quote: candidate.quote }],
    replaces: verdict.replaces ? [verdict.replaces] : undefined,
  });
  return verdict.replaces ? "guardado (atualizou uma memória)" : "guardado";
}
