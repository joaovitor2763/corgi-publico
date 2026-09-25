// Jev (TypeSafe's System One decision model, via Impossibl) judges memory: whether a
// fact is worth keeping, whether it is sensitive, its tag, whether it repeats something
// already known, and which memories matter for a request. One fast call per decision.
import type { AskJev } from "../trust/jev.ts";
import { type MemoryItem, memoryRef } from "./memory.ts";

export const MEMORY_TAGS = [
  "preference",
  "person",
  "place",
  "routine",
  "work",
  "health",
  "finance",
  "other",
] as const;
export type MemoryTag = (typeof MEMORY_TAGS)[number];

export type MemoryVerdict =
  | { save: true; tag: MemoryTag; replaces?: MemoryItem }
  | { save: false; reason: string };

export async function judgeMemory(
  ask: AskJev,
  text: string,
  existing: MemoryItem[],
): Promise<MemoryVerdict> {
  const candidates = existing.slice(-200);
  const answers = await ask(
    {
      new_memory: text,
      existing_memories: candidates.map((m) => ({ ref: memoryRef(m), text: m.text })),
    },
    {
      lasting: {
        type: "noul",
        instructions:
          "The new memory is a lasting fact or preference about the person that will still be true and useful in future conversations",
        criteria: {
          true: "A stable preference, relationship, place, routine, goal or personal fact",
          false:
            "A one-off request, a passing mood, a task for today, or trivia not about the person",
        },
      },
      sensitive: {
        type: "noul",
        instructions:
          "The new memory contains a secret: a password, PIN or login code, a card or bank account number, a government ID number, or a medical diagnosis or medication",
        criteria: {
          true: "Contains such a secret",
          false:
            "Contains no secret. Allergies, diets, food restrictions and fitness habits are useful preferences, not secrets",
        },
      },
      tag: {
        type: "choice",
        instructions: "Which kind of memory is this?",
        criteria: {
          preference: "Likes, dislikes, tastes and preferences",
          person: "Family, friends, colleagues and relationships",
          place: "Home area, work location, favorite places",
          routine: "Habits, schedules and recurring plans",
          work: "Job, company, projects and professional context",
          health: "Fitness, diet, allergies and wellbeing (no diagnoses)",
          finance: "Budgets, spending habits, financial goals (no account numbers)",
          other: "Anything else",
        },
      },
      ...(candidates.length
        ? {
            same: {
              type: "choice" as const,
              instructions:
                "Does the new memory repeat, update or contradict one of the existing memories? Pick it, or none.",
              criteria: {
                none: "It is about something not covered by any existing memory",
                ...Object.fromEntries(
                  candidates.map((m) => [`m_${memoryRef(m)}`, m.text.slice(0, 200)]),
                ),
              },
            },
          }
        : {}),
    },
  );
  if ((answers.sensitive?.noul ?? 0) > 0.5)
    return {
      save: false,
      reason:
        "Dados sensíveis (senhas, números de cartão ou documento, diagnósticos) nunca são guardados.",
    };
  if ((answers.lasting?.noul ?? 1) < 0.35)
    return { save: false, reason: "Não é um fato duradouro sobre a pessoa; nada foi salvo." };
  const tag = (MEMORY_TAGS as readonly string[]).includes(answers.tag?.choice ?? "")
    ? (answers.tag?.choice as MemoryTag)
    : "other";
  const same = answers.same?.choice;
  const match =
    same && same !== "none" ? candidates.find((m) => `m_${memoryRef(m)}` === same) : undefined;
  if (!match) return { save: true, tag };
  // Second, focused look at the pair: a move or a changed preference replaces the old
  // memory; a restatement of part of it must not overwrite the fuller version.
  const pair = await ask(
    { existing_memory: match.text, new_memory: text },
    {
      replaces: {
        type: "noul",
        instructions:
          "The new memory states something different from the existing one, so the existing one is now outdated",
        criteria: {
          true: "Different value: moved, changed preference, new job, new detail that contradicts",
          false: "Same meaning, or only repeats part of the existing memory",
        },
      },
    },
  );
  return (pair.replaces?.noul ?? 0) > 0.5
    ? { save: true, tag, replaces: match }
    : { save: false, reason: `Já sabia disso: "${match.text}"` };
}

/** One call, one yes/no per candidate: which memories matter for this request. */
export async function pickRelevant(ask: AskJev, request: string, candidates: MemoryItem[]) {
  if (!candidates.length) return [];
  const questions = Object.fromEntries(
    candidates.map((memory, index) => [
      `m${index}`,
      {
        type: "noul" as const,
        instructions: `This memory helps answer or personalize the request: "${memory.text.slice(0, 200)}"`,
        criteria: { true: "Relevant to the request", false: "Unrelated to the request" },
      },
    ]),
  );
  const answers = await ask({ request }, questions);
  return candidates.filter((_, index) => (answers[`m${index}`]?.noul ?? 0) > 0.5);
}
