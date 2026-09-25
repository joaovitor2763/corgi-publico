import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunAgentInput } from "@ag-ui/core";
import { cacheSummary, recordTiming } from "../apps/server/src/agent/timings.ts";
import { createStore } from "../apps/server/src/platform/db.ts";

const input = (runId: string) =>
  ({
    threadId: "default",
    runId,
    messages: [{ id: "u", role: "user", content: "oi" }],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  }) as unknown as RunAgentInput;

test("cache use is summarized per model from the turns' own measurements", async () => {
  const db = await createStore();
  await recordTiming(db, "owner", input("a"), [
    { at: 10, label: "model →" },
    { at: 1510, label: "model first event" },
    { at: 3000, label: "model ✓ zai/glm-5.3-flash in 200 (cache 159800) out 40" },
    { at: 3001, label: "model →" },
    { at: 9001, label: "model first event" },
    { at: 9500, label: "model ✓ zai/glm-5.3-flash in 160000 (cache 0) out 5" },
  ]);
  const [glm] = await cacheSummary(db, "owner");
  assert.equal(glm?.model, "zai/glm-5.3-flash");
  assert.equal(glm?.calls, 2);
  assert.equal(glm?.hitRate, 50);
  assert.equal(glm?.cachedShare, 50);
  assert.deepEqual(glm?.firstTokenMs, { hit: 1500, miss: 6000 });
  await db.close();
});
