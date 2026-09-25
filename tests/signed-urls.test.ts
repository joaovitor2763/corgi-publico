import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/platform/config.ts";
import { createStore, type Store } from "../apps/server/src/platform/db.ts";
import type { Artifact } from "../packages/domain/src/index.ts";

// A file's signed link is what an <img>, a new tab or a share sheet can open without the
// session: it must open exactly that file, for its owner, for a few minutes, and nothing else.
let db: Store;
let directory: string;
let app: Awaited<ReturnType<typeof createApp>>["app"];
let token: string;
let key: string;
let png: Artifact;
let other: Artifact;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "corgi-signed-"));
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  ({ app } = await createApp(db, config, { webAppDir: "" }));
  const session = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  token = (await session.json()).token;
  key = await readFile(join(directory, "session-signing-key"), "utf8");
  png = await upload("coortes_A_cumulativo.png", PNG);
  other = await upload("outro.png", PNG);
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

// 1×1 transparent PNG.
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const bearer = () => ({ Authorization: `Bearer ${token}` });
async function upload(name: string, bytes: Uint8Array): Promise<Artifact> {
  const form = new FormData();
  form.append("file", new File([Buffer.from(bytes)], name));
  const response = await app.request("/api/files", {
    method: "POST",
    headers: bearer(),
    body: form,
  });
  assert.equal(response.status, 201);
  return response.json();
}
/** A link signed the way the server signs, with whatever owner, path and expiry the test wants. */
function link(owner: string, path: string, expires: number, signature?: string) {
  const expected = createHmac("sha256", key).update(`${owner}\n${path}\n${expires}`).digest("hex");
  return `${path}?owner=${encodeURIComponent(owner)}&expires=${expires}&signature=${signature ?? expected}`;
}
const relative = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

test("a signed link opens the file without a session, until it expires", async () => {
  const shown = await app.request(relative(png.url));
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get("content-type"), "image/png");
  assert.match(shown.headers.get("content-disposition") ?? "", /^inline/);
  assert.equal((await shown.arrayBuffer()).byteLength, PNG.length);
  const expires = Number(new URL(png.url).searchParams.get("expires"));
  assert.ok(expires > Date.now() + 10 * 60 * 1000 && expires <= Date.now() + 15 * 60 * 1000);

  const path = `/api/files/${png.id}/content`;
  const expired = await app.request(link("local-user", path, Date.now() - 1000));
  assert.equal(expired.status, 401);
});

test("a signed link is good for one file and one owner, and a changed one for nothing", async () => {
  const path = `/api/files/${png.id}/content`;
  const expires = Date.now() + 60_000;
  const signature =
    new URL(link("local-user", path, expires), "http://localhost").searchParams.get("signature") ??
    "";
  // The signature of one file on the path of another.
  const wrongFile = await app.request(
    link("local-user", `/api/files/${other.id}/content`, expires, signature),
  );
  assert.equal(wrongFile.status, 403);
  // Another owner named with this owner's signature.
  const wrongOwner = await app.request(link("someone-else", path, expires, signature));
  assert.equal(wrongOwner.status, 403);
  // An expiry pushed forward keeps the old signature.
  const later = await app.request(link("local-user", path, expires + 1, signature));
  assert.equal(later.status, 403);
  // A signature with one character changed.
  const flipped = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
  const tampered = await app.request(link("local-user", path, expires, flipped));
  assert.equal(tampered.status, 403);
  // No signature and no session at all.
  assert.equal((await app.request(path)).status, 401);
  // A signature on a route that is not a file: the session is still required.
  assert.equal((await app.request(link("local-user", "/api/workspace", expires))).status, 401);
});

test("the session opens the file as before, even with an expired link on the URL", async () => {
  const path = `/api/files/${png.id}/content`;
  const plain = await app.request(path, { headers: bearer() });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get("content-type"), "image/png");
  const stale = await app.request(link("local-user", path, Date.now() - 1000), {
    headers: bearer(),
  });
  assert.equal(stale.status, 200);
  const forged = await app.request(path, { headers: { Authorization: "Bearer nope" } });
  assert.equal(forged.status, 401);
});

test("the app can ask for a file with links signed just now, and force a download", async () => {
  assert.equal((await app.request(`/api/files/${png.id}`)).status, 401);
  const response = await app.request(`/api/files/${png.id}`, { headers: bearer() });
  assert.equal(response.status, 200);
  const fresh: Artifact = await response.json();
  assert.equal(fresh.id, png.id);
  assert.equal(fresh.name, "coortes_A_cumulativo.png");
  assert.notEqual(fresh.url, "");
  assert.ok(fresh.thumbnailUrl);
  assert.equal((await app.request(relative(fresh.url))).status, 200);
  assert.equal((await app.request(relative(fresh.thumbnailUrl ?? ""))).status, 200);
  const download = await app.request(`${relative(fresh.url)}&download=1`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition") ?? "", /^attachment/);
  assert.equal((await app.request("/api/files/missing", { headers: bearer() })).status, 404);
});
