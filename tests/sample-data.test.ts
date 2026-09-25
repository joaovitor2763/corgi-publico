import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/platform/config.ts";
import { createStore } from "../apps/server/src/platform/db.ts";
import type { Workspace } from "../packages/domain/src/index.ts";

const base = (dataDir: string): Config => ({
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir,
  agentBackend: "sample",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: ["http://localhost:8081"],
});

async function session(app: Awaited<ReturnType<typeof createApp>>["app"]) {
  const response = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return (await response.json()).token as string;
}

test("turning sample data off removes the fictional mailbox but keeps memories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-sample-"));
  const db = await createStore();
  try {
    const seeded = await createApp(db, base(directory));
    await session(seeded.app);
    assert.ok((await db.list("local-user", "mail")).length > 0);
    await db.put("local-user", "memories", { id: "m1", text: "Prefers Iguatemi cinemas" });

    const real = await createApp(db, { ...base(directory), sampleData: false });
    const token = await session(real.app);
    const snapshot = (await (
      await real.app.request("/api/workspace", { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as Workspace;
    assert.equal(snapshot.mail.length, 0);
    assert.equal(snapshot.events.length, 0);
    assert.equal(snapshot.runtime.sampleData, false);
    assert.equal((await db.list("local-user", "ideas")).length, 0);
    assert.equal(
      snapshot.actions.filter((action) => action.status === "awaiting_review").length,
      0,
    );
    assert.deepEqual(
      (await db.list<{ text: string }>("local-user", "memories")).map((m) => m.text),
      ["Prefers Iguatemi cinemas"],
    );
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
