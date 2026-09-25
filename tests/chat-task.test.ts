import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Message } from "@ag-ui/core";
import { createApp } from "../apps/server/src/app.ts";
import { browserFixture } from "./helpers/browser.ts";
import { type PiCall, piModelFixture } from "./helpers/pi-model.ts";

type Reply = string | { calls: PiCall[]; text?: string };
async function setup(t: TestContext, reply: (index: number) => Reply) {
  const fixture = await piModelFixture(t, (index) => {
    const next = reply(index);
    return typeof next === "string" ? { text: next } : next;
  });
  const local = await browserFixture(t, () => ({ data: {} }));
  const server = await createApp(local.db, {
    ...local.config,
    agentBackend: "pi",
    impossiblBaseUrl: fixture.baseUrl,
  });
  t.after(() => server.agent.stop());
  return { ...fixture, ...local, ...server };
}

const userTexts = (body: string) =>
  (JSON.parse(body) as { messages: { role: string; content: unknown }[] }).messages
    .filter((m) => m.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));

test("a task runs as a side chat on the chat engine and finishes with its reply", async (t) => {
  const fixture = await setup(t, () => "Pronto: o convite foi recusado.");
  const task = await fixture.agent.createTask("owner", {
    prompt: "Recuse o convite do encerramento",
  });
  await fixture.agent.worker.tick();
  const done = await fixture.agent.getTask("owner", task.id);
  assert.equal(done.status, "succeeded", done.error ?? undefined);
  assert.equal(done.result, "Pronto: o convite foi recusado.");
  const threadId = done.state.threadId as string;
  const thread = await fixture.db.get<{ taskId: string; title: string }>(
    "owner",
    "threads",
    threadId,
  );
  assert.equal(thread?.taskId, task.id);
  const conversation = await fixture.db.get<{ messages: Message[] }>(
    "owner",
    "conversations",
    threadId,
  );
  assert.deepEqual(
    conversation?.messages.map((m) => m.role),
    ["user", "assistant"],
  );
  assert.match(String(conversation?.messages[0]?.content), /Recuse o convite do encerramento/);
  // The chat prompt, not the old task runner's.
  assert.doesNotMatch(fixture.requests[0]?.body ?? "", /executing a delegated task on the server/);
});

test("after an approval the task continues on its own and never prepares it again", async (t) => {
  const fixture = await setup(t, (index) =>
    index === 0 ? "Preparei a recusa; espera sua aprovação." : "Feito: convite recusado.",
  );
  const task = await fixture.agent.createTask("owner", { prompt: "Recuse o convite" });
  await fixture.agent.worker.tick();
  const first = await fixture.agent.getTask("owner", task.id);
  // What the chat engine records when a change is prepared and then approved by the person.
  const now = new Date().toISOString();
  await fixture.db.put("owner", "actions", {
    id: "decline",
    taskId: task.id,
    title: "Recusar o convite SAVE THE DATE",
    kind: "app.action",
    data: {},
    status: "succeeded",
    result: "Convite recusado",
    hash: "h",
    createdAt: now,
    expiresAt: now,
  });
  await fixture.db.put("owner", "tasks", {
    ...first,
    status: "waiting_approval",
    actionId: "decline",
  });
  await fixture.agent.worker.tick();
  const done = await fixture.agent.getTask("owner", task.id);
  assert.equal(done.status, "succeeded", done.error ?? undefined);
  assert.equal(done.result, "Feito: convite recusado.");
  const told = userTexts(fixture.requests[1]?.body ?? "{}").at(-1) ?? "";
  assert.match(told, /Aprovada e executada: Recusar o convite SAVE THE DATE → Convite recusado/);
  // Reported once: another round does not repeat it.
  await fixture.agent.worker.tick();
  assert.equal(fixture.requests.length, 2);
  // The note says what ran; the guidance for the model is marked to stay hidden in the app.
  assert.match(told, /\n\n» Marque como done a etapa que foi aprovada/);
  // Only the newest word from the task is unread: its second completion, not the first.
  const unread = (
    await fixture.db.list<{ taskId?: string; read: boolean; body: string }>(
      "owner",
      "notifications",
    )
  ).filter((n) => n.taskId === task.id && !n.read);
  assert.deepEqual(
    unread.map((n) => n.body),
    ["Feito: convite recusado."],
  );
});

test("a task that ends on a question waits, and the answer reaches it as the person's words", async (t) => {
  const fixture = await setup(t, (index) =>
    index === 0 ? "Achei dois convites no dia 25.\n\nQual deles devo recusar?" : "Recusado.",
  );
  const task = await fixture.agent.createTask("owner", { prompt: "Limpe minha agenda de amanhã" });
  await fixture.agent.worker.tick();
  const waiting = await fixture.agent.getTask("owner", task.id);
  assert.equal(waiting.status, "waiting_input");
  assert.equal(waiting.question, "Qual deles devo recusar?");
  await fixture.agent.answer("owner", task.id, "O do encerramento");
  await fixture.agent.worker.tick();
  const done = await fixture.agent.getTask("owner", task.id);
  assert.equal(done.status, "succeeded", done.error ?? undefined);
  assert.equal(userTexts(fixture.requests[1]?.body ?? "{}").at(-1), "O do encerramento");
});

test("the app waits on a task's side chat from the moment it is queued until its turn is saved", async (t) => {
  const fixture = await setup(t, () => "Resultado da pesquisa.");
  const session = await fixture.app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const auth = { Authorization: `Bearer ${(await session.json()).token}` };
  const task = await fixture.agent.createTask("local-user", { prompt: "Pesquise a Nuvem Labs" });
  await fixture.agent.worker.tick();
  const threadId = (await fixture.agent.getTask("local-user", task.id)).state.threadId as string;
  const page = async () =>
    (await fixture.app.request(`/api/conversation?thread=${threadId}`, { headers: auth })).json();
  const finished = await page();
  assert.equal(finished.running, false);
  assert.deepEqual(
    finished.messages.map((m: { role: string }) => m.role),
    ["user", "assistant"],
  );
  // Queued again (an answer or an approval): the open side chat keeps waiting for it.
  const current = await fixture.agent.getTask("local-user", task.id);
  await fixture.db.put("local-user", "tasks", { ...current, status: "queued" });
  assert.equal((await page()).running, true);
});

const todos = (items: [string, string][]) => ({
  name: "update_todos",
  arguments: { todos: items.map(([text, status]) => ({ text, status })) },
});

test("a task with open steps is not done: it continues from its checklist and notes", async (t) => {
  const fixture = await setup(t, (index) =>
    index === 0
      ? {
          calls: [
            todos([
              ["Ler o convite", "done"],
              ["Recusar o convite", "in_progress"],
              ["Avisar o organizador", "pending"],
            ]),
            { name: "write_notes", arguments: { text: "Convite: evento abc123" } },
          ],
        }
      : index === 1
        ? "Feito."
        : index === 2
          ? {
              calls: [
                todos([
                  ["Ler o convite", "done"],
                  ["Recusar o convite", "done"],
                  ["Avisar o organizador", "done"],
                ]),
              ],
            }
          : "Tudo feito: convite recusado e organizador avisado.",
  );
  const task = await fixture.agent.createTask("owner", { prompt: "Limpe minha agenda" });
  await fixture.agent.worker.tick();
  const first = await fixture.agent.getTask("owner", task.id);
  assert.equal(first.status, "queued", "open steps: not succeeded");
  assert.deepEqual(
    first.plan.map((step) => step.status),
    ["succeeded", "running", "pending"],
  );
  await fixture.agent.worker.tick();
  const done = await fixture.agent.getTask("owner", task.id);
  assert.equal(done.status, "succeeded", done.question ?? done.error ?? undefined);
  assert.equal(done.result, "Tudo feito: convite recusado e organizador avisado.");
  // The next round was told what is left and saw its checklist and notes.
  const body = fixture.requests[2]?.body ?? "";
  assert.match(body, /Ainda faltam: Recusar o convite; Avisar o organizador/);
  assert.match(body, /# Your checklist \(1\/3\)/);
  assert.match(body, /# Your working notes \(this conversation\)\\nConvite: evento abc123/);
});

test("a turn that stops mid-work is continued, and after two tries the person hears what is left", async (t) => {
  const fixture = await setup(t, () => ({
    calls: [todos([["Pesquisar a Nuvem Labs", "in_progress"]])],
  }));
  const task = await fixture.agent.createTask("owner", { prompt: "Pesquise a Nuvem Labs" });
  for (let round = 0; round < 3; round++) await fixture.agent.worker.tick();
  const stuck = await fixture.agent.getTask("owner", task.id);
  assert.equal(stuck.status, "waiting_input");
  assert.match(stuck.question ?? "", /Não consegui concluir: Pesquisar a Nuvem Labs/);
});

test("background turns on automatic think on every step", async (t) => {
  const fixture = await setup(t, (index) =>
    index === 0 ? { calls: [todos([["Uma etapa", "in_progress"]])] } : "Pronto.",
  );
  await fixture.agent.createTask("owner", { prompt: "Qualquer coisa" });
  await fixture.agent.worker.tick();
  const bodies = fixture.requests.map((r) => JSON.parse(r.body));
  assert.equal(bodies[0]?.model, "meta/muse-spark-1.3-contributor");
  assert.ok(
    bodies.every((b) => b.reasoning_effort === "medium"),
    "nobody is waiting: it thinks",
  );
  // Impossibl has no cache-key or routing field: nothing undocumented goes out.
  assert.doesNotMatch(fixture.requests[0]?.body ?? "", /prompt_cache_key/);
});

test("a skill named in a task's request stays with it on every round", async (t) => {
  const { saveSkill } = await import("../apps/server/src/skills/skills.ts");
  const fixture = await setup(t, (index) =>
    index === 0 ? { calls: [todos([["Rodar o report", "in_progress"]])] } : "Report enviado.",
  );
  await saveSkill(fixture.db, "owner", {
    name: "coortes-mensais",
    title: "Report de coortes",
    instructions: "Use o warehouse X e a tabela Y.",
    apps: [],
  });
  await fixture.agent.createTask("owner", { prompt: "Rode o report via @coortes-mensais" });
  await fixture.agent.worker.tick();
  await fixture.agent.worker.tick();
  // Round 2 starts from the worker's "continue" note, and still carries the skill.
  const second = fixture.requests.find((r) => r.body.includes("Ainda faltam"))?.body ?? "";
  assert.ok(second, "a continue round ran");
  assert.match(second, /# Skill @coortes-mensais/);
});
