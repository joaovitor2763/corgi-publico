// Where each chat turn's time went (model calls, tools, context), kept for the last 50 turns
// and served at GET /api/agent/timings. Latency is the main thing people feel.
import type { RunAgentInput } from "@ag-ui/core";
import type { Store } from "../platform/db.ts";

export interface TurnTiming {
  id: string;
  at: string;
  request: string;
  totalMs: number;
  marks: { at: number; label: string }[];
}

const KIND = "turn-timings";
const KEEP = 50;

export async function recordTiming(
  db: Store,
  owner: string,
  input: RunAgentInput,
  marks: { at: number; label: string }[],
) {
  const latest = input.messages.filter((m) => m.role === "user").at(-1);
  const text = typeof latest?.content === "string" ? latest.content : "";
  await db
    .put(owner, KIND, {
      id: `${Date.now()}-${input.runId}`,
      at: new Date().toISOString(),
      request: text.split("\n\n")[0].slice(0, 120),
      totalMs: marks.at(-1)?.at ?? 0,
      marks,
    } satisfies TurnTiming)
    .catch(() => undefined);
  const all = await db.list<TurnTiming>(owner, KIND).catch(() => []);
  for (const old of all.sort((a, b) => b.id.localeCompare(a.id)).slice(KEEP))
    await db.take(owner, KIND, old.id).catch(() => undefined);
}

/** Recent turns, newest first, with time per step. */
export async function recentTimings(db: Store, owner: string) {
  const all = await db.list<TurnTiming>(owner, KIND);
  return all
    .sort((a, b) => b.id.localeCompare(a.id))
    .map((turn) => ({
      at: turn.at,
      request: turn.request,
      totalMs: turn.totalMs,
      steps: turn.marks.map((mark, i) => ({
        label: mark.label,
        at: mark.at,
        tookMs: mark.at - (turn.marks[i - 1]?.at ?? 0),
      })),
    }));
}

/**
 * Prompt-cache use per model over the recent turns: how much input the provider read from its
 * cache, and how long the first token took with and without a hit.
 */
export async function cacheSummary(db: Store, owner: string) {
  const byModel = new Map<
    string,
    {
      calls: number;
      hits: number;
      input: number;
      cached: number;
      hitMs: number[];
      missMs: number[];
    }
  >();
  for (const turn of await db.list<TurnTiming>(owner, KIND)) {
    let sent = 0;
    let first = 0;
    for (const mark of turn.marks) {
      if (mark.label === "model →") sent = mark.at;
      if (mark.label === "model first event") first = mark.at - sent;
      const usage = /^model ✓ (\S+) in (\d+) \(cache (\d+)\)/.exec(mark.label);
      if (!usage) continue;
      const [, model = "?", input, cached] = usage;
      const entry = byModel.get(model) ?? {
        calls: 0,
        hits: 0,
        input: 0,
        cached: 0,
        hitMs: [],
        missMs: [],
      };
      const total = Number(input) + Number(cached);
      const hit = Number(cached) > total / 2;
      entry.calls++;
      entry.input += total;
      entry.cached += Number(cached);
      if (hit) {
        entry.hits++;
        entry.hitMs.push(first);
      } else entry.missMs.push(first);
      byModel.set(model, entry);
    }
  }
  const avg = (list: number[]) =>
    list.length ? Math.round(list.reduce((sum, n) => sum + n, 0) / list.length) : undefined;
  return [...byModel].map(([model, entry]) => ({
    model,
    calls: entry.calls,
    hitRate: entry.calls ? Math.round((entry.hits / entry.calls) * 100) : 0,
    cachedShare: entry.input ? Math.round((entry.cached / entry.input) * 100) : 0,
    firstTokenMs: { hit: avg(entry.hitMs), miss: avg(entry.missMs) },
  }));
}
