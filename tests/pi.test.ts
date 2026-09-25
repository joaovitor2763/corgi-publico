import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { EventSchemas, EventType, type RunAgentInput } from "@ag-ui/core";
import { defineTool } from "@copilotkit/runtime/v2";
import { lastValueFrom, toArray } from "rxjs";
import { z } from "zod";
import { ConversationAgent } from "../apps/server/src/agent/conversation.ts";
import { PiAgent, providerFailure } from "../apps/server/src/agent/pi.ts";
import {
  IMPOSSIBL_BASE_URL,
  IMPOSSIBL_MODEL,
  IMPOSSIBL_MODELS,
  impossiblProvider,
} from "../apps/server/src/agent/pi-provider.ts";
import { agentConfigured } from "../apps/server/src/agent/runtime.ts";
import { createApp } from "../apps/server/src/app.ts";
import { type Config, readConfig } from "../apps/server/src/platform/config.ts";
import { browserFixture } from "./helpers/browser.ts";
import { piModelFixture } from "./helpers/pi-model.ts";

const config: Config = {
  mode: "sample",
  agentBackend: "pi",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir: ".openmuse",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: [],
};
const input = (): RunAgentInput => ({
  threadId: "pi-chat",
  runId: randomUUID(),
  messages: [{ id: randomUUID(), role: "user", content: "Help me" }],
  tools: [],
  context: [],
  state: {},
});
const collect = async (agent: Pick<PiAgent, "run">, run = input()) =>
  (await lastValueFrom(agent.run(run).pipe(toArray()))).map((event) => EventSchemas.parse(event));

test("Pi configuration uses only Impossibl, with exact defaults and no OAuth providers", async (t) => {
  const old = process.env.AGENT_BACKEND;
  process.env.AGENT_BACKEND = "pi";
  t.after(() => {
    if (old === undefined) delete process.env.AGENT_BACKEND;
    else process.env.AGENT_BACKEND = old;
  });
  assert.equal(readConfig().agentBackend, "pi");
  const { model, models } = impossiblProvider(config);
  assert.equal(model.id, IMPOSSIBL_MODEL);
  assert.equal(model.baseUrl, IMPOSSIBL_BASE_URL);
  assert.equal(model.api, "openai-completions");
  assert.deepEqual(
    models.getProviders().map((provider) => provider.id),
    ["impossibl"],
  );
  assert.equal(models.getProvider("impossibl")?.auth.oauth, undefined);
  assert.deepEqual(
    IMPOSSIBL_MODELS.map((item) => item.id),
    ["meta/muse-spark-1.3-contributor", "zai/glm-5.3-flash", "meta/muse-glimmer-30b"],
  );
  assert.throws(() => impossiblProvider({ impossiblBaseUrl: "http://example.com/v1" }));
  assert.throws(() => impossiblProvider({ impossiblBaseUrl: "https://key@example.com/v1" }));
  assert.throws(() => impossiblProvider({ model: "unknown/not-allowed" }));
});

test("Pi model selection is owner-scoped, persisted and used by the next run", async (t) => {
  const fixture = await piModelFixture(t, () => ({ text: "Selected model is active." }));
  const local = await browserFixture(t, () => ({ data: {} }));
  const settings = {
    ...local.config,
    agentBackend: "pi" as const,
    impossiblBaseUrl: fixture.baseUrl,
    model: IMPOSSIBL_MODEL,
  };
  const server = await createApp(local.db, settings);
  t.after(() => server.agent.stop());
  const session = await server.app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(session.status, 200);
  const token = (await session.json()).token;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const initial = await (await server.app.request("/api/agent", { headers })).json();
  // Automatic by default: the person never has to know which model does what.
  assert.equal(initial.model.selectedId, "auto");
  assert.equal(initial.model.options[0].id, "auto");
  assert.equal(initial.model.options.length, IMPOSSIBL_MODELS.length + 1);
  const selected = await server.app.request("/api/agent/model", {
    method: "POST",
    headers,
    body: JSON.stringify({ modelId: "zai/glm-5.3-flash" }),
  });
  assert.equal(selected.status, 200, await selected.clone().text());
  assert.equal((await selected.json()).selectedId, "zai/glm-5.3-flash");
  assert.equal(
    (await local.db.get<{ modelId: string }>("local-user", "agent-settings", "model"))?.modelId,
    "zai/glm-5.3-flash",
  );
  assert.equal((await server.agent.modelSettings("other-user"))?.selectedId, "auto");
  assert.equal(await local.db.get("other-user", "agent-settings", "model"), null);
  const rejected = await server.app.request("/api/agent/model", {
    method: "POST",
    headers,
    body: JSON.stringify({ modelId: "unknown/not-allowed" }),
  });
  assert.equal(rejected.status, 422);
  const events = await collect(new ConversationAgent(settings, server.agent, "local-user"));
  assert.equal(events.at(-1)?.type, EventType.RUN_FINISHED);
  assert.equal(JSON.parse(fixture.requests[0].body).model, "zai/glm-5.3-flash");
});

test("Pi streams text and server tools through valid AG-UI with serial execution and history", async (t) => {
  const fixture = await piModelFixture(t, (index) =>
    index === 0
      ? {
          text: "Checking now.",
          calls: [
            { name: "lookup", arguments: { value: 1 } },
            { name: "lookup", arguments: { value: 2 } },
          ],
        }
      : { text: "Verified answer." },
  );
  const order: string[] = [];
  const agent = new PiAgent(
    { ...config, impossiblBaseUrl: fixture.baseUrl },
    {
      prompt: "Only act from verified data.",
      maxSteps: 6,
      tools: [
        defineTool({
          name: "lookup",
          description: "Read a value",
          parameters: z.object({ value: z.number() }),
          execute: async ({ value }) => {
            order.push(`start-${value}`);
            await new Promise((resolve) => setTimeout(resolve, 5));
            order.push(`end-${value}`);
            return { observed: value };
          },
        }),
      ],
    },
  );
  const run = input();
  run.messages.unshift({ id: "earlier", role: "assistant", content: "Previous answer" });
  const events = await collect(agent, run);
  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
  assert.equal(events[0].type, EventType.RUN_STARTED);
  assert.equal(events.at(-1)?.type, EventType.RUN_FINISHED);
  assert.equal(events.filter((event) => event.type === EventType.TOOL_CALL_RESULT).length, 2);
  assert.equal(events.filter((event) => event.type === EventType.TOOL_CALL_START).length, 2);
  assert.equal(events.filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT).length, 4);
  assert.equal(fixture.requests.length, 2);
  assert.ok(fixture.requests.every((request) => request.path === "/v1/chat/completions"));
  assert.ok(
    fixture.requests.every(
      (request) => request.authorization === "Bearer pi-local-fixture-not-a-secret",
    ),
  );
  const body = JSON.parse(fixture.requests[0].body);
  assert.equal(body.model, IMPOSSIBL_MODEL);
  assert.equal(body.stream, true);
  assert.ok(fixture.requests[0].body.includes("Previous answer"));
  assert.ok(fixture.requests[1].body.includes("observed"));
  assert.ok(!JSON.stringify(events).includes("pi-local-fixture"));
});

test("Pi enforces turn limit and validates tool arguments before side effects", async (t) => {
  const fixture = await piModelFixture(t, () => ({
    calls: [{ name: "validated", arguments: { count: -1 } }],
  }));
  let executed = 0;
  const events = await collect(
    new PiAgent(
      { ...config, impossiblBaseUrl: fixture.baseUrl },
      {
        prompt: "Test",
        maxSteps: 3,
        tools: [
          defineTool({
            name: "validated",
            description: "Validated",
            parameters: z.object({ count: z.number().positive() }),
            execute: async () => {
              executed++;
              return {};
            },
          }),
        ],
      },
    ),
  );
  assert.equal(executed, 0);
  assert.equal(fixture.requests.length, 3);
  assert.equal(events.at(-1)?.type, EventType.RUN_FINISHED);
});

test("Pi missing key does not accept other provider credentials or issue any request", async (t) => {
  const fixture = await piModelFixture(t, () => ({ text: "must not run" }));
  delete process.env.IMPOSSIBL_API_KEY;
  assert.equal(agentConfigured({ ...config, model: "openai/fixture" }), false);
  const events = await collect(
    new PiAgent(
      { ...config, impossiblBaseUrl: fixture.baseUrl },
      { prompt: "Test", maxSteps: 6, tools: [] },
    ),
  );
  assert.equal(events.at(-1)?.type, EventType.RUN_ERROR);
  assert.match(JSON.stringify(events), /IMPOSSIBL_API_KEY/);
  assert.equal(fixture.requests.length, 0);
});

test("Pi provider errors are sanitized, retried at most twice and never fall back", async (t) => {
  const fixture = await piModelFixture(t, () => ({
    status: 429,
    error: "echo Bearer pi-local-fixture-not-a-secret",
  }));
  const events = await collect(
    new PiAgent(
      { ...config, impossiblBaseUrl: fixture.baseUrl },
      { prompt: "Test", maxSteps: 6, tools: [] },
    ),
  );
  assert.equal(events.at(-1)?.type, EventType.RUN_ERROR);
  assert.ok(!JSON.stringify(events).includes("pi-local-fixture-not-a-secret"));
  assert.equal(fixture.requests.length, 3);
  for (const request of fixture.requests)
    assert.equal(JSON.parse(request.body).model, IMPOSSIBL_MODEL);
});

test("Pi recovers from a momentary provider error without repeating the reply", async (t) => {
  const fixture = await piModelFixture(t, (index) =>
    index === 0 ? { status: 503, error: "overloaded" } : { text: "Oi, tudo certo." },
  );
  const events = await collect(
    new PiAgent(
      { ...config, impossiblBaseUrl: fixture.baseUrl },
      { prompt: "Test", maxSteps: 6, tools: [] },
    ),
  );
  assert.equal(events.at(-1)?.type, EventType.RUN_FINISHED);
  const text = events
    .filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)
    .map((event) => (event as { delta: string }).delta)
    .join("");
  assert.equal(text, "Oi, tudo certo.");
  assert.equal(fixture.requests.length, 2);
});

test("Pi frontend tool calls yield to AG-UI without fabricated results or another request", async (t) => {
  const fixture = await piModelFixture(t, () => ({
    calls: [{ name: "open_workspace", arguments: { section: "mail" } }],
  }));
  const run = input();
  run.tools = [
    {
      name: "open_workspace",
      description: "Open workspace",
      parameters: {
        type: "object",
        properties: { section: { type: "string" } },
        required: ["section"],
      },
    },
  ];
  const events = await collect(
    new PiAgent(
      { ...config, impossiblBaseUrl: fixture.baseUrl },
      { prompt: "Test", maxSteps: 6, tools: [] },
    ),
    run,
  );
  assert.equal(events.filter((event) => event.type === EventType.TOOL_CALL_END).length, 1);
  assert.equal(events.filter((event) => event.type === EventType.TOOL_CALL_RESULT).length, 0);
  assert.equal(fixture.requests.length, 1);
  assert.equal(events.at(-1)?.type, EventType.RUN_FINISHED);
});

test("Pi chat uses existing owner-scoped mail tools rather than task or send shortcuts", async (t) => {
  const fixture = await piModelFixture(t, (index) =>
    index === 0
      ? {
          calls: [{ name: "search_mail", arguments: { query: "aquarium" } }],
        }
      : { text: "Found mail from the authorized mailbox." },
  );
  const local = await browserFixture(t, () => ({ data: {} }));
  const settings = {
    ...local.config,
    agentBackend: "pi" as const,
    impossiblBaseUrl: fixture.baseUrl,
  };
  const server = await createApp(local.db, settings);
  t.after(() => server.agent.stop());
  await server.workspace.ensureSample("local-user", server.actions);
  const events = await collect(new ConversationAgent(settings, server.agent, "local-user"));
  const result = events.find((event) => event.type === EventType.TOOL_CALL_RESULT);
  assert.ok(result && result.type === EventType.TOOL_CALL_RESULT);
  assert.ok(JSON.parse(result.content).matches.length > 0);
  assert.equal((await local.db.list("local-user", "tasks")).length, 0);
  assert.ok(fixture.requests[1].body.includes("aquarium"));
});

test("Pi unsubscribe aborts an in-flight request and prevents queued tool execution", async (t) => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = await piModelFixture(t, async () => {
    ready();
    await wait;
    return { calls: [{ name: "write", arguments: {} }] };
  });
  let writes = 0;
  const agent = new PiAgent(
    { ...config, impossiblBaseUrl: fixture.baseUrl },
    {
      prompt: "Test",
      maxSteps: 6,
      tools: [
        defineTool({
          name: "write",
          description: "Write",
          parameters: z.object({}),
          execute: async () => {
            writes++;
            return {};
          },
        }),
      ],
    },
  );
  const subscription = agent.run(input()).subscribe();
  await started;
  subscription.unsubscribe();
  release();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(writes, 0);
  assert.equal(fixture.requests.length, 1);
});

test("Pi honors a pre-aborted task signal without network access", async (t) => {
  const fixture = await piModelFixture(t, () => ({ text: "must not run" }));
  const signal = AbortSignal.abort();
  const events = await collect(
    new PiAgent(
      { ...config, impossiblBaseUrl: fixture.baseUrl },
      { prompt: "Test", maxSteps: 16, tools: [], signal },
    ),
  );
  assert.equal(events.at(-1)?.type, EventType.RUN_ERROR);
  assert.equal(fixture.requests.length, 0);
});

test("Pi runs a step's independent tool calls together in chat, but browser tools one at a time", async (t) => {
  const fixture = await piModelFixture(t, (index) =>
    index === 0
      ? {
          text: "Checking both.",
          calls: [
            { name: "lookup", arguments: { value: 1 } },
            { name: "lookup", arguments: { value: 2 } },
          ],
        }
      : { text: "Done." },
  );
  const order: string[] = [];
  const agent = new PiAgent(
    { ...config, impossiblBaseUrl: fixture.baseUrl },
    {
      prompt: "Read both.",
      maxSteps: 6,
      parallelTools: true,
      tools: [
        defineTool({
          name: "lookup",
          description: "Read a value",
          parameters: z.object({ value: z.number() }),
          execute: async ({ value }) => {
            order.push(`start-${value}`);
            await new Promise((resolve) => setTimeout(resolve, 20));
            order.push(`end-${value}`);
            return { observed: value };
          },
        }),
      ],
    },
  );
  await collect(agent, input());
  assert.deepEqual(order.slice(0, 2), ["start-1", "start-2"]);
});

test("Pi failure cause keeps only the status or kind, never the provider text", () => {
  assert.equal(providerFailure("429 Too Many Requests: key imp-rt-secret"), "HTTP 429");
  assert.equal(providerFailure("503 upstream overloaded"), "HTTP 503");
  assert.equal(providerFailure("Request timed out."), "timeout");
  assert.equal(providerFailure("Request was aborted"), "interrupted");
  assert.equal(providerFailure("Connection error. Authorization: Bearer imp-rt-x"), "no response");
});

test("automatic uses the fastest model and thinks on the plan, not on every chat step", async (t) => {
  const { reasoningFor } = await import("../apps/server/src/agent/pi.ts");
  const { autoModel } = await import("../apps/server/src/agent/pi-provider.ts");
  const { hasPictures } = await import("../apps/server/src/agent/conversation.ts");
  assert.equal(autoModel({}), "meta/muse-spark-1.3-contributor");
  assert.equal(
    autoModel({ vision: true }),
    "meta/muse-spark-1.3-contributor",
    "and it sees photos",
  );
  assert.ok(hasPictures("olha\n\nAttached files: recibo.JPG (file ID: f1)"));
  assert.ok(!hasPictures("Attached files: contrato.pdf (file ID: f2)"));
  const chat = { reasoningEffort: "medium" as const, quickSteps: true };
  const task = { reasoningEffort: "medium" as const };
  assert.equal(
    reasoningFor("meta/muse-spark-1.3-contributor", 0, chat),
    "medium",
    "plans with thought",
  );
  assert.equal(reasoningFor("meta/muse-spark-1.3-contributor", 2, chat), "low", "then acts faster");
  assert.equal(
    reasoningFor("meta/muse-spark-1.3-contributor", 3, task),
    "medium",
    "tasks think every step",
  );
  assert.equal(
    reasoningFor("zai/glm-5.3-flash", 1, chat),
    undefined,
    "GLM always thinks its own way",
  );
  // End to end: a chat turn on automatic; its second call runs with less thought.
  const fixture = await piModelFixture(t, (index) =>
    index === 0
      ? { calls: [{ name: "calculate", arguments: { expressions: ["2+2"] } }] }
      : { text: "4" },
  );
  const local = await browserFixture(t, () => ({ data: {} }));
  const settings = {
    ...local.config,
    agentBackend: "pi" as const,
    impossiblBaseUrl: fixture.baseUrl,
  };
  const server = await createApp(local.db, settings);
  t.after(() => server.agent.stop());
  await collect(new ConversationAgent(settings, server.agent, "local-user"));
  const [first, second] = fixture.requests.map((r) => JSON.parse(r.body));
  assert.equal(first.model, "meta/muse-spark-1.3-contributor");
  assert.equal(first.reasoning_effort, "medium");
  assert.equal(second.reasoning_effort, "low");
});

test("the same call again and again is refused, then the run stops, instead of burning its steps", async () => {
  const { repeatedCall } = await import("../apps/server/src/agent/pi.ts");
  const seen = new Map<string, number>();
  const call = () =>
    repeatedCall(seen, "use_app_tool", { tool: "DATABRICKS_SQL", arguments: { q: "select 1" } });
  assert.equal(call(), undefined);
  assert.equal(call(), undefined);
  const third = call();
  assert.equal(third?.result.block, true);
  assert.match(third?.result.reason ?? "", /materially different approach/);
  assert.equal(call()?.result.terminate, undefined);
  assert.equal(call()?.result.terminate, true);
  assert.equal(repeatedCall(seen, "update_todos", { todos: [] }), undefined);
  assert.equal(repeatedCall(seen, "update_todos", { todos: [] }), undefined);
  assert.equal(
    repeatedCall(seen, "update_todos", { todos: [] }),
    undefined,
    "working memory is exempt",
  );
});
