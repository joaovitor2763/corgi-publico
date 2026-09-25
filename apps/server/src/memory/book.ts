// The memory book: every change to what Corgi knows about the person goes through here, so each
// memory keeps where it came from (evidence), what it replaced (lineage) and stays forgotten once
// the person says so (a retracted memory is the tombstone later reviews check against).
import { createHash, randomUUID } from "node:crypto";
import type {
  MemoryDream,
  MemoryEvidence,
  MemoryOrigin,
  MemoryPerson,
  MemorySynthesis,
} from "../../../../packages/domain/src/agent.ts";
import type { Store } from "../platform/db.ts";
import { isActive, type MemoryItem, words } from "./memory.ts";

const DAY = 24 * 60 * 60 * 1000;
/** Forgotten memories can be restored for this long, then they are purged. */
export const FORGET_RESTORE_DAYS = 30;

export const ORIGIN_LABEL: Record<MemoryOrigin, string> = {
  owner: "Você adicionou",
  chat: "Você disse no chat",
  review: "Percebido numa conversa",
  reflection: "Reflexão da noite",
};

/** Memories saved before origins existed carry an English source line. */
const LEGACY_SOURCE: Record<string, string> = {
  "You added in Apps": "Você adicionou",
  "User confirmed in chat": "Você disse no chat",
  "Updated in chat": "Atualizado no chat",
  "Corrected in chat": "Corrigido no chat",
  You: "Você adicionou",
};

export async function allMemories(db: Store, owner: string) {
  return db.list<MemoryItem>(owner, "memories");
}

export async function activeMemories(db: Store, owner: string) {
  return (await allMemories(db, owner)).filter(isActive);
}

/** Keeps a new memory; `replaces` marks the old one superseded and links both ways. */
export async function saveMemory(
  db: Store,
  owner: string,
  input: {
    text: string;
    tag?: string;
    origin: MemoryOrigin;
    source?: string;
    salience?: number;
    evidence?: MemoryEvidence[];
    replaces?: MemoryItem[];
    id?: string;
  },
) {
  const now = new Date().toISOString();
  const memory: MemoryItem = {
    id: input.id ?? randomUUID(),
    text: input.text.trim(),
    tag: input.tag,
    status: "active",
    origin: input.origin,
    source: input.source ?? ORIGIN_LABEL[input.origin],
    salience: clampSalience(input.salience),
    evidence: input.evidence?.length ? input.evidence.slice(0, 6) : undefined,
    supersedes: input.replaces?.length ? input.replaces.map((m) => m.id) : undefined,
    createdAt: now,
  };
  const saved = await db.insertIfAbsent(owner, "memories", memory);
  for (const old of input.replaces ?? [])
    await db.put(owner, "memories", { ...old, status: "superseded", supersededBy: memory.id });
  return saved ? memory : ((await db.get<MemoryItem>(owner, "memories", memory.id)) ?? memory);
}

/** A correction: the new wording replaces the old one, which stays in the lineage. */
export async function correctMemory(
  db: Store,
  owner: string,
  memory: MemoryItem,
  text: string,
  origin: MemoryOrigin,
) {
  return saveMemory(db, owner, {
    text,
    tag: memory.tag,
    origin,
    salience: memory.salience,
    evidence: memory.evidence,
    replaces: [memory],
  });
}

/** Forgets a memory: out of every answer at once, restorable for 30 days, never re-learned. */
export async function forgetMemory(db: Store, owner: string, memory: MemoryItem) {
  const forgotten = {
    ...memory,
    status: "retracted" as const,
    retractedAt: new Date().toISOString(),
  };
  await db.put(owner, "memories", forgotten);
  return forgotten;
}

export async function restoreMemory(db: Store, owner: string, id: string) {
  const memory = await db.get<MemoryItem>(owner, "memories", id);
  if (memory?.status !== "retracted") return undefined;
  const { retractedAt: _, ...rest } = memory;
  const restored = { ...rest, status: "active" as const };
  await db.put(owner, "memories", restored);
  return restored;
}

/** Forgotten past the restore window: gone for good. */
export async function purgeForgotten(db: Store, now = Date.now()) {
  let purged = 0;
  for (const { owner, value } of await db.scan<MemoryItem>("memories"))
    if (
      value.status === "retracted" &&
      value.retractedAt &&
      now - Date.parse(value.retractedAt) > FORGET_RESTORE_DAYS * DAY
    ) {
      await db.take(owner, "memories", value.id);
      purged += 1;
    }
  return purged;
}

/**
 * Something the person forgot (or a close rewording of it): reviews must not learn it again.
 * Word overlap is the cheap first check; Jev's "same" check covers paraphrases.
 */
export function matchesForgotten(text: string, memories: MemoryItem[]) {
  const mine = new Set(words(text));
  if (!mine.size) return undefined;
  return memories
    .filter((m) => m.status === "retracted")
    .find((m) => {
      const theirs = new Set(words(m.text));
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      return shared / Math.min(mine.size, theirs.size || 1) >= 0.6;
    });
}

/** Why Corgi remembers something: how it got there, the words behind it, what it replaced. */
export async function explainMemory(db: Store, owner: string, memory: MemoryItem) {
  const all = await allMemories(db, owner);
  const byId = new Map(all.map((m) => [m.id, m]));
  const earlier: string[] = [];
  const queue = [...(memory.supersedes ?? [])];
  while (queue.length && earlier.length < 8) {
    const previous = byId.get(queue.shift() as string);
    if (!previous) continue;
    earlier.push(previous.text);
    queue.push(...(previous.supersedes ?? []));
  }
  return {
    text: memory.text,
    since: memory.createdAt,
    how: memory.origin
      ? ORIGIN_LABEL[memory.origin]
      : memory.source
        ? (LEGACY_SOURCE[memory.source] ?? memory.source)
        : "Salvo antes do histórico",
    evidence: (memory.evidence ?? []).map((e) => ({
      conversation: e.thread === "default" ? "chat principal" : e.thread,
      messages: e.from ? (e.to && e.to !== e.from ? `${e.from}–${e.to}` : `${e.from}`) : undefined,
      words: e.quote,
    })),
    replaced: earlier.length ? earlier : undefined,
  };
}

/** The diary of candidates (kept, skipped and why): never shown to the model. */
export async function logMemory(
  db: Store,
  owner: string,
  entry: { text: string; outcome: string; thread?: string; origin: MemoryOrigin },
) {
  const id = new Date().toISOString().slice(0, 10);
  const day = await db.get<{ id: string; entries: unknown[] }>(owner, "memory-log", id);
  const entries = [...(day?.entries ?? []), { ...entry, at: new Date().toISOString() }].slice(-200);
  await db.put(owner, "memory-log", { id, entries });
}

export async function recentLog(db: Store, owner: string, days = 7) {
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  return (
    await db.list<{ id: string; entries: { text: string; outcome: string }[] }>(owner, "memory-log")
  )
    .filter((day) => day.id >= since)
    .flatMap((day) => day.entries);
}

export async function synthesisOf(db: Store, owner: string) {
  return db.get<MemorySynthesis>(owner, "memory-synthesis", "alignment");
}

export async function peopleOf(db: Store, owner: string) {
  return db.list<MemoryPerson>(owner, "people");
}

export async function dreamsOf(db: Store, owner: string, limit = 14) {
  return (await db.list<MemoryDream>(owner, "memory-dreams"))
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, limit);
}

/** People whose name or alias appears in the text (for the turn's context). */
export function peopleMentioned(people: MemoryPerson[], text: string) {
  const lower = ` ${normalize(text)} `;
  return people.filter((person) =>
    [person.name, ...person.aliases].some((name) => {
      const n = normalize(name);
      return n.length > 2 && new RegExp(`[^a-z0-9]${escapeRegex(n)}[^a-z0-9]`).test(lower);
    }),
  );
}

export const personId = (name: string) =>
  createHash("sha256").update(normalize(name)).digest("hex").slice(0, 16);

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clampSalience = (value?: number) =>
  value === undefined ? undefined : Math.max(1, Math.min(10, Math.round(value)));
