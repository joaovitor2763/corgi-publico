import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { executeModelTask } from "../apps/server/src/agent/model.ts";
import { createApp } from "../apps/server/src/app.ts";
import { browserFixture } from "./helpers/browser.ts";
import { fixture as computerFixture } from "./helpers/computer.ts";
import { type PiCall, piModelFixture } from "./helpers/pi-model.ts";

async function setup(t: TestContext, calls: (index: number) => PiCall[] | { text: string }) {
  const fixture = await piModelFixture(t, (index) => {
    const reply = calls(index);
    return Array.isArray(reply) ? { calls: reply } : reply;
  });
  const local = await browserFixture(t, () => ({ data: {} }));
  const server = await createApp(
    local.db,
    {
      ...local.config,
      agentBackend: "pi",
      // These cover the step-by-step task runner (still used for goal plans).
      chatTasks: false,
      computerEnabled: true,
      impossiblBaseUrl: fixture.baseUrl,
    },
    { docker: computerFixture().runner },
  );
  t.after(() => server.agent.stop());
  return { ...fixture, ...local, ...server };
}

test("Pi task checkpoints a parallel batch serially and blocks every action after approval pause", async (t) => {
  const fixture = await setup(t, () => [
    { name: "set_plan", arguments: { steps: ["Prepare the reviewed event"] } },
    {
      name: "prepare_event",
      arguments: {
        title: "Reviewed walk",
        start: "2026-10-10T10:00:00-07:00",
        end: "2026-10-10T11:00:00-07:00",
      },
    },
    {
      name: "run_computer_command",
      arguments: { operationId: "must-not-run", command: "pwd", cwd: "/workspace" },
    },
    { name: "finish_task", arguments: { summary: "Must not finish before approval" } },
  ]);
  const task = await fixture.agent.createTask("owner", { prompt: "Prepare a walk on my calendar" });
  await fixture.agent.worker.tick();
  const result = await fixture.agent.detail("owner", task.id);
  assert.equal(result.task.status, "waiting_approval", result.task.error ?? result.task.question);
  assert.equal(result.task.plan.length, 1);
  assert.ok(result.task.actionId);
  assert.equal((await fixture.db.list("owner", "actions")).length, 1);
  assert.equal((await fixture.computer.snapshot("owner")).commands.length, 0);
  assert.equal(result.artifacts.length, 0);
  assert.equal(fixture.requests.length, 1);
});

test("Pi task ask_user stops remaining tools and next model turns", async (t) => {
  const fixture = await setup(t, () => [
    { name: "ask_user", arguments: { question: "Which date?" } },
    { name: "finish_task", arguments: { summary: "Unverified" } },
  ]);
  const task = await fixture.agent.createTask("owner", { prompt: "Choose a date for the walk" });
  await fixture.agent.worker.tick();
  const result = await fixture.agent.detail("owner", task.id);
  assert.equal(result.task.status, "waiting_input");
  assert.equal(result.task.question, "Which date?");
  assert.equal(result.artifacts.length, 0);
  assert.equal(fixture.requests.length, 1);
});

test("Pi task stuck repeating one call stops early and waits instead of succeeding", async (t) => {
  const fixture = await setup(t, () => [
    { name: "read_workspace", arguments: { section: "files" } },
  ]);
  const task = await fixture.agent.createTask("owner", { prompt: "Inspect the files" });
  await fixture.agent.worker.tick();
  const result = await fixture.agent.getTask("owner", task.id);
  assert.equal(result.status, "waiting_input", result.error ?? undefined);
  // The loop guard refuses the third identical call and ends the run on the fifth, long before
  // the 16-step limit (pi.ts repeatedCall).
  assert.ok(fixture.requests.length <= 6, `${fixture.requests.length} model calls`);
  assert.match(result.question ?? "", /sem conseguir confirmar que terminei/);
});

test("Pi task with a missing key waits for configuration without network or fallback", async (t) => {
  const fixture = await setup(t, () => []);
  delete process.env.IMPOSSIBL_API_KEY;
  const task = await fixture.agent.createTask("owner", { prompt: "Inspect the files" });
  await fixture.agent.worker.tick();
  const result = await fixture.agent.getTask("owner", task.id);
  assert.equal(result.status, "waiting_input");
  assert.match(result.question ?? "", /IMPOSSIBL_API_KEY/);
  assert.equal(fixture.requests.length, 0);
});

test("Pi task guards lease ownership before computer and domain tools", async (t) => {
  const fixture = await setup(t, () => [
    {
      name: "run_computer_command",
      arguments: { operationId: "lost-lease", command: "pwd", cwd: "/workspace" },
    },
    { name: "finish_task", arguments: { summary: "Must not persist" } },
  ]);
  const task = await fixture.agent.createTask("owner", { prompt: "Work after lost lease" });
  let guards = 0;
  const never = async (): Promise<never> => {
    throw new Error("Must not persist after lease loss");
  };
  await assert.rejects(
    executeModelTask(fixture.agent, "owner", task, {
      signal: new AbortController().signal,
      guard: async () => {
        guards++;
        throw new Error("Lease lost");
      },
      checkpoint: never,
      event: never,
    }),
  );
  assert.ok(guards > 0);
  assert.equal((await fixture.computer.snapshot("owner")).commands.length, 0);
  assert.equal((await fixture.agent.detail("owner", task.id)).artifacts.length, 0);
});

test("Pi task that only announces what it will do is nudged once and then acts", async (t) => {
  const fixture = await setup(t, (index) =>
    index === 0
      ? { text: "Vou preparar isso agora." }
      : [{ name: "finish_task", arguments: { summary: "Feito" } }],
  );
  const task = await fixture.agent.createTask("owner", { prompt: "Do the thing" });
  await fixture.agent.worker.tick();
  const result = await fixture.agent.getTask("owner", task.id);
  assert.equal(result.status, "succeeded", result.question ?? result.error ?? undefined);
  assert.equal(fixture.requests.length, 2);
  assert.match(fixture.requests[1]?.body ?? "", /Vou preparar isso agora/);
  assert.match(fixture.requests[1]?.body ?? "", /Continue now/);
});

test("Pi task still silent after the nudge asks with its own words", async (t) => {
  const fixture = await setup(t, () => ({ text: "Preciso do e-mail do Rafael." }));
  const task = await fixture.agent.createTask("owner", { prompt: "Message Rafael" });
  await fixture.agent.worker.tick();
  const result = await fixture.agent.getTask("owner", task.id);
  assert.equal(result.status, "waiting_input");
  assert.equal(fixture.requests.length, 2);
  assert.match(result.question ?? "", /Preciso do e-mail do Rafael/);
});

test("Pi task sees each of its questions followed by the person's answer", async (t) => {
  const fixture = await setup(t, (index) =>
    index === 0
      ? [{ name: "ask_user", arguments: { question: "Which date?" } }]
      : index === 1
        ? [{ name: "ask_user", arguments: { question: "Which time?" } }]
        : [{ name: "finish_task", arguments: { summary: "Scheduled" } }],
  );
  const task = await fixture.agent.createTask("owner", { prompt: "Schedule the walk" });
  await fixture.agent.worker.tick();
  await fixture.agent.answer("owner", task.id, "Friday");
  await fixture.agent.worker.tick();
  await fixture.agent.answer("owner", task.id, "10am");
  await fixture.agent.worker.tick();
  assert.equal((await fixture.agent.getTask("owner", task.id)).status, "succeeded");
  const conversation = (
    JSON.parse(fixture.requests[2]?.body ?? "{}") as {
      messages: { role: string; content: string }[];
    }
  ).messages
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role}: ${message.content}`);
  assert.deepEqual(conversation, [
    "user: Schedule the walk",
    "assistant: Which date?",
    "user: Friday",
    "assistant: Which time?",
    "user: 10am",
  ]);
  const events = await fixture.db.list<{ taskId: string; title: string; detail?: string }>(
    "owner",
    "run-events",
  );
  const mine = events.filter((event) => event.taskId === task.id);
  assert.ok(mine.some((event) => event.title === "Sua resposta" && event.detail === "10am"));
  assert.ok(mine.some((event) => event.title === "Retomei" && event.detail === "10am"));
});
