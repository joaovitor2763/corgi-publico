// The chat's memory tools, bound to one conversation: remember, correct, forget and explain.
// Each change goes through the memory book, so it keeps its evidence and lineage.
import { createHash } from "node:crypto";
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import type { Store } from "../platform/db.ts";
import type { AskJev } from "../trust/jev.ts";
import {
  activeMemories,
  allMemories,
  correctMemory,
  explainMemory,
  forgetMemory,
  logMemory,
  matchesForgotten,
  saveMemory,
} from "./book.ts";
import { findMemory } from "./memory.ts";
import { judgeMemory } from "./memory-gate.ts";

export function memoryTools(deps: {
  db: Store;
  owner: string;
  jev?: AskJev;
  /** The conversation ("default" = main chat) and its latest message from the person. */
  said: () => Promise<{ thread: string; message?: number; quote?: string }>;
  /** Something read this turn looked like an attack: facts from it are not kept. */
  tainted: () => boolean;
  /** Replays of the same turn save the same memory once. */
  requestKey: string;
}) {
  const { db, owner, jev } = deps;
  const evidence = async () => {
    const said = await deps.said();
    return [
      {
        thread: said.thread,
        from: said.message,
        to: said.message,
        quote: said.quote?.slice(0, 300),
      },
    ];
  };
  return [
    defineTool({
      name: "remember_fact",
      description:
        "Remember a lasting fact the person stated or confirmed about themselves (preference, person, place, routine), in one short sentence in their words. Do not save one-off requests, secrets, passwords or card data. If it replaces something you already know, use update_memory instead.",
      parameters: z.object({ text: z.string().min(1).max(2000) }),
      execute: async ({ text }) => {
        if (deps.tainted()) {
          await logMemory(db, owner, {
            text,
            outcome: "ignorado: veio junto de conteúdo suspeito",
            origin: "chat",
          });
          return {
            saved: false,
            reason:
              "Not saved: this turn read content flagged as suspicious. Ask the person to confirm it in their own words.",
          };
        }
        const all = await allMemories(db, owner);
        const forgotten = matchesForgotten(text, all);
        if (forgotten)
          return {
            saved: false,
            reason: `The person asked to forget this ("${forgotten.text}"). Only save it if they say it again now, explicitly.`,
          };
        // Jev decides whether it is worth keeping, its tag, and whether it updates something
        // already known. Without Jev the fact is kept untagged.
        const verdict = jev
          ? await judgeMemory(jev, text, await activeMemories(db, owner)).catch(() => undefined)
          : undefined;
        if (verdict && !verdict.save) return { saved: false, reason: verdict.reason };
        const replaced = verdict?.save ? verdict.replaces : undefined;
        const saved = await saveMemory(db, owner, {
          id: createHash("sha256").update(`${deps.requestKey}:memory:${text}`).digest("hex"),
          text,
          tag: verdict?.save ? verdict.tag : undefined,
          origin: "chat",
          evidence: await evidence(),
          replaces: replaced ? [replaced] : undefined,
        });
        return {
          saved: true,
          id: saved.id,
          text: saved.text,
          tag: saved.tag,
          previous: replaced?.text,
        };
      },
    }),
    defineTool({
      name: "update_memory",
      description:
        "Correct something you remember when the person says it changed ('na verdade…', 'agora prefiro…'). Use the [ref] shown next to the memory.",
      parameters: z.object({ ref: z.string().min(4).max(64), text: z.string().min(1).max(2000) }),
      execute: async ({ ref, text }) => {
        const memory = findMemory(await activeMemories(db, owner), ref);
        if (!memory) return { error: "No single memory matches that ref" };
        const updated = await correctMemory(db, owner, memory, text, "chat");
        return { text: updated.text, previous: memory.text };
      },
    }),
    defineTool({
      name: "forget_memory",
      description:
        "Forget something when the person asks ('esquece que…', 'não lembra disso'). Use the [ref] shown next to the memory. It leaves every answer at once and is never learned again from old conversations; the person can restore it for 30 days under Memória.",
      parameters: z.object({ ref: z.string().min(4).max(64) }),
      execute: async ({ ref }) => {
        const memory = findMemory(await activeMemories(db, owner), ref);
        if (!memory) return { error: "No single memory matches that ref" };
        await forgetMemory(db, owner, memory);
        return { forgotten: memory.text };
      },
    }),
    defineTool({
      name: "explain_memory",
      description:
        "Why you remember something ('por que você acha que…', 'de onde tirou isso?'): how it was learned, the person's own words and when, and what it replaced. Use the [ref]. Answer in one or two sentences from the result.",
      parameters: z.object({ ref: z.string().min(4).max(64) }),
      execute: async ({ ref }) => {
        const memory = findMemory(await allMemories(db, owner), ref);
        if (!memory) return { error: "No single memory matches that ref" };
        return explainMemory(db, owner, memory);
      },
    }),
  ];
}
