import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveTask, TIDY, tidyUp } from "../apps/server/src/agent/tidy.ts";
import { createStore } from "../apps/server/src/platform/db.ts";
import type { AgentTask } from "../packages/domain/src/agent.ts";

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const task = (id: string, status: AgentTask["status"], updated: number, threadId?: string) =>
  ({
    id,
    title: id,
    prompt: id,
    kind: "agent",
    status,
    plan: [],
    evidence: [],
    input: {},
    state: threadId ? { threadId } : {},
    createdAt: iso(updated),
    updatedAt: iso(updated),
    attempts: 1,
    artifactIds: [],
  }) as AgentTask;

test("finished old tasks, quiet side chats and old news are put away; nothing else", async () => {
  const db = await createStore();
  const now = Date.now();
  const long = now - TIDY.taskDoneFor - DAY;
  const thread = "11111111-2222-4333-8444-000000000001";
  await db.put("o", "tasks", task("old-done", "succeeded", long, thread));
  await db.put("o", "tasks", task("new-done", "succeeded", now - DAY));
  await db.put("o", "tasks", task("old-waiting", "waiting_input", long));
  await db.put("o", "threads", { id: thread, title: "t", updatedAt: iso(now), taskId: "old-done" });
  await db.put("o", "threads", { id: "quiet", title: "q", updatedAt: iso(now - 8 * DAY) });
  await db.put("o", "threads", {
    id: "pinned",
    title: "p",
    pinned: true,
    updatedAt: iso(now - 30 * DAY),
  });
  await db.put("o", "notifications", {
    id: "n1",
    title: "x",
    body: "",
    createdAt: iso(now - 4 * DAY),
    read: false,
  });
  await db.put("o", "notifications", {
    id: "n2",
    title: "y",
    body: "",
    createdAt: iso(now - DAY),
    read: false,
  });
  await tidyUp(db, now);
  const archived = async (id: string) => !!(await db.get<AgentTask>("o", "tasks", id))?.archivedAt;
  assert.equal(await archived("old-done"), true);
  assert.equal(await archived("new-done"), false);
  assert.equal(await archived("old-waiting"), false, "work still waiting is never put away");
  const threadOf = async (id: string) =>
    (await db.get<{ archived?: boolean }>("o", "threads", id))?.archived;
  assert.equal(await threadOf(thread), true, "a task's side chat goes with it");
  assert.equal(await threadOf("quiet"), true);
  assert.notEqual(await threadOf("pinned"), true);
  assert.equal((await db.get<{ read: boolean }>("o", "notifications", "n1"))?.read, true);
  assert.equal((await db.get<{ read: boolean }>("o", "notifications", "n2"))?.read, false);
  // Restored by hand: task and its side chat come back.
  await archiveTask(db, "o", "old-done", false);
  assert.equal(await archived("old-done"), false);
  assert.equal(await threadOf(thread), false);
  await db.close();
});
