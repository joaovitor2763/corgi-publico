import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/platform/config.ts";
import { createStore, type Store } from "../apps/server/src/platform/db.ts";
import type {
  AgentMemory,
  AgentNotification,
  AgentTask,
  AgentWorkspace,
  Goal,
  Idea,
  Monitor,
  RunEvent,
} from "../packages/domain/src/agent.ts";

let db: Store, server: Awaited<ReturnType<typeof createApp>>, directory: string, token: string;
let config: Config;
const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const request = (path: string, body?: unknown) =>
  server.app.request(`/api/agent${path}`, {
    headers: headers(),
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
async function read<T>(path: string, body?: unknown, status = 200): Promise<T> {
  const response = await request(path, body);
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-agent-api-"));
  db = await createStore({ dataDir: join(directory, "db") });
  config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "model",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  };
  server = await createApp(db, config);
  const session = await server.app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(session.status, 200);
  token = (await session.json()).token;
});
after(async () => {
  await server?.agent?.stop();
  await db?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("agent API requires a session and reports the actual worker state", async () => {
  assert.equal((await server.app.request("/api/agent")).status, 401);
  assert.equal(
    (
      await server.app.request("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Plan the week" }),
      })
    ).status,
    401,
  );
  const workspace = await read<AgentWorkspace>("");
  assert.equal(workspace.worker.running, false);
  assert.equal(workspace.identity.name, "Corgi");
  assert.equal(workspace.identity.tone, "warm");
});

test("the main Rich Thread survives reopening and concurrent initialization", async () => {
  assert.equal((await server.app.request("/api/main-thread")).status, 401);
  const responses = await Promise.all(
    Array.from({ length: 3 }, () => server.app.request("/api/main-thread", { headers: headers() })),
  );
  const threads = await Promise.all(responses.map((response) => response.json()));
  assert.ok(threads.every((thread) => thread.threadId === threads[0].threadId));
  assert.equal(threads[0].existing, false);
  const reopened = await (
    await server.app.request("/api/main-thread", { headers: headers() })
  ).json();
  assert.equal(reopened.threadId, threads[0].threadId);
  assert.equal(reopened.existing, false);
  assert.equal(await db.get("other-user", "conversation-settings", "main"), null);
});

test("task detail and controls stay scoped to the authenticated owner", async () => {
  const task = await read<AgentTask>(
    "/tasks",
    { prompt: "Plan the week", owner: "other-user" },
    201,
  );
  assert.equal(task.status, "queued");
  assert.ok(task.plan.length > 0);
  const hidden = await server.agent.createTask("other-user", { prompt: "Private task" });
  assert.equal((await request(`/tasks/${hidden.id}`)).status, 404);
  assert.equal((await request(`/tasks/${hidden.id}/control`, { action: "cancel" })).status, 404);
  assert.equal((await request(`/tasks/${hidden.id}/input`, { answer: "Private" })).status, 404);
  const snapshot = await read<AgentWorkspace>("");
  assert.ok(snapshot.tasks.some((item) => item.id === task.id));
  assert.ok(!snapshot.tasks.some((item) => item.id === hidden.id));
  assert.equal((await server.agent.getTask("other-user", hidden.id)).status, "queued");
  await server.agent.control("other-user", hidden.id, "cancel");
  assert.equal(
    (await read<AgentTask>(`/tasks/${task.id}/control`, { action: "pause" })).status,
    "paused",
  );
  assert.equal(
    (await read<AgentTask>(`/tasks/${task.id}/control`, { action: "resume" })).status,
    "queued",
  );
  assert.equal(
    (await read<AgentTask>(`/tasks/${task.id}/control`, { action: "cancel" })).status,
    "cancelled",
  );
  const detail = await read<{ task: AgentTask; events: RunEvent[]; artifacts: unknown[] }>(
    `/tasks/${task.id}`,
  );
  assert.equal(detail.task.status, "cancelled");
  assert.equal(detail.events.length, 3);
  assert.deepEqual(detail.artifacts, []);
});

test("agent request validation rejects malformed input with useful JSON errors", async () => {
  for (const [path, body] of [
    ["/tasks", { prompt: " " }],
    ["/tasks", { prompt: "Plan", kind: "unknown" }],
    ["/tasks/missing/control", { action: "delete" }],
    ["/tasks/missing/input", { answer: " " }],
    ["/goals", { title: " " }],
    ["/goals/missing", { status: "unknown" }],
    ["/goals/missing", { milestones: [{ id: "one", title: "Step", done: "yes" }] }],
    [
      "/monitors",
      { title: "Price", url: "https://example.com", condition: "price_below", value: "bad" },
    ],
    ["/monitors/missing/control", { action: "delete" }],
    ["/ideas/missing", { action: "accept", prompt: " " }],
    ["/memories", { text: " " }],
    ["/identity", { name: "OpenMuse", tone: "angry" }],
    ["/sample-page", { text: "a".repeat(100001) }],
  ] satisfies [string, unknown][]) {
    const response = await request(path, body);
    assert.equal(response.status, 422, path);
    assert.equal(typeof (await response.json()).error, "string", path);
  }
  const malformed = await server.app.request("/api/agent/tasks", {
    method: "POST",
    headers: headers(),
    body: "{",
  });
  assert.equal(malformed.status, 400);
});

test("goal updates validate milestones and pausing a goal pauses its task", async () => {
  const goal = await read<Goal>("/goals", { title: "Travel", milestones: ["Choose dates"] }, 201);
  const task = await read<AgentTask>("/tasks", { prompt: "Find dates", goalId: goal.id }, 201);
  const saved = await read<Goal>(`/goals/${goal.id}`, {
    status: "paused",
    milestones: goal.milestones.map((milestone) => ({ ...milestone, done: true })),
  });
  assert.equal(saved.status, "paused");
  assert.equal(saved.milestones[0].done, true);
  assert.equal((await read<{ task: AgentTask }>(`/tasks/${task.id}`)).task.status, "paused");
  const hidden = await server.agent.createGoal("other-user", { title: "Private goal" });
  assert.equal((await request(`/goals/${hidden.id}`, { status: "completed" })).status, 404);
  assert.equal(
    (await request("/tasks", { prompt: "Link private goal", goalId: hidden.id })).status,
    404,
  );
});

test("memories can be edited and forgotten while identity changes persist", async () => {
  const memory = await read<AgentMemory>(
    "/memories",
    { text: "I prefer morning meetings", source: "You" },
    201,
  );
  const updated = await read<AgentMemory>(`/memories/${memory.id}`, {
    text: "I prefer afternoon meetings",
  });
  // A correction is a new memory that supersedes the old one (the lineage is kept).
  assert.notEqual(updated.id, memory.id);
  assert.deepEqual(updated.supersedes, [memory.id]);
  assert.equal(updated.origin, "owner");
  assert.equal(
    (await db.get<AgentMemory>("local-user", "memories", memory.id))?.status,
    "superseded",
  );
  await db.put("other-user", "memories", { ...memory, id: "private-memory" });
  const privateIdentity = await db.get("other-user", "agent-settings", "identity");
  assert.equal((await request("/memories/private-memory", { text: "Overwrite" })).status, 404);
  assert.equal((await request("/memories/private-memory/forget", {})).status, 404);
  await read("/identity", {
    name: "Nova",
    tone: "concise",
    avatar: "lilac",
    showChatUpdates: false,
  });
  const snapshot = await read<AgentWorkspace>("");
  assert.equal(snapshot.identity.name, "Nova");
  assert.equal(snapshot.identity.tone, "concise");
  assert.equal(snapshot.identity.avatar, "lilac");
  assert.equal(snapshot.identity.showChatUpdates, false);
  assert.equal(
    (await request("/identity", { name: "Nova", tone: "warm", avatar: "invalid" })).status,
    422,
  );
  assert.ok(!snapshot.memories.some((item) => item.id === memory.id), "the old wording is gone");
  assert.equal(snapshot.memories.find((item) => item.id === updated.id)?.text, updated.text);
  assert.deepEqual(await db.get("other-user", "agent-settings", "identity"), privateIdentity);
  assert.deepEqual(await read(`/memories/${updated.id}/forget`, {}), { ok: true });
  assert.ok(!(await read<AgentWorkspace>("")).memories.some((item) => item.id === updated.id));
  // Forgotten, not deleted: restorable from Memória.
  assert.equal((await read<AgentMemory>(`/memories/${updated.id}/restore`, {})).status, "active");
  assert.ok(await db.get("other-user", "memories", "private-memory"));
});

test("idea dismissal survives refresh and concurrent acceptance creates one goal and task", async () => {
  const ideas = await read<Idea[]>("/ideas/refresh", {});
  assert.ok(ideas.length >= 2);
  assert.ok(ideas.every((idea) => idea.evidence.length > 0));
  const dismissed = ideas[0],
    accepted = ideas[1];
  assert.equal(
    (await read<Idea>(`/ideas/${dismissed.id}`, { action: "dismiss" })).status,
    "dismissed",
  );
  assert.equal(
    (await read<Idea[]>("/ideas/refresh", {})).find((idea) => idea.id === dismissed.id)?.status,
    "dismissed",
  );
  const before = await read<AgentWorkspace>("");
  const results = await Promise.all([
    read<Idea>(`/ideas/${accepted.id}`, { action: "accept" }),
    read<Idea>(`/ideas/${accepted.id}`, { action: "accept" }),
  ]);
  assert.equal(results[0].status, "accepted");
  assert.equal(results[0].taskId, results[1].taskId);
  const after = await read<AgentWorkspace>("");
  // Only a plan becomes a goal; a one-off idea is just its task.
  assert.equal(after.goals.length, before.goals.length + (accepted.kind === "plan" ? 1 : 0));
  assert.equal(after.tasks.length, before.tasks.length + 1);
  assert.ok(results[0].taskId);
  await read(`/tasks/${results[0].taskId}/control`, { action: "cancel" });
});

test("a snoozed idea leaves the list, is not drafted again meanwhile, and comes back on time", async () => {
  const seed: Idea = {
    id: "idea-snooze",
    title: "Posso responder à Ana sobre a proposta",
    reason: "Ela pediu resposta até sexta.",
    evidence: [
      { id: "slack:s1", kind: "user", title: "Pode revisar?", excerpt: "#vendas · de ana" },
    ],
    prompt: "Rascunhe a resposta.",
    kind: "agent",
    input: { source: "smart" },
    status: "new",
    createdAt: new Date().toISOString(),
  };
  await db.put("local-user", "ideas", seed);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  const snoozed = await read<Idea>("/ideas/idea-snooze/snooze", { until: tomorrow });
  assert.equal(snoozed.status, "new");
  assert.equal(snoozed.snoozedUntil, tomorrow);
  // Hidden from the app…
  assert.ok(!(await read<AgentWorkspace>("")).ideas.some((i) => i.id === "idea-snooze"));
  // …but still one record after the pipeline runs: it is current, not a gap to fill.
  await read<Idea[]>("/ideas/refresh", {});
  const stored = (await db.list<Idea>("local-user", "ideas")).filter(
    (i) => i.id === "idea-snooze" || i.title === seed.title,
  );
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.snoozedUntil, tomorrow);
  // Only the future, at most 90 days, only open ideas.
  await read("/ideas/idea-snooze/snooze", { until: "2020-01-01T00:00:00Z" }, 400);
  await read("/ideas/idea-snooze/snooze", { until: "not a date" }, 400);
  await read("/ideas/missing/snooze", { until: tomorrow }, 404);
  // Time passes: it is back as an open idea, and not expired (its week restarts).
  await db.put("local-user", "ideas", {
    ...stored[0],
    createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    snoozedUntil: new Date(Date.now() - 1000).toISOString(),
  });
  const back = (await read<AgentWorkspace>("")).ideas.find((i) => i.id === "idea-snooze");
  assert.equal(back?.status, "new");
  await read("/ideas/idea-snooze", { action: "dismiss" });
  await read("/ideas/idea-snooze/snooze", { until: tomorrow }, 409);
});

test("an idea nobody acted on for a week is archived as expired, and can be restored", async () => {
  const old: Idea = {
    id: "idea-old",
    title: "Posso preparar a pauta da reunião com a Acme",
    reason: "A reunião é quinta.",
    evidence: [{ id: "calendar:c1", kind: "user", title: "Reunião Acme", excerpt: "" }],
    prompt: "Prepare a pauta.",
    kind: "agent",
    input: { source: "smart" },
    status: "new",
    createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
  };
  await db.put("local-user", "ideas", old);
  // The app already sees it as expired before any sweep runs…
  assert.equal(
    (await read<AgentWorkspace>("")).ideas.find((i) => i.id === "idea-old")?.status,
    "expired",
  );
  assert.equal((await db.get<Idea>("local-user", "ideas", "idea-old"))?.status, "new");
  // …and the pipeline persists it, so it never counts as current again.
  await read<Idea[]>("/ideas/refresh", {});
  assert.equal((await db.get<Idea>("local-user", "ideas", "idea-old"))?.status, "expired");
  // Expired ideas cannot be taken by accident, only restored on purpose.
  assert.equal((await read<Idea>("/ideas/idea-old", { action: "accept" })).status, "expired");
  const restored = await read<Idea>("/ideas/idea-old", { action: "restore" });
  assert.equal(restored.status, "new");
  assert.ok(Date.now() - Date.parse(restored.createdAt) < 60_000);
  assert.equal(
    (await read<AgentWorkspace>("")).ideas.find((i) => i.id === "idea-old")?.status,
    "new",
  );
  await read("/ideas/idea-old", { action: "dismiss" });
});

test("sample monitor saves its baseline and deduplicates notifications for repeated changes", async () => {
  await read("/sample-page", { text: "No tables available" });
  const monitor = await read<Monitor>(
    "/monitors",
    {
      title: "Dinner availability",
      url: "sample://availability",
      condition: "change",
      intervalMinutes: 1,
    },
    201,
  );
  const notifications = async () =>
    (await read<AgentNotification[]>("/notifications")).filter(
      (item) => item.taskId === monitor.taskId,
    );
  await server.agent.worker.tick();
  assert.equal(
    (await read<{ task: AgentTask }>(`/tasks/${monitor.taskId}`)).task.status,
    "scheduled",
  );
  assert.equal((await notifications()).length, 0);
  for (const text of [
    "One table at 7 pm",
    "One table at 7 pm",
    "Two tables at 7 pm",
    "One table at 7 pm",
  ]) {
    await read("/sample-page", { text });
    await read(`/monitors/${monitor.id}/control`, { action: "check" });
    await server.agent.worker.tick();
  }
  const found = await notifications();
  assert.equal(found.length, 2);
  assert.ok(found.every((item) => !item.read));
  const readNotification = await read<AgentNotification>(`/notifications/${found[0].id}/read`, {});
  assert.equal(readNotification.read, true);
  assert.equal((await notifications()).find((item) => item.id === found[0].id)?.read, true);
  const snapshot = await read<AgentWorkspace>("");
  assert.equal(snapshot.monitors.find((item) => item.id === monitor.id)?.checks, 5);
  assert.equal(
    (await read<Monitor>(`/monitors/${monitor.id}/control`, { action: "pause" })).status,
    "paused",
  );
  assert.equal(
    (await read<Monitor>(`/monitors/${monitor.id}/control`, { action: "stop" })).status,
    "stopped",
  );
  await server.agent.notify(
    "other-user",
    "Private",
    "Private details",
    undefined,
    "private-notice",
  );
  const privateNotification = (await db.list<AgentNotification>("other-user", "notifications"))[0];
  assert.equal((await request(`/notifications/${privateNotification.id}/read`, {})).status, 404);
  assert.equal(
    (await db.get<AgentNotification>("other-user", "notifications", privateNotification.id))?.read,
    false,
  );
});

test("live mode rejects sample sources and hides the fixture mutation endpoint", async () => {
  const live = await createApp(db, {
    ...config,
    mode: "live",
    accessKey: "a-private-test-key-with-enough-characters",
  });
  try {
    const response = await live.app.request("/api/agent/sample-page", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ text: "Changed" }),
    });
    assert.equal(response.status, 404);
    const monitor = await live.app.request("/api/agent/monitors", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title: "Forbidden fixture", url: "sample://availability" }),
    });
    assert.equal(monitor.status, 422);
    assert.deepEqual(await db.get("local-user", "sample-pages", "availability"), {
      id: "availability",
      text: "One table at 7 pm",
    });
  } finally {
    await live.agent.stop();
  }
});

test("a follow-up in the task window continues the task with its own history", async () => {
  const now = new Date().toISOString();
  const base = {
    prompt: "Organizar o aniversário da Iara no sábado",
    plan: [],
    evidence: [],
    input: {},
    createdAt: now,
    updatedAt: now,
    attempts: 1,
    artifactIds: [],
  };
  await db.put("local-user", "tasks", {
    ...base,
    id: "party",
    title: "Aniversário da Iara",
    kind: "agent",
    status: "succeeded",
    state: {},
    result: "Festa 26/09 10h, Casa Amarela Festas. Presença pendente.",
  });
  const next = await read<AgentTask>("/tasks/party/follow-up", {
    text: "Confirma presença com a Jéssica",
  });
  assert.equal(next.status, "queued");
  assert.equal(next.result, "");
  assert.deepEqual(
    (next.state.followUps as { text: string; previousResult: string }[]).map((f) => [
      f.text,
      f.previousResult,
    ]),
    [
      [
        "Confirma presença com a Jéssica",
        "Festa 26/09 10h, Casa Amarela Festas. Presença pendente.",
      ],
    ],
  );
  const events = await db.list<RunEvent>("local-user", "run-events");
  assert.ok(events.some((e) => e.taskId === "party" && e.title === "Nova instrução sua"));

  await db.put("local-user", "tasks", {
    ...base,
    id: "watch",
    title: "UPS",
    kind: "monitor",
    status: "scheduled",
    state: {},
  });
  await read("/tasks/watch/follow-up", { text: "mais rápido" }, 409);
});

test("answering a task's question from its window stays in the window's history", async () => {
  const now = new Date().toISOString();
  await db.put("local-user", "tasks", {
    id: "ask",
    title: "Presente",
    prompt: "Comprar presente",
    kind: "agent",
    status: "waiting_input",
    question: "Qual o orçamento?",
    plan: [],
    evidence: [],
    input: {},
    state: {},
    createdAt: now,
    updatedAt: now,
    attempts: 1,
    artifactIds: [],
  });
  const next = await read<AgentTask>("/tasks/ask/follow-up", { text: "Até R$ 200" });
  assert.equal(next.status, "queued");
  assert.equal(next.state.answer, "Até R$ 200");
  assert.deepEqual(
    (next.state.followUps as { text: string; answer?: boolean }[]).map((f) => [f.text, f.answer]),
    [["Até R$ 200", true]],
  );
});

test("idea sources: defaults, then the person's choice is saved and cleaned", async () => {
  const first = await read<{ sources: unknown[]; custom: boolean; apps: { app: string }[] }>(
    "/idea-sources",
  );
  assert.equal(first.custom, false);
  assert.deepEqual(
    first.apps.map((a) => a.app),
    ["googlecalendar", "gmail", "slack", "instagram"],
  );
  const response = await server.app.request("/api/agent/idea-sources", {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({
      sources: [{ app: "slack", channels: ["#Vendas"], mentions: true, dms: true }],
    }),
  });
  assert.equal(response.status, 200);
  const saved = await read<{ sources: { channels?: string[] }[]; custom: boolean }>(
    "/idea-sources",
  );
  assert.equal(saved.custom, true);
  assert.deepEqual(saved.sources[0].channels, ["vendas"]);
  const bad = await server.app.request("/api/agent/idea-sources", {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ sources: [{ app: "tiktok" }] }),
  });
  assert.equal(bad.status, 422);
});

test("a task can prepare an app action without the built-in Google connection", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "dm",
    title: "Responder no Slack",
    prompt: "Avisa o Rafael",
    kind: "agent" as const,
    status: "running" as const,
    plan: [],
    evidence: [],
    input: {},
    state: { connectionId: null },
    createdAt: now,
    updatedAt: now,
    attempts: 1,
    artifactIds: [],
  };
  await db.put("local-user", "tasks", task);
  const proposal = await server.agent.prepare(
    "local-user",
    task,
    {
      kind: "app.action",
      data: {
        toolkit: "slack",
        tool: "SLACK_OPEN_DM",
        summary: "Abrir DM com Rafael",
        arguments: { users: "U0B2USHUZND" },
      },
    },
    "open-dm",
    {
      guard: async () => {},
      checkpoint: async () => task,
      event: async () => {},
    } as never,
  );
  assert.equal(proposal.status, "awaiting_review");
});

test("a task offers 'always allow' and runs an action the person always allows", async () => {
  const now = new Date().toISOString();
  const task = {
    id: "always",
    title: "Recusar convite",
    prompt: "Recusa o convite do encerramento",
    kind: "agent" as const,
    status: "running" as const,
    plan: [],
    evidence: [],
    input: {},
    state: {},
    createdAt: now,
    updatedAt: now,
    attempts: 1,
    artifactIds: [],
  };
  await db.put("local-user", "tasks", task);
  const events: string[] = [];
  const context = {
    guard: async () => {},
    checkpoint: async () => task,
    event: async (_kind: string, title: string) => void events.push(title),
  } as never;
  const input = (summary: string) => ({
    kind: "app.action" as const,
    data: {
      toolkit: "googlecalendar",
      tool: "GOOGLECALENDAR_PATCH_EVENT",
      summary,
      arguments: { event_id: "e1" },
    },
  });
  const asked = await server.agent.prepare(
    "local-user",
    task,
    input("Recusar"),
    "ask",
    context,
    undefined,
    {
      alwaysAllowable: true,
      autoAllowed: async () => false,
    },
  );
  assert.equal(asked.status, "awaiting_review");
  assert.equal(asked.alwaysAllowable, true);
  const ran = await server.agent.prepare(
    "local-user",
    task,
    input("Recusar já"),
    "auto",
    context,
    undefined,
    {
      alwaysAllowable: true,
      autoAllowed: async () => true,
    },
  );
  assert.notEqual(ran.status, "awaiting_review", "decided without asking");
  // The same step again (a retry) returns the decided action instead of asking or running twice.
  const again = await server.agent.prepare(
    "local-user",
    task,
    input("Recusar já"),
    "auto",
    context,
    undefined,
    {
      alwaysAllowable: true,
      autoAllowed: async () => true,
    },
  );
  assert.equal(again.id, ran.id);
  assert.equal(again.status, ran.status);
});

test("a task that keeps taking its executor down fails instead of looping", async () => {
  const past = new Date(Date.now() - 60000).toISOString();
  await db.put("local-user", "tasks", {
    id: "crash-loop",
    title: "Tarefa instável",
    prompt: "Algo que derruba o processo",
    kind: "agent",
    status: "running",
    plan: [],
    evidence: [],
    input: {},
    state: {},
    createdAt: past,
    updatedAt: past,
    attempts: 4,
    recoveries: 3,
    leaseId: "dead",
    leaseUntil: past,
    artifactIds: [],
  });
  await server.agent.worker.tick();
  const task = await server.agent.getTask("local-user", "crash-loop");
  assert.equal(task.status, "failed");
  assert.match(task.error ?? "", /caiu 3 vezes/);
});

test("the polled snapshot answers 204 when nothing changed, and JSON goes out compressed", async () => {
  const first = await server.app.request("/api/agent", { headers: headers() });
  assert.equal(first.status, 200);
  const version = first.headers.get("x-version");
  assert.ok(version);
  const same = await server.app.request(`/api/agent?v=${version}`, { headers: headers() });
  assert.equal(same.status, 204);
  assert.equal(await same.text(), "");
  await server.agent.createTask("local-user", { prompt: "Algo novo" });
  const changed = await server.app.request(`/api/agent?v=${version}`, { headers: headers() });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("x-version"), version);
  const zipped = await server.app.request("/api/agent", {
    headers: { ...headers(), "Accept-Encoding": "gzip" },
  });
  assert.equal(zipped.headers.get("content-encoding"), "gzip");
});
