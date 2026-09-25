import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/platform/db.ts";
import { PushService, pushFor } from "../apps/server/src/push/push.ts";

const device = (n: number) => ({
  endpoint: `https://web.push.apple.com/device-${n}`,
  keys: {
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
});

test("a device signs up once and gets the news it wants, with the waiting count", async () => {
  const db = await createStore();
  const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
  const push = new PushService(db, "https://corgi.example", (async (
    sub: { endpoint: string },
    payload: string,
  ) => {
    if (sub.endpoint.endsWith("device-2"))
      throw Object.assign(new Error("gone"), { statusCode: 410 });
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    return {} as never;
  }) as never);
  const { publicKey } = await push.vapid();
  assert.equal((await push.vapid()).publicKey, publicKey, "keys are made once");
  await push.subscribe("o", device(1), "iPhone");
  await push.subscribe("o", device(1), "iPhone");
  await push.subscribe("o", device(2), "iPad");
  assert.equal((await push.devices("o")).length, 2);
  await db.put("o", "tasks", { id: "t1", status: "waiting_input", title: "x" });
  const count = await push.notify("o", {
    title: "Preciso de você: Report",
    body: "Qual o objetivo?",
    url: "/?open=task%3At1",
    category: "questions",
    tag: "task:t1",
  });
  assert.equal(count, 1);
  assert.equal(sent[0]?.payload.badge, 1);
  assert.equal(sent[0]?.payload.url, "/?open=task%3At1");
  assert.equal((await push.devices("o")).length, 1, "a device the phone dropped is forgotten");
  await push.setPrefs("o", { done: false });
  assert.equal(await push.notify("o", { title: "Pronto", body: "", category: "done" }), 0);
  await db.close();
});

test("each kind of news becomes the right push, and chatter becomes none", () => {
  assert.equal(
    pushFor({ title: "Para revisar", body: "", taskId: "t", key: "review:a1" })?.category,
    "approvals",
  );
  assert.equal(
    pushFor({ title: "Preciso", body: "", taskId: "t", key: "input:t:h" })?.category,
    "questions",
  );
  assert.equal(
    pushFor({ title: "Pronto", body: "", taskId: "t", status: "done" })?.url,
    "/?open=task%3At",
  );
  assert.equal(pushFor({ title: "Erro", body: "", status: "blocked" })?.category, "problems");
  assert.equal(pushFor({ title: "Novidade", body: "", status: "update" }), undefined);
});
