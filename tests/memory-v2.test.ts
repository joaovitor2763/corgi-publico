import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@ag-ui/core";
import {
  activeMemories,
  allMemories,
  explainMemory,
  forgetMemory,
  matchesForgotten,
  peopleMentioned,
  purgeForgotten,
  restoreMemory,
  saveMemory,
} from "../apps/server/src/memory/book.ts";
import {
  parseCandidates,
  quoteIsTheirs,
  reviewConversations,
} from "../apps/server/src/memory/consolidate.ts";
import { dream, localDay, validateOps } from "../apps/server/src/memory/dream.ts";
import { memoryRef } from "../apps/server/src/memory/memory.ts";
import { memoryTools } from "../apps/server/src/memory/tools.ts";
import { memoryUpkeep } from "../apps/server/src/memory/upkeep.ts";
import { createStore } from "../apps/server/src/platform/db.ts";
import type { AskJev } from "../apps/server/src/trust/jev.ts";

const user = (content: string, id = content): Message => ({ id, role: "user", content });
const assistant = (content: string): Message => ({
  id: `a-${content}`,
  role: "assistant",
  content,
});

/** Jev that keeps everything new and sees no duplicates. */
const keepAll: AskJev = async (_state, questions) =>
  Object.fromEntries(
    Object.keys(questions).map((key) => [
      key,
      key === "tag"
        ? { choice: "preference" }
        : key === "same"
          ? { choice: "none" }
          : { noul: key === "lasting" ? 0.9 : 0.1 },
    ]),
  );

test("a correction supersedes, a forget retracts, and both keep the lineage", async () => {
  const db = await createStore();
  const first = await saveMemory(db, "o", { text: "Prefere reuniões de manhã", origin: "chat" });
  const second = await saveMemory(db, "o", {
    text: "Prefere reuniões à tarde",
    origin: "chat",
    replaces: [first],
    evidence: [{ thread: "default", from: 12, to: 12, quote: "agora prefiro à tarde" }],
  });
  assert.deepEqual(
    (await activeMemories(db, "o")).map((m) => m.text),
    ["Prefere reuniões à tarde"],
  );
  const old = (await allMemories(db, "o")).find((m) => m.id === first.id);
  assert.equal(old?.status, "superseded");
  assert.equal(old?.supersededBy, second.id);
  const why = await explainMemory(db, "o", second);
  assert.equal(why.how, "Você disse no chat");
  assert.deepEqual(why.replaced, ["Prefere reuniões de manhã"]);
  assert.equal(why.evidence[0]?.messages, "12");
  assert.equal(why.evidence[0]?.conversation, "chat principal");

  await forgetMemory(db, "o", second);
  assert.equal((await activeMemories(db, "o")).length, 0);
  assert.ok(matchesForgotten("prefere reunioes a tarde", await allMemories(db, "o")));
  assert.equal((await restoreMemory(db, "o", second.id))?.status, "active");
  await forgetMemory(db, "o", second);
  assert.equal(await purgeForgotten(db, Date.now() + 29 * 86400000), 0, "restorable for 30 days");
  assert.equal(await purgeForgotten(db, Date.now() + 31 * 86400000), 1);
});

test("people are found by name or alias, accents and case aside", () => {
  const people = [
    { id: "1", name: "Ana Souza", aliases: ["Ana"], notes: [], updatedAt: "" },
    { id: "2", name: "Zé", aliases: ["José Lima"], notes: [], updatedAt: "" },
  ];
  assert.deepEqual(
    peopleMentioned(people, "marca com a ana amanhã").map((p) => p.id),
    ["1"],
  );
  assert.deepEqual(
    peopleMentioned(people, "Fala com o JOSE LIMA").map((p) => p.id),
    ["2"],
  );
  assert.deepEqual(peopleMentioned(people, "banana"), [], "no match inside other words");
});

test("the review keeps only the person's own words, never task chats, and reads each message once", async () => {
  const db = await createStore();
  await db.put("o", "conversations", {
    id: "default",
    messages: [
      user("oi"),
      assistant("Olá!"),
      user("Pode lembrar: eu nunca marco nada antes das 9h"),
      assistant("Anotado."),
    ],
  });
  const task = "11111111-1111-1111-1111-111111111111";
  await db.put("o", "threads", { id: task, taskId: "t1" });
  await db.put("o", "conversations", { id: task, messages: [user("Faça a pesquisa X")] });
  const prompts: string[] = [];
  const extract = async (prompt: string) => {
    prompts.push(prompt);
    return JSON.stringify({
      facts: [
        {
          text: "Nunca marca nada antes das 9h",
          quote: "nunca marco nada antes das 9h",
          from: 3,
          to: 3,
          salience: 8,
        },
        { text: "Mora em Recife", quote: "moro em Recife", from: 3, to: 3 },
      ],
    });
  };
  const kept = await reviewConversations({ db, owner: "o", extract, jev: keepAll });
  assert.deepEqual(kept, ["Nunca marca nada antes das 9h"]);
  assert.equal(prompts.length, 1, "the task chat is not read");
  assert.match(prompts[0] ?? "", /\[3\] Pessoa: Pode lembrar/);
  const [memory] = await activeMemories(db, "o");
  assert.equal(memory?.origin, "review");
  assert.equal(memory?.salience, 8);
  assert.deepEqual(memory?.evidence, [
    { thread: "default", from: 3, to: 3, quote: "nunca marco nada antes das 9h" },
  ]);
  const log = await db.list<{ entries: { text: string; outcome: string }[] }>("o", "memory-log");
  assert.ok(
    log[0]?.entries.some((e) => e.text === "Mora em Recife" && /não são palavras/.test(e.outcome)),
  );
  // Nothing new since: the next review reads nothing.
  await reviewConversations({ db, owner: "o", extract, jev: keepAll });
  assert.equal(prompts.length, 1);
});

test("the review never learns again what the person forgot, and keeps nothing without Jev", async () => {
  const db = await createStore();
  const old = await saveMemory(db, "o", { text: "Gosta de café sem açúcar", origin: "chat" });
  await forgetMemory(db, "o", old);
  await db.put("o", "conversations", {
    id: "default",
    messages: [user("gosto de café sem açúcar"), user("e trabalho na empresa Alfa")],
  });
  const extract = async () =>
    JSON.stringify({
      facts: [
        { text: "Gosta de café sem açúcar", quote: "gosto de café sem açúcar", from: 1, to: 1 },
        { text: "Trabalha na empresa Alfa", quote: "trabalho na empresa Alfa", from: 2, to: 2 },
      ],
    });
  assert.deepEqual(await reviewConversations({ db, owner: "o", extract }), []);
  assert.equal((await activeMemories(db, "o")).length, 0, "without Jev only the diary gets it");
});

test("candidate parsing tolerates prose and rejects malformed facts", () => {
  assert.deepEqual(parseCandidates("nada"), []);
  const parsed = parseCandidates(
    'Claro: ```json\n{"facts":[{"text":"A","quote":"q","from":1,"to":1},{"text":"B"}]}\n```',
  );
  assert.equal(parsed.length, 1);
  assert.ok(
    quoteIsTheirs({ text: "x", quote: "Olá  Mundo", from: 1, to: 1 }, [user("olá mundo!")]),
  );
  assert.ok(
    !quoteIsTheirs({ text: "x", quote: "olá mundo", from: 1, to: 1 }, [assistant("olá mundo")]),
  );
});

test("the reflection's operations are validated before anything changes", async () => {
  const db = await createStore();
  const memories = [];
  for (const text of [
    "Prefere e-mail",
    "Prefere e-mails curtos",
    "Mora em SP",
    "Tem um cachorro",
    "Corre às terças",
    "Gosta de jazz",
    "Trabalha com vendas",
    "Tem dois filhos",
  ])
    memories.push(await saveMemory(db, "o", { text, origin: "chat" }));
  const [email, shortEmail, sp, dog] = memories.map(memoryRef);
  const { accepted, rejected } = validateOps(memories, [
    { op: "merge", refs: [email as string, shortEmail as string], text: "Prefere e-mails curtos" },
    { op: "retire", ref: email as string }, // already used
    { op: "supersede", ref: "unknown", text: "x x x x" },
    { op: "retire", ref: sp as string },
    { op: "retire", ref: dog as string }, // over the 25% budget (2 of 8)
  ]);
  assert.equal(accepted.length, 2, "8 memories → at most 2 lost per night");
  assert.equal(rejected, 3);
});

test("a night of reflection merges, writes the alignment and people, and respects a pinned alignment", async () => {
  const db = await createStore();
  const a = await saveMemory(db, "o", {
    text: "Prefere e-mail",
    origin: "chat",
    evidence: [{ thread: "default", from: 2 }],
  });
  const b = await saveMemory(db, "o", { text: "Gosta de e-mails curtos", origin: "review" });
  for (const text of ["Mora em SP", "Tem um cachorro", "Corre às terças", "Gosta de jazz"])
    await saveMemory(db, "o", { text, origin: "chat" });
  const think = async (prompt: string) => {
    assert.match(prompt, /\[.{8}\] Prefere e-mail/);
    return JSON.stringify({
      ops: [{ op: "merge", refs: [memoryRef(a), memoryRef(b)], text: "Prefere e-mails curtos" }],
      alignment: {
        reply: "Respostas curtas.",
        limits: "Nunca enviar sem aprovação.",
        friction: ["Tarefas longas demais"],
        week: "Semana de fechamento.",
      },
      people: [
        { name: "Ana Souza", aliases: ["Ana"], relation: "sócia", notes: ["Prefere Slack"] },
      ],
      diary: "Aprendi que ele gosta de brevidade.",
    });
  };
  const night = new Date("2026-09-25T07:00:00Z");
  const record = await dream({ db, owner: "o", think, now: night });
  assert.equal(record.merged, 1);
  assert.equal(record.id, "2026-09-25");
  const merged = (await activeMemories(db, "o")).find((m) => m.text === "Prefere e-mails curtos");
  assert.equal(merged?.origin, "reflection");
  assert.deepEqual(merged?.supersedes?.sort(), [a.id, b.id].sort());
  assert.deepEqual(merged?.evidence, [{ thread: "default", from: 2 }]);
  const alignment = await db.get<{ id: string; reply: string }>(
    "o",
    "memory-synthesis",
    "alignment",
  );
  assert.equal(alignment?.reply, "Respostas curtas.");
  const [ana] = await db.list<{ name: string; relation: string }>("o", "people");
  assert.equal(ana?.relation, "sócia");

  await db.put("o", "memory-synthesis", {
    ...(alignment as { id: string }),
    reply: "Do meu jeito.",
    pinned: true,
  });
  await dream({ db, owner: "o", think, now: new Date("2026-09-26T07:00:00Z") });
  assert.equal(
    (await db.get<{ reply: string }>("o", "memory-synthesis", "alignment"))?.reply,
    "Do meu jeito.",
    "a pinned alignment is the person's; the reflection leaves it",
  );
});

test("upkeep reviews at most hourly and reflects once per local night from 3h", async () => {
  const db = await createStore();
  await saveMemory(db, "o", { text: "Mora em SP", origin: "chat" });
  await db.put("o", "conversations", { id: "default", messages: [user("oi")] });
  let reviews = 0;
  let dreams = 0;
  const run = (iso: string) =>
    memoryUpkeep({
      db,
      owners: ["o"],
      timeZone: "America/Sao_Paulo",
      extract: async () => {
        reviews += 1;
        return '{"facts":[]}';
      },
      think: async () => {
        dreams += 1;
        return "{}";
      },
      now: new Date(iso),
    });
  await run("2026-09-25T04:30:00Z"); // 01:30 in São Paulo
  assert.deepEqual([reviews, dreams], [1, 0]);
  await db.put("o", "conversations", { id: "default", messages: [user("oi"), user("de novo")] });
  await run("2026-09-25T05:00:00Z"); // 02:00, 30 min later
  assert.deepEqual([reviews, dreams], [1, 0], "not before an hour");
  await run("2026-09-25T06:10:00Z"); // 03:10
  assert.deepEqual([reviews, dreams], [2, 1]);
  await run("2026-09-25T09:00:00Z"); // 06:00 same day
  assert.equal(dreams, 1, "once per night");
  assert.equal(localDay(new Date("2026-09-25T02:00:00Z")), "2026-09-24");
});

test("chat memory tools: tainted turns don't save, forget is never re-learned, explain answers", async () => {
  const db = await createStore();
  let tainted = true;
  const tools = memoryTools({
    db,
    owner: "o",
    requestKey: "r1",
    tainted: () => tainted,
    said: async () => ({ thread: "default", message: 7, quote: "eu moro em Recife" }),
  }) as unknown as { name: string; execute: (args: unknown) => Promise<Record<string, unknown>> }[];
  const tool = (name: string) => tools.find((t) => t.name === name) as (typeof tools)[number];
  assert.equal((await tool("remember_fact").execute({ text: "Mora em Recife" })).saved, false);
  tainted = false;
  const saved = await tool("remember_fact").execute({ text: "Mora em Recife" });
  assert.equal(saved.saved, true);
  const [memory] = await activeMemories(db, "o");
  assert.deepEqual(memory?.evidence, [
    { thread: "default", from: 7, to: 7, quote: "eu moro em Recife" },
  ]);
  const ref = memoryRef(memory as never);
  const why = await tool("explain_memory").execute({ ref });
  assert.equal(why.how, "Você disse no chat");
  assert.deepEqual(await tool("forget_memory").execute({ ref }), { forgotten: "Mora em Recife" });
  const again = await tool("remember_fact").execute({ text: "mora em recife" });
  assert.equal(again.saved, false);
  assert.match(String(again.reason), /asked to forget/);
});
