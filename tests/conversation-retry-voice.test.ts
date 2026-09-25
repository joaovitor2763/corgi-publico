import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/platform/config.ts";
import { createStore, type Store } from "../apps/server/src/platform/db.ts";

let db: Store, app: Awaited<ReturnType<typeof createApp>>["app"], token: string, directory: string;
let stop: () => void;
const uploads: { path: string; body: string }[] = [];
const auth = () => ({ Authorization: `Bearer ${token}` });
const json = () => ({ ...auth(), "Content-Type": "application/json" });
const previousKey = process.env.IMPOSSIBL_API_KEY;

before(async () => {
  // Loopback stand-in for the provider's transcription endpoint.
  const provider = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    uploads.push({ path: request.url ?? "", body });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ text: " Marca com o Rafael amanhã às 15h. " }));
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("fixture address");
  stop = () => provider.close();
  process.env.IMPOSSIBL_API_KEY = "voice-fixture-not-a-secret";
  directory = await mkdtemp(join(tmpdir(), "corgi-voice-"));
  db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
    impossiblBaseUrl: `http://127.0.0.1:${address.port}/v1`,
  };
  ({ app } = await createApp(db, config));
  const response = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  token = (await response.json()).token;
});
after(async () => {
  stop();
  if (previousKey === undefined) delete process.env.IMPOSSIBL_API_KEY;
  else process.env.IMPOSSIBL_API_KEY = previousKey;
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("a voice note becomes text through the transcription model, in Portuguese", async () => {
  const form = new FormData();
  form.set("audio", new File([new Uint8Array([1, 2, 3, 4])], "nota.m4a", { type: "audio/mp4" }));
  const response = await app.request("/api/transcribe", {
    method: "POST",
    headers: auth(),
    body: form,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: "Marca com o Rafael amanhã às 15h." });
  const sent = uploads.at(-1);
  assert.equal(sent?.path, "/v1/audio/transcriptions");
  assert.match(sent?.body ?? "", /whisper-large-v3-turbo/);
  assert.match(sent?.body ?? "", /name="language"\r\n\r\npt/);
});

test("transcription rejects a request without audio", async () => {
  const response = await app.request("/api/transcribe", {
    method: "POST",
    headers: auth(),
    body: new FormData(),
  });
  assert.equal(response.status, 400);
});

test("trying again drops the replaced answer, so it never comes back or reaches the model", async () => {
  const messages = [
    { id: "u1", role: "user", content: "Oi" },
    { id: "a1", role: "assistant", content: "Olá!" },
    { id: "u2", role: "user", content: "Qual minha agenda?" },
    { id: "a2", role: "assistant", content: "Resposta ruim" },
  ];
  await app.request("/api/conversation?thread=default", {
    method: "PUT",
    headers: json(),
    body: JSON.stringify({ messages }),
  });
  const cut = await app.request("/api/conversation/truncate?thread=default", {
    method: "POST",
    headers: json(),
    body: JSON.stringify({ from: "a2" }),
  });
  assert.equal(cut.status, 200);
  // The app then saves its window without the old answer: it must stay gone.
  await app.request("/api/conversation?thread=default", {
    method: "PUT",
    headers: json(),
    body: JSON.stringify({ messages: messages.slice(0, 3) }),
  });
  const page = await (
    await app.request("/api/conversation?thread=default", { headers: auth() })
  ).json();
  assert.deepEqual(
    page.messages.map((m: { id: string }) => m.id),
    ["u1", "a1", "u2"],
  );
  // An unknown id changes nothing.
  await app.request("/api/conversation/truncate?thread=default", {
    method: "POST",
    headers: json(),
    body: JSON.stringify({ from: "missing" }),
  });
  const again = await (
    await app.request("/api/conversation?thread=default", { headers: auth() })
  ).json();
  assert.equal(again.messages.length, 3);
});

test("saving a side chat from the app keeps which task or helper it belongs to", async () => {
  const id = "0a0b0c0d-1111-4222-8333-444455556666";
  const save = (content: string) =>
    app.request(`/api/conversation?thread=${id}`, {
      method: "PUT",
      headers: json(),
      body: JSON.stringify({ messages: [{ id: content, role: "user", content }] }),
    });
  await save("oi");
  const created = (await db.scan<{ id: string; title: string }>("threads")).find(
    (row) => row.value.id === id,
  );
  assert.ok(created, "the app's save creates the thread");
  await db.put(created.owner, "threads", {
    ...created.value,
    title: "📡 Radar",
    taskId: "task-1",
    fuzzyId: "fuzzy-1",
  });
  await save("de novo");
  const thread = await db.get<{ taskId?: string; fuzzyId?: string; title: string }>(
    created.owner,
    "threads",
    id,
  );
  assert.equal(thread?.taskId, "task-1");
  assert.equal(thread?.fuzzyId, "fuzzy-1");
  assert.equal(thread?.title, "📡 Radar");
});
