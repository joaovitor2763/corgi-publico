// Helpers ("fuzzies"): small assistants Corgi calls, each with a standing mission, its own chat,
// only the apps the person allowed, an optional schedule and a daily budget. A run is an ordinary
// background task in the helper's one conversation (agent/chat-task.ts), so approvals, progress
// and recovery work as for any task. This module owns the records and when a run may start.
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentTask, Fuzzy, FuzzyInput } from "../../../../packages/domain/src/agent.ts";
import { fuzzyInputSchema } from "../../../../packages/domain/src/agent.ts";
import type { Store } from "../platform/db.ts";
import { AppError } from "../platform/errors.ts";
import { nextRun, normalizeSchedule } from "../routines/routines.ts";

const ACTIVE = new Set<AgentTask["status"]>([
  "queued",
  "running",
  "waiting_input",
  "waiting_approval",
]);
/** Facts a helper keeps about its own job. */
export const MAX_LEARNED = 50;

export interface FuzzyDeps {
  db: Store;
  timeZone: string;
  /** Starts a background task (AgentService.createTask). */
  createTask: (
    owner: string,
    input: { title: string; prompt: string; kind: "agent"; input: Record<string, unknown> },
    key: string,
  ) => Promise<AgentTask>;
  /** Sends an instruction to a task that is still going (follow-up.ts). */
  followUp: (owner: string, taskId: string, text: string) => Promise<unknown>;
}

export const fuzzyList = (db: Store, owner: string) =>
  db
    .list<Fuzzy>(owner, "fuzzies")
    .then((all) => all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));

export async function fuzzyGet(db: Store, owner: string, id: string) {
  const fuzzy = await db.get<Fuzzy>(owner, "fuzzies", id);
  if (!fuzzy) throw new AppError("Ajudante não encontrado", 404);
  return fuzzy;
}

/** A helper by name ("radar", "Radar de clientes") or id, for ask_fuzzy. */
export async function fuzzyByName(db: Store, owner: string, name: string) {
  const wanted = plain(name);
  const all = await fuzzyList(db, owner);
  return (
    all.find((f) => f.id === name) ??
    all.find((f) => plain(f.name) === wanted) ??
    all.find((f) => plain(f.name).startsWith(wanted) || wanted.startsWith(plain(f.name)))
  );
}

/** The helper a conversation belongs to, if any. */
export async function fuzzyOfThread(db: Store, owner: string, threadId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) return undefined;
  const thread = await db.get<{ fuzzyId?: string }>(owner, "threads", threadId);
  return thread?.fuzzyId
    ? ((await db.get<Fuzzy>(owner, "fuzzies", thread.fuzzyId)) ?? undefined)
    : undefined;
}

function scheduleOf(input: FuzzyInput["schedule"], timeZone: string) {
  if (!input) return undefined;
  return normalizeSchedule({ frequency: "weekly" as const, ...input }, timeZone);
}

export async function createFuzzy(
  deps: Pick<FuzzyDeps, "db" | "timeZone">,
  owner: string,
  raw: unknown,
  id: string = randomUUID(),
) {
  const input = fuzzyInputSchema.parse(raw);
  const existing = await deps.db.get<Fuzzy>(owner, "fuzzies", id);
  if (existing) return existing;
  if ((await fuzzyList(deps.db, owner)).length >= 12)
    throw new AppError("Até 12 ajudantes por pessoa. Apague um antes de criar outro.", 409);
  const now = new Date().toISOString();
  const threadId = randomUUID();
  const schedule = scheduleOf(input.schedule, deps.timeZone);
  const fuzzy: Fuzzy = {
    id,
    name: input.name,
    emoji: input.emoji,
    color: input.color,
    mission: input.mission,
    instructions: input.instructions,
    apps: input.apps,
    web: input.web,
    schedule,
    nextRunAt: schedule ? nextRun(schedule, new Date())?.toISOString() : undefined,
    status: "active",
    threadId,
    maxRunsPerDay: input.maxRunsPerDay,
    learned: [],
    template: input.template,
    createdAt: now,
  };
  // Its conversation, listed with the side chats and marked as the helper's.
  await deps.db.put(owner, "threads", {
    id: threadId,
    title: `${input.emoji} ${input.name}`,
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    fuzzyId: id,
  });
  await deps.db.insertIfAbsent(owner, "fuzzies", fuzzy);
  return (await deps.db.get<Fuzzy>(owner, "fuzzies", id)) ?? fuzzy;
}

export async function updateFuzzy(
  deps: Pick<FuzzyDeps, "db" | "timeZone">,
  owner: string,
  id: string,
  raw: unknown,
) {
  const fuzzy = await fuzzyGet(deps.db, owner, id);
  const sent = new Set(Object.keys((raw ?? {}) as object));
  const parsed = fuzzyInputSchema
    .partial()
    .extend({ status: z.enum(["active", "paused"]).optional() })
    .parse(raw);
  const patch = Object.fromEntries(Object.entries(parsed).filter(([key]) => sent.has(key)));
  const next: Fuzzy = { ...fuzzy, ...(patch as Partial<Fuzzy>) };
  if (sent.has("schedule")) {
    next.schedule = scheduleOf(parsed.schedule, deps.timeZone);
    next.nextRunAt = next.schedule ? nextRun(next.schedule, new Date())?.toISOString() : undefined;
  }
  await deps.db.put(owner, "fuzzies", next);
  // Its conversation follows the name, and stays marked as the helper's.
  const thread = await deps.db.get<Record<string, unknown>>(owner, "threads", fuzzy.threadId);
  if (thread)
    await deps.db.put(owner, "threads", {
      ...thread,
      id: fuzzy.threadId,
      title: `${next.emoji} ${next.name}`,
      fuzzyId: fuzzy.id,
    });
  return next;
}

/** Deletes the helper; its conversation stays readable, archived. */
export async function deleteFuzzy(db: Store, owner: string, id: string) {
  const fuzzy = await fuzzyGet(db, owner, id);
  await db.take(owner, "fuzzies", id);
  const thread = await db.get<Record<string, unknown>>(owner, "threads", fuzzy.threadId);
  if (thread)
    await db.put(owner, "threads", {
      ...thread,
      id: fuzzy.threadId,
      archived: true,
      fuzzyId: undefined,
    });
  return { ok: true };
}

export type RunResult =
  | { started: true; taskId: string; followUp?: boolean }
  | { started: false; reason: string };

/**
 * Starts a round of work. On schedule (`due`) it is claimed by moving nextRunAt first, skipped
 * while the previous round is still going or when paused. Called with a request while a round is
 * going, the request joins that round. Every start counts against the daily budget.
 */
export async function runFuzzy(
  deps: FuzzyDeps,
  owner: string,
  id: string,
  options: { request?: string; due?: boolean; from?: "corgi" | "person" | "schedule" } = {},
): Promise<RunResult> {
  const fuzzy = await fuzzyGet(deps.db, owner, id);
  const now = new Date();
  if (options.due) {
    const upcoming = fuzzy.schedule ? nextRun(fuzzy.schedule, now)?.toISOString() : undefined;
    const claimed = await deps.db.compareAndSwap<Fuzzy>(
      owner,
      "fuzzies",
      id,
      { nextRunAt: fuzzy.nextRunAt },
      { nextRunAt: upcoming },
    );
    if (!claimed) return { started: false, reason: "já iniciado" };
    if (fuzzy.status === "paused") return { started: false, reason: "pausado" };
  }
  const last = fuzzy.lastTaskId
    ? await deps.db.get<AgentTask>(owner, "tasks", fuzzy.lastTaskId)
    : undefined;
  if (last && ACTIVE.has(last.status)) {
    if (options.due) return { started: false, reason: "a rodada anterior ainda está em andamento" };
    if (options.request) {
      await deps.followUp(owner, last.id, options.request);
      return { started: true, taskId: last.id, followUp: true };
    }
    return { started: false, reason: "já está trabalhando" };
  }
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: deps.timeZone }).format(now);
  const count = fuzzy.runs?.day === day ? fuzzy.runs.count : 0;
  if (count >= fuzzy.maxRunsPerDay)
    return {
      started: false,
      reason: `limite de ${fuzzy.maxRunsPerDay} rodadas por dia atingido; volta amanhã ou aumente o limite`,
    };
  const request = options.request?.trim();
  const task = await deps.createTask(
    owner,
    {
      title: `${fuzzy.emoji} ${fuzzy.name}${request ? `: ${request.slice(0, 60)}` : ""}`,
      prompt: request || "Rodada agendada: cumpra sua missão agora.",
      kind: "agent",
      input: {
        fuzzyId: id,
        from: options.from ?? (options.due ? "schedule" : "person"),
        asked: Boolean(request),
      },
    },
    `fuzzy:${id}:${createHash("sha256")
      .update(`${request ?? ""}:${now.toISOString().slice(0, 16)}`)
      .digest("hex")
      .slice(0, 16)}`,
  );
  const latest = await fuzzyGet(deps.db, owner, id);
  await deps.db.put(owner, "fuzzies", {
    ...latest,
    runs: { day, count: count + 1 },
    lastRunAt: now.toISOString(),
    lastTaskId: task.id,
  });
  return { started: true, taskId: task.id };
}

/** Helpers whose schedule is due (called every minute by the maintenance loop). */
export async function runDueFuzzies(deps: FuzzyDeps) {
  for (const { owner, value } of await deps.db.scan<Fuzzy>("fuzzies"))
    if (value.nextRunAt && Date.parse(value.nextRunAt) <= Date.now())
      await runFuzzy(deps, owner, value.id, { due: true });
}

/** A fact for the helper's own job (learn_fact); duplicates are ignored, the oldest drop off. */
export async function learn(db: Store, owner: string, id: string, text: string) {
  const fuzzy = await fuzzyGet(db, owner, id);
  if (fuzzy.learned.some((l) => plain(l.text) === plain(text))) return fuzzy;
  const next = {
    ...fuzzy,
    learned: [
      ...fuzzy.learned,
      { text: text.trim().slice(0, 300), at: new Date().toISOString() },
    ].slice(-MAX_LEARNED),
  };
  await db.put(owner, "fuzzies", next);
  return next;
}

const plain = (value: string) =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
