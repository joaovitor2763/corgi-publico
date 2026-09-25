import assert from "node:assert/strict";
import test from "node:test";
import { findMemory, relevantMemories } from "../apps/server/src/memory/memory.ts";

const memory = (id: string, text: string) => ({ id, text });

test("small memory is sent whole", () => {
  const all = [memory("a1", "Gosta de poke"), memory("b2", "Mora em Pinheiros")];
  assert.deepEqual(relevantMemories(all, "qualquer coisa"), all);
});

test("large memory sends what matches the request, topped up with recent ones", () => {
  const all = Array.from({ length: 50 }, (_, i) => memory(`m${i}`, `Fato número ${i}`));
  all[3] = memory("cine", "Prefere cinemas VIP no Iguatemi");
  const picked = relevantMemories(all, "horários de cinema VIP hoje", 5);
  assert.equal(picked.length, 5);
  assert.ok(picked.some((m) => m.id === "cine"));
  assert.ok(picked.some((m) => m.id === "m49"));
});

test("a memory ref must match exactly one memory", () => {
  const all = [memory("abcd1234x", "A"), memory("abcd9999y", "B")];
  assert.equal(findMemory(all, "abcd1234")?.text, "A");
  assert.equal(findMemory(all, "abcd"), undefined);
});

test("the memory gate refuses secrets, keeps tags and updates instead of duplicating", async () => {
  const { judgeMemory } = await import("../apps/server/src/memory/memory-gate.ts");
  const existing = [{ id: "home1234", text: "Mora perto da Faria Lima" }];
  const ask = (answers: Record<string, unknown>[]) => {
    let call = 0;
    return async () => answers[call++] as never;
  };
  assert.deepEqual(
    await judgeMemory(ask([{ sensitive: { noul: 0.9 }, lasting: { noul: 0.9 } }]), "senha 123", []),
    {
      save: false,
      reason:
        "Dados sensíveis (senhas, números de cartão ou documento, diagnósticos) nunca são guardados.",
    },
  );
  const moved = await judgeMemory(
    ask([
      {
        sensitive: { noul: 0 },
        lasting: { noul: 0.9 },
        tag: { choice: "place" },
        same: { choice: "m_home1234" },
      },
      { replaces: { noul: 0.9 } },
    ]),
    "Agora moro em Moema",
    existing,
  );
  assert.deepEqual(moved, { save: true, tag: "place", replaces: existing[0] });
  const repeat = await judgeMemory(
    ask([
      {
        sensitive: { noul: 0 },
        lasting: { noul: 0.9 },
        tag: { choice: "place" },
        same: { choice: "m_home1234" },
      },
      { replaces: { noul: 0.1 } },
    ]),
    "Moro perto da Faria Lima",
    existing,
  );
  assert.equal(repeat.save, false);
});
