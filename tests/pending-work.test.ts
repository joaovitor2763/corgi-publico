import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingWork } from "../apps/server/src/agent/pending-work.ts";
import { createStore } from "../apps/server/src/platform/db.ts";

test("agent_status shows only what is open now, approvals included", async () => {
  const db = await createStore();
  const now = new Date("2026-09-24T12:00:00Z");
  const action = (id: string, status: string, expiresAt: string) =>
    db.put("o", "actions", { id, title: id, status, createdAt: now.toISOString(), expiresAt });
  await action("waiting", "awaiting_review", "2026-09-25T00:00:00Z");
  await action("lapsed", "awaiting_review", "2026-09-24T00:00:00Z");
  await action("denied", "denied", "2026-09-25T00:00:00Z");
  const task = (id: string, status: string, updatedAt = now.toISOString()) =>
    db.put("o", "tasks", { id, title: id, kind: "agent", status, updatedAt });
  await task("running", "running");
  await task("done-today", "succeeded");
  await task("done-long-ago", "succeeded", "2026-08-01T00:00:00Z");
  await db.put("o", "memories", { id: "m", text: "not part of the status" });

  const status = await pendingWork(db, "o", now);
  assert.deepEqual(
    status.approvals_waiting.map((a) => a.id),
    ["waiting"],
  );
  assert.deepEqual(
    status.tasks_open.map((t) => t.id),
    ["running"],
  );
  assert.deepEqual(
    status.tasks_finished_recently.map((t) => t.id),
    ["done-today"],
  );
  assert.ok(!("memories" in status));
});
