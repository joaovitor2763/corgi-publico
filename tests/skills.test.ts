import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/platform/db.ts";
import {
  deleteSkill,
  invokedSkills,
  listSkills,
  saveSkill,
  skillContext,
} from "../apps/server/src/skills/skills.ts";
import { type AskJev, relevant } from "../apps/server/src/trust/jev.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close();
});

test("@names in a message invoke skills; unknown ones and emails don't", async () => {
  const skills = await listSkills(db, "s1");
  const names = (text: string) => invokedSkills(text, skills).map((s) => s.name);
  assert.deepEqual(names("@ads da semana e depois @post").sort(), ["ads", "post"]);
  assert.deepEqual(names("@ads da semana").sort(), ["ads"]);
  assert.deepEqual(names("manda pra ana@empresa.com"), [], "an email address is not a skill");
  assert.deepEqual(names("@naoexiste oi"), []);
});

test("the person's skills are saved, override built-ins, and can be deleted", async () => {
  await saveSkill(db, "s2", {
    name: "Relatorio-Vendas",
    title: "Relatório de vendas",
    instructions: "Leia o HubSpot e monte a tabela do pipeline por etapa.",
    apps: ["hubspot"],
  });
  await saveSkill(db, "s2", {
    name: "ads",
    title: "Meu ads",
    instructions: "Minha versão do relatório de anúncios, só Google Ads.",
  });
  const skills = await listSkills(db, "s2");
  assert.equal(skills.find((s) => s.name === "relatorio-vendas")?.title, "Relatório de vendas");
  assert.equal(skills.filter((s) => s.name === "ads").length, 1);
  assert.equal(
    skills.find((s) => s.name === "ads")?.builtIn,
    undefined,
    "the person's version wins",
  );
  await deleteSkill(db, "s2", "relatorio-vendas");
  await assert.rejects(deleteSkill(db, "s2", "briefing"), /suas próprias/);
  assert.ok(!(await listSkills(db, "s2")).some((s) => s.name === "relatorio-vendas"));
});

test("an invoked skill's context says which of its apps are missing", async () => {
  const [ads] = invokedSkills("@ads", await listSkills(db, "s3"));
  const none = skillContext([ads], ["gmail"]);
  assert.match(none, /# Skill @ads/);
  assert.match(none, /None of its apps are connected/);
  const some = skillContext([ads], ["googleads"]);
  assert.match(some, /Not connected .*google_analytics/);
});

test("Jev as a filter keeps the few candidates that fit, best first, and fails open", async () => {
  const ask: AskJev = async (_state, questions) =>
    Object.fromEntries(
      Object.entries(questions).map(([id, q]) => [
        id,
        { noul: /maps/.test(q.instructions) ? 0.9 : /calendar/.test(q.instructions) ? 0.6 : 0.1 },
      ]),
    );
  const apps = ["gmail", "googlecalendar", "google_maps", "slack", "notion"].map((id) => ({
    id,
    text: id,
  }));
  assert.deepEqual(await relevant(ask, "quanto tempo até a reunião?", apps), [
    "google_maps",
    "googlecalendar",
  ]);
  const broken: AskJev = async () => {
    throw new Error("down");
  };
  assert.equal(await relevant(broken, "x", apps), undefined, "callers fall back to all");
  assert.deepEqual(await relevant(ask, "x", apps.slice(0, 2)), ["gmail", "googlecalendar"]);
});
