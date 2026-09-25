import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Message } from "@ag-ui/core";
import { createApp } from "../apps/server/src/app.ts";
import {
  createFuzzy,
  deleteFuzzy,
  fuzzyByName,
  runFuzzy,
  updateFuzzy,
} from "../apps/server/src/fuzzies/fuzzies.ts";
import { allowedForFuzzy, fuzzyRunTools } from "../apps/server/src/fuzzies/tools.ts";
import { createStore } from "../apps/server/src/platform/db.ts";
import type { AgentNotification, Fuzzy } from "../packages/domain/src/agent.ts";
import { browserFixture } from "./helpers/browser.ts";
import { type PiCall, piModelFixture } from "./helpers/pi-model.ts";

const TZ = "America/Sao_Paulo";
const radar = {
  name: "Radar",
  emoji: "📡",
  mission: "Avisar o que precisa da pessoa no Slack",
  apps: ["slack"],
  web: false,
  schedule: { days: [1, 2, 3, 4, 5], time: "09:00" },
  maxRunsPerDay: 2,
};

async function deps() {
  const db = await createStore();
  const created: { input: Record<string, unknown>; prompt: string }[] = [];
  const followUps: string[] = [];
  let n = 0;
  return {
    db,
    created,
    followUps,
    timeZone: TZ,
    createTask: async (
      _owner: string,
      input: { prompt: string; input: Record<string, unknown> },
    ) => {
      created.push(input);
      const task = { id: `t${++n}`, status: "queued" };
      await db.put("o", "tasks", task);
      return task as never;
    },
    followUp: async (_owner: string, taskId: string, text: string) => {
      followUps.push(`${taskId}:${text}`);
    },
  };
}

test("a helper gets its own conversation, renamed with it and archived when deleted", async () => {
  const d = await deps();
  const fuzzy = await createFuzzy(d, "o", radar);
  const thread = await d.db.get<{ fuzzyId: string; title: string }>("o", "threads", fuzzy.threadId);
  assert.equal(thread?.fuzzyId, fuzzy.id);
  assert.equal(thread?.title, "📡 Radar");
  assert.ok(fuzzy.nextRunAt, "a schedule gives it a next run");
  await updateFuzzy(d, "o", fuzzy.id, { name: "Radar de clientes" });
  assert.equal(
    (await d.db.get<{ title: string }>("o", "threads", fuzzy.threadId))?.title,
    "📡 Radar de clientes",
  );
  assert.equal((await fuzzyByName(d.db, "o", "radar de CLIENTES"))?.id, fuzzy.id);
  await updateFuzzy(d, "o", fuzzy.id, { schedule: null });
  assert.equal((await d.db.get<Fuzzy>("o", "fuzzies", fuzzy.id))?.nextRunAt, undefined);
  await deleteFuzzy(d.db, "o", fuzzy.id);
  const archived = await d.db.get<{ archived: boolean }>("o", "threads", fuzzy.threadId);
  assert.equal(archived?.archived, true, "its conversation stays readable");
});

test("runs respect the daily budget, never overlap on schedule, and requests join a running round", async () => {
  const d = await deps();
  const fuzzy = await createFuzzy(d, "o", radar);
  const first = await runFuzzy(d, "o", fuzzy.id, { request: "Algo do cliente X?" });
  assert.equal(first.started, true);
  assert.deepEqual(d.created[0]?.input, { fuzzyId: fuzzy.id, from: "person", asked: true });
  // Still queued: a scheduled run skips, a request joins it.
  await d.db.put("o", "fuzzies", {
    ...((await d.db.get<Fuzzy>("o", "fuzzies", fuzzy.id)) as Fuzzy),
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.deepEqual(await runFuzzy(d, "o", fuzzy.id, { due: true }), {
    started: false,
    reason: "a rodada anterior ainda está em andamento",
  });
  assert.ok(
    Date.parse((await d.db.get<Fuzzy>("o", "fuzzies", fuzzy.id))?.nextRunAt ?? "") > Date.now(),
    "the scheduled slot is claimed and moved forward",
  );
  const joined = await runFuzzy(d, "o", fuzzy.id, { request: "e o Y?" });
  assert.deepEqual(joined, { started: true, taskId: "t1", followUp: true });
  assert.deepEqual(d.followUps, ["t1:e o Y?"]);
  await d.db.put("o", "tasks", { id: "t1", status: "succeeded" });
  assert.equal((await runFuzzy(d, "o", fuzzy.id)).started, true);
  await d.db.put("o", "tasks", { id: "t2", status: "succeeded" });
  const over = await runFuzzy(d, "o", fuzzy.id);
  assert.equal(over.started, false);
  assert.match((over as { reason: string }).reason, /limite de 2 rodadas/);
  await updateFuzzy(d, "o", fuzzy.id, { status: "paused" });
  await d.db.put("o", "fuzzies", {
    ...((await d.db.get<Fuzzy>("o", "fuzzies", fuzzy.id)) as Fuzzy),
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.deepEqual(await runFuzzy(d, "o", fuzzy.id, { due: true }), {
    started: false,
    reason: "pausado",
  });
});

test("a helper never gets Corgi's powers, and web tools only when allowed", () => {
  const allowed = allowedForFuzzy({ web: false } as Fuzzy);
  for (const name of [
    "delegate_task",
    "create_routine",
    "remember_fact",
    "request_checkout",
    "ask_fuzzy",
  ])
    assert.equal(allowed(name), false, name);
  assert.equal(allowed("browser_task"), false);
  assert.equal(allowed("use_app_tool"), true);
  assert.equal(allowedForFuzzy({ web: true } as Fuzzy)("browser_task"), true);
});

test("report_finding notifies only news, once; learn_fact keeps a fact once", async () => {
  const d = await deps();
  const fuzzy = await createFuzzy(d, "o", radar);
  const sent: string[] = [];
  const tools = fuzzyRunTools({
    db: d.db,
    owner: "o",
    fuzzyId: fuzzy.id,
    taskId: "t1",
    notify: async (title) => {
      sent.push(title);
    },
  }) as unknown as { name: string; execute: (a: unknown) => Promise<Record<string, unknown>> }[];
  const [learnFact, report] = tools;
  await learnFact?.execute({ text: "Clientes prioritários: Alfa e Beta" });
  await learnFact?.execute({ text: "clientes prioritários: alfa e beta" });
  assert.equal((await d.db.get<Fuzzy>("o", "fuzzies", fuzzy.id))?.learned.length, 1);
  await report?.execute({ notify: false, headline: "Nada novo" });
  await report?.execute({ notify: true, headline: "Alfa pediu a proposta até sexta" });
  const again = await report?.execute({
    notify: true,
    headline: "Alfa pediu a proposta até sexta",
  });
  assert.deepEqual(sent, ["📡 Radar: Alfa pediu a proposta até sexta"]);
  assert.equal(again?.notified, false);
});

async function server(
  t: TestContext,
  reply: (index: number) => { calls?: PiCall[]; text?: string },
) {
  const fixture = await piModelFixture(t, reply);
  const local = await browserFixture(t, () => ({ data: {} }));
  const app = await createApp(local.db, {
    ...local.config,
    agentBackend: "pi",
    impossiblBaseUrl: fixture.baseUrl,
  });
  t.after(() => app.agent.stop());
  return { ...fixture, ...local, ...app };
}

test("a helper's round runs in its conversation with fewer tools and reports quietly", async (t) => {
  const fixture = await server(t, (index) =>
    index === 0
      ? {
          calls: [
            { name: "report_finding", arguments: { notify: false, headline: "Nada novo hoje" } },
          ],
        }
      : { text: "Nada novo hoje." },
  );
  const fuzzy = await createFuzzy(fixture.agent.fuzzyDeps(), "owner", { ...radar, web: false });
  const run = await runFuzzy(fixture.agent.fuzzyDeps(), "owner", fuzzy.id);
  assert.ok(run.started);
  await fixture.agent.worker.tick();
  const task = await fixture.agent.getTask("owner", (run as { taskId: string }).taskId);
  assert.equal(task.status, "succeeded", task.error ?? undefined);
  assert.equal(task.state.threadId, fuzzy.threadId, "the round runs in the helper's chat");
  const body = JSON.parse(fixture.requests[0]?.body ?? "{}") as {
    tools: { function: { name: string } }[];
    messages: { role: string; content: unknown }[];
  };
  const tools = body.tools.map((tool) => tool.function.name);
  assert.ok(tools.includes("report_finding") && tools.includes("learn_fact"));
  for (const name of [
    "delegate_task",
    "remember_fact",
    "browser_task",
    "ask_fuzzy",
    "create_fuzzy",
  ])
    assert.ok(!tools.includes(name), name);
  assert.match(JSON.stringify(body.messages), /you are 📡 Radar, a helper/);
  // A quiet round: no "done" notification.
  const notes = await fixture.db.list<AgentNotification>("owner", "notifications");
  assert.ok(!notes.some((n) => n.taskId === task.id));
  assert.equal(
    (await fixture.db.get<Fuzzy>("owner", "fuzzies", fuzzy.id))?.lastFinding?.headline,
    "Nada novo hoje",
  );
  const conversation = await fixture.db.get<{ messages: Message[] }>(
    "owner",
    "conversations",
    fuzzy.threadId,
  );
  assert.match(String(conversation?.messages[0]?.content), /Nova rodada/);
});

test("Corgi knows its helpers and can call one", async (t) => {
  const fixture = await server(t, () => ({ text: "ok" }));
  await createFuzzy(fixture.agent.fuzzyDeps(), "owner", radar);
  await fixture.agent.createTask("owner", { prompt: "oi" });
  await fixture.agent.worker.tick();
  const body = JSON.parse(fixture.requests[0]?.body ?? "{}") as {
    tools: { function: { name: string } }[];
    messages: unknown[];
  };
  const tools = body.tools.map((tool) => tool.function.name);
  assert.ok(tools.includes("ask_fuzzy") && tools.includes("create_fuzzy"));
  assert.match(JSON.stringify(body.messages), /Your helpers[\s\S]*📡 Radar/);
});
