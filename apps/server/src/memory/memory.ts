import type { AgentMemory } from "../../../../packages/domain/src/agent.ts";

/** A lasting fact about the person (a "claim"): preference, person, place, routine… */
export type MemoryItem = Omit<AgentMemory, "source" | "createdAt"> & {
  source?: string;
  createdAt?: string;
};

/** Memories in use: not replaced by a newer one and not forgotten. */
export const isActive = (memory: MemoryItem) => (memory.status ?? "active") === "active";

const STOP = new Set(
  "a o e de da do das dos em no na nos nas um uma para pra por com que se meu minha me eu the and for with my to of in on is are".split(
    " ",
  ),
);

export function words(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

/** Short, stable handle the model can use to update or forget a memory. */
export const memoryRef = (memory: MemoryItem) => memory.id.slice(0, 8);

/**
 * What goes into the turn's context: everything while memory is small, then the
 * memories that share words with the request, topped up with the most recent ones.
 */
export function relevantMemories(memories: MemoryItem[], query: string, limit = 30) {
  if (memories.length <= limit) return memories;
  const wanted = new Set(words(query));
  const now = Date.now();
  const ranked = memories
    .map((memory, index) => ({
      memory,
      index,
      score: words(memory.text).filter((word) => wanted.has(word)).length * weight(memory, now),
    }))
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const picked = ranked.filter((entry) => entry.score > 0).slice(0, limit);
  const recent = [...memories]
    .map((memory, index) => ({ memory, index, score: 0 }))
    .reverse()
    .filter((entry) => !picked.some((p) => p.memory.id === entry.memory.id));
  return [...picked, ...recent]
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.memory);
}

/**
 * How much a matching memory counts: what matters more (salience 1–10, default 5) and what is
 * recent (half weight after ~3 months, never below half) come first.
 */
function weight(memory: MemoryItem, now: number) {
  const salience = 0.5 + (memory.salience ?? 5) / 10;
  const days = memory.createdAt ? (now - Date.parse(memory.createdAt)) / 86400000 : 90;
  return salience * Math.max(0.5, 0.5 ** (Math.max(0, days) / 90));
}

/** Resolves a model-supplied handle to exactly one memory, or none. */
export function findMemory(memories: MemoryItem[], ref: string) {
  const matches = memories.filter((memory) => memory.id.startsWith(ref.trim()));
  return matches.length === 1 ? matches[0] : undefined;
}
