// Checkpoints of a long thread (see context-window.ts), stored per thread. Making one reads only
// the messages since the last checkpoint; when the summaries themselves grow, the oldest are
// merged into one higher-level checkpoint that keeps the full range it covers.
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Store } from "../platform/db.ts";
import {
  BUDGET,
  type Checkpoint,
  checkpointContext,
  cutFor,
  keptMessages,
  tokens,
  transcript,
  verbatimStart,
} from "./context-window.ts";

interface ThreadCheckpoints {
  id: string;
  checkpoints: Checkpoint[];
  updatedAt: string;
}

const KIND = "thread-checkpoints";

const SUMMARY_PROMPT = (
  range: string,
  text: string,
) => `You keep the memory of a long chat between a person and their assistant Corgi.
Summarize messages ${range} below into a checkpoint the assistant will rely on later. Write in Portuguese (pt-BR), as short bullet points grouped by topic, and put the message numbers in brackets after each point (e.g. "[41–44]") so the originals can be looked up.
Keep: facts about the person and their people, decisions, preferences, commitments and pending items (with dates), numbers and names that may be asked again, files they sent or received (name and file ID), task IDs, and what Corgi already did (sent, scheduled, created). Corgi's checklist and working notes are kept separately: don't restate them. Drop greetings, small talk and anything later corrected; when something changed, keep only the latest version.
At most 900 words.

${text}

Checkpoint:`;

const MERGE_PROMPT = (
  range: string,
  parts: string,
) => `Merge these consecutive checkpoints of a chat (messages ${range}) into one shorter checkpoint in Portuguese (pt-BR). Keep every decision, commitment, pending item, name, number, file ID and task ID, with its message numbers in brackets; drop what later parts corrected. At most 900 words.

${parts}

Merged checkpoint:`;

export type Summarize = (prompt: string) => Promise<string>;

async function load(db: Store, owner: string, threadId: string, length: number) {
  const saved = await db.get<ThreadCheckpoints>(owner, KIND, threadId);
  // A thread shorter than what was summarized was edited or reset: start over.
  const checkpoints = (saved?.checkpoints ?? []).filter((c) => c.to <= length);
  return checkpoints.length === (saved?.checkpoints.length ?? 0) ? checkpoints : [];
}

/** Adds one checkpoint for everything since the last one, keeping the recent part verbatim. */
export async function compactThread(
  db: Store,
  owner: string,
  threadId: string,
  history: AgentMessage[],
  summarize: Summarize,
) {
  let checkpoints = await load(db, owner, threadId, history.length);
  const start = verbatimStart(history, checkpoints);
  const cut = cutFor(history, start, BUDGET.keepRecent);
  if (cut <= start) return checkpoints;
  const summary = await summarize(
    SUMMARY_PROMPT(`${start + 1}–${cut}`, transcript(history.slice(start, cut), start)),
  );
  if (!summary) return checkpoints;
  checkpoints = [...checkpoints, { from: start, to: cut, summary, level: 1 }];
  // Too many summaries: fold the oldest half into one higher-level checkpoint.
  while (
    checkpoints.length > 2 &&
    Math.ceil(checkpoints.reduce((n, c) => n + c.summary.length, 0) / 3.5) > BUDGET.summariesMax
  ) {
    const count = Math.ceil(checkpoints.length / 2);
    const old = checkpoints.slice(0, count);
    const merged = await summarize(
      MERGE_PROMPT(
        `${old[0].from + 1}–${old.at(-1)?.to}`,
        old.map((c) => `## Mensagens ${c.from + 1}–${c.to}\n${c.summary}`).join("\n\n"),
      ),
    );
    if (!merged) break;
    checkpoints = [
      {
        from: old[0].from,
        to: old.at(-1)?.to ?? old[0].to,
        summary: merged,
        level: Math.max(...old.map((c) => c.level)) + 1,
      },
      ...checkpoints.slice(count),
    ];
  }
  await db.put(owner, KIND, {
    id: threadId,
    checkpoints,
    updatedAt: new Date().toISOString(),
  } satisfies ThreadCheckpoints);
  return checkpoints;
}

const running = new Set<string>();

/**
 * The messages and context for this turn. Big threads get a checkpoint in the background (ready
 * for the next turn); only a thread past the hard limit waits for one now.
 */
export async function fitThread(
  db: Store,
  owner: string,
  threadId: string,
  history: AgentMessage[],
  summarize: Summarize,
) {
  let checkpoints = await load(db, owner, threadId, history.length);
  const since = tokens(history.slice(verbatimStart(history, checkpoints)));
  const key = `${owner}:${threadId}`;
  if (since > BUDGET.hardLimit) {
    checkpoints = await compactThread(db, owner, threadId, history, summarize).catch(
      () => checkpoints,
    );
  } else if (since > BUDGET.compactAt && !running.has(key)) {
    running.add(key);
    void compactThread(db, owner, threadId, history, summarize)
      .catch(() => undefined)
      .finally(() => running.delete(key));
  }
  const start = verbatimStart(history, checkpoints);
  return {
    history: keptMessages(history, start),
    context: checkpointContext(checkpoints),
  };
}
