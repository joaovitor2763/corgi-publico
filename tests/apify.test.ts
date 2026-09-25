import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { ApifyService, actorPath, inputFields } from "../apps/server/src/apify/apify.ts";
import { apifyTools } from "../apps/server/src/apify/tools.ts";
import { createStore } from "../apps/server/src/platform/db.ts";

const KEY = randomBytes(32).toString("base64");
const TOKEN = "apify_api_test_token_123";

/** A stand-in for api.apify.com: records every call, answers from fixtures. */
function fakeApify(runStatus = 201) {
  const calls: { url: URL; auth?: string; body?: unknown }[] = [];
  const fetcher = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const auth = new Headers(init?.headers).get("Authorization") ?? undefined;
    calls.push({ url, auth, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (auth !== `Bearer ${TOKEN}`) return json(401, { error: { message: "bad token" } });
    if (url.pathname === "/v2/users/me") return json(200, { data: { username: "pessoa" } });
    if (url.pathname === "/v2/store")
      return json(200, {
        data: {
          items: [
            {
              name: "crawler-google-places",
              username: "compass",
              title: "Google Maps Scraper",
              description: "Places",
              stats: { totalUsers: 600000, actorReviewRating: 4.7 },
              currentPricingInfo: { pricingModel: "PAY_PER_EVENT" },
            },
          ],
        },
      });
    if (url.pathname.endsWith("/builds/default"))
      return json(200, {
        data: {
          inputSchema: JSON.stringify({
            properties: {
              searchStringsArray: { type: "array", title: "Search", prefill: ["pizza"] },
              maxCrawledPlacesPerSearch: {
                type: "integer",
                default: 50,
                description: "<b>Max</b>",
              },
            },
            required: ["searchStringsArray"],
          }),
        },
      });
    if (url.pathname.endsWith("/run-sync-get-dataset-items"))
      return runStatus === 201
        ? json(201, [{ title: "Pizzaria A", rating: 4.5 }, { title: "Pizzaria B" }])
        : json(runStatus, { error: { message: "nope" } });
    return json(404, {});
  }) as typeof fetch;
  return { calls, fetcher };
}

test("connecting checks the token with Apify and keeps it encrypted", async () => {
  const db = await createStore();
  const { fetcher } = fakeApify();
  const apify = new ApifyService(db, KEY, fetcher, "https://apify.test");
  assert.deepEqual(await apify.status("o"), { connected: false, maxUsd: 0.5 });
  await assert.rejects(apify.connect("o", "wrong_token_value"), /recusou a chave/);
  const status = await apify.connect("o", TOKEN, 1);
  assert.equal(status.connected, true);
  assert.equal(status.username, "pessoa");
  assert.equal(status.maxUsd, 1);
  const saved = await db.get<{ secret: string }>("o", "apify", "account");
  assert.ok(saved && !saved.secret.includes(TOKEN), "the token is never stored in clear");
  assert.equal((await apify.setLimit("o", 2)).maxUsd, 2);
  assert.equal((await apify.disconnect("o")).connected, false);
  assert.equal(await apify.connected("o"), false);
});

test("without TOKEN_ENCRYPTION_KEY the server makes its own key; the token is still encrypted", async () => {
  const db = await createStore();
  const apify = new ApifyService(db, undefined, fakeApify().fetcher, "https://apify.test");
  await apify.connect("o", TOKEN);
  const saved = await db.get<{ secret: string }>("o", "apify", "account");
  assert.ok(saved && !saved.secret.includes(TOKEN));
  const again = new ApifyService(db, undefined, fakeApify().fetcher, "https://apify.test");
  assert.equal((await again.search("o", "maps")).length, 1, "a restart reads it with the same key");
});

test("a run carries the person's dollar cap, time limit and item limit", async () => {
  const db = await createStore();
  const { calls, fetcher } = fakeApify();
  const apify = new ApifyService(db, KEY, fetcher, "https://apify.test");
  await apify.connect("o", TOKEN, 0.25);
  const result = await apify.run("o", "compass/crawler-google-places", { q: 1 }, 10);
  assert.ok(!("error" in result));
  assert.equal(result.count, 2);
  const run = calls.at(-1);
  assert.equal(
    run?.url.pathname,
    "/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items",
  );
  assert.equal(run?.url.searchParams.get("maxTotalChargeUsd"), "0.25");
  assert.equal(run?.url.searchParams.get("maxItems"), "10");
  assert.equal(run?.url.searchParams.get("timeout"), "240");
  assert.equal(run?.url.searchParams.get("token"), null, "the token goes in a header, not the URL");
  assert.deepEqual(run?.body, { q: 1 });
});

test("out of credit and slow runs come back as plain errors", async () => {
  for (const [status, pattern] of [
    [402, /no credit/],
    [408, /took over 4 minutes/],
    [400, /Apify 400: nope/],
  ] as const) {
    const db = await createStore();
    const apify = new ApifyService(db, KEY, fakeApify(status).fetcher, "https://apify.test");
    await apify.connect("o", TOKEN);
    const result = await apify.run("o", "compass/crawler-google-places", {}, 5);
    assert.match(String((result as { error?: string }).error), pattern);
  }
});

test("store search and input schema are shaped for the model", async () => {
  const db = await createStore();
  const apify = new ApifyService(db, KEY, fakeApify().fetcher, "https://apify.test");
  await apify.connect("o", TOKEN);
  const [actor] = await apify.search("o", "google maps");
  assert.equal(actor?.actor, "compass/crawler-google-places");
  assert.equal(actor?.pricing, "pay per event");
  const { fields } = await apify.describe("o", "compass/crawler-google-places");
  assert.deepEqual(fields[0], {
    name: "searchStringsArray",
    type: "array",
    required: true,
    title: "Search",
    description: undefined,
    options: undefined,
    default: undefined,
    example: ["pizza"],
  });
  assert.equal(fields[1]?.description, "Max");
  assert.equal(inputFields("not json"), undefined);
});

test("actor names are checked before they reach a URL", () => {
  assert.equal(actorPath("apify/web-scraper"), "apify~web-scraper");
  assert.throws(() => actorPath("../../users/me"), /inválido/);
  assert.throws(() => actorPath("a/b/c"), /inválido/);
});

test("run results pass the trust review before the model sees them", async () => {
  const db = await createStore();
  const apify = new ApifyService(db, KEY, fakeApify().fetcher, "https://apify.test");
  await apify.connect("o", TOKEN);
  const reviewed: string[] = [];
  const tools = apifyTools({
    apify,
    owner: "o",
    signal: new AbortController().signal,
    review: async (source) => {
      reviewed.push(`${source.kind}:${source.label}`);
      return { warning: "check" };
    },
  });
  const run = tools[2] as unknown as { name: string; execute: (args: unknown) => Promise<unknown> };
  assert.equal(run.name, "apify_run");
  const result = (await run.execute({
    actor: "compass/crawler-google-places",
    input: {},
    maxItems: 5,
  })) as { warning?: string; count?: number };
  assert.deepEqual(reviewed, ["app:compass/crawler-google-places"]);
  assert.equal(result.warning, "check");
  assert.equal(result.count, 2);
});
