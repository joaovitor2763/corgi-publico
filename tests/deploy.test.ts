import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { type Config, readConfig } from "../apps/server/src/platform/config.ts";
import { createStore, type Store } from "../apps/server/src/platform/db.ts";

// Running Corgi on a home Mac mini behind Tailscale: local mode + access key + web app on one port.
let db: Store;
let directory: string;
let web: string;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "corgi-deploy-"));
  web = join(directory, "web");
  await mkdir(join(web, "_expo", "static", "js"), { recursive: true });
  await writeFile(join(web, "index.html"), "<!doctype html><title>Corgi</title>");
  await writeFile(join(web, "_expo", "static", "js", "index-abc.js"), "console.log(1)");
  await writeFile(join(directory, "secret.txt"), "do not serve");
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

const local = (extra: Partial<Config> = {}): Config => ({
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "https://corgi.example.ts.net",
  dataDir: directory,
  agentBackend: "sample",
  googleRedirectUri: "https://corgi.example.ts.net/api/google/callback",
  allowedOrigins: [],
  ...extra,
});

test("a configured access key is required in local mode too", async () => {
  const { app } = await createApp(db, local({ accessKey: "k".repeat(32) }), { webAppDir: "" });
  const open = (body: unknown) =>
    app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await open({})).status, 401);
  assert.equal((await open({ accessKey: "wrong".repeat(6) })).status, 401);
  assert.equal((await open({ accessKey: "k".repeat(32) })).status, 200);
});

test("without a key, local mode stays on loopback; with one it may listen elsewhere", () => {
  const env = { ...process.env };
  try {
    process.env.WORKSPACE_MODE = "sample";
    process.env.HOST = "0.0.0.0";
    delete process.env.OPENMUSE_ACCESS_KEY;
    assert.throws(() => readConfig(), /loopback-only/);
    process.env.OPENMUSE_ACCESS_KEY = "short";
    assert.throws(() => readConfig(), /at least 24/);
    process.env.OPENMUSE_ACCESS_KEY = "x".repeat(32);
    assert.equal(readConfig().host, "0.0.0.0");
  } finally {
    process.env = env;
  }
});

test("the API serves the web app on the same origin, never files outside it", async () => {
  const { app } = await createApp(db, local(), { webAppDir: web });
  const home = await app.request("/");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<title>Corgi/);
  assert.equal(home.headers.get("cache-control"), "no-cache");
  const route = await app.request("/regi");
  assert.match(await route.text(), /<title>Corgi/, "app routes fall back to index.html");
  const bundle = await app.request("/_expo/static/js/index-abc.js");
  assert.match(bundle.headers.get("cache-control") ?? "", /immutable/);
  assert.match(bundle.headers.get("content-type") ?? "", /javascript/);
  // A bundle from an older deploy that a cached page still names: 404, never the HTML page
  // (the browser would run HTML as code and show a blank screen).
  const gone = await app.request("/_expo/static/js/web/index-old.js");
  assert.equal(gone.status, 404);
  assert.doesNotMatch(await gone.text(), /<title>/);
  assert.equal((await app.request("/assets/missing.png")).status, 404);
  // The app's code goes out compressed when the browser accepts it.
  const packed = await app.request("/_expo/static/js/index-abc.js", {
    headers: { "Accept-Encoding": "gzip, deflate, br" },
  });
  assert.equal(packed.headers.get("content-encoding"), "br");
  assert.match(packed.headers.get("cache-control") ?? "", /immutable/);
  assert.equal((await app.request("/%E0%A4%A")).status, 200, "malformed escapes fall back");
  for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt"]) {
    const response = await app.request(path);
    assert.doesNotMatch(await response.text(), /do not serve/, path);
  }
  assert.equal((await app.request("/api/health")).status, 200);
  const sameOrigin = await app.request("http://127.0.0.1:8787/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:8787" },
    body: "{}",
  });
  assert.equal(sameOrigin.status, 200, "the served app may call its own API from any address");
  const foreign = await app.request("http://127.0.0.1:8787/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: "{}",
  });
  assert.equal(foreign.status, 403);
  assert.equal((await app.request("/api/workspace")).status, 401, "API stays protected");
});
