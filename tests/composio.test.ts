import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ActionService } from "../apps/server/src/approvals/actions.ts";
import { ComposioService } from "../apps/server/src/connected-apps/composio.ts";
import { type AppWrite, appTools } from "../apps/server/src/connected-apps/composio-tools.ts";
import { createStore, type Store } from "../apps/server/src/platform/db.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close();
});

function fakeComposio(readOnly: boolean) {
  const executed: string[] = [];
  const composio = {
    enabled: true,
    connections: async () => [{ id: "ca_1", toolkit: "slack", status: "ACTIVE" }],
    search: async () => [],
    inspect: async (_owner: string, slug: string) => ({
      slug,
      toolkit: "slack",
      name: slug,
      description: "",
      readOnly,
      parameters: {},
    }),
    execute: async (_owner: string, slug: string) => {
      executed.push(slug);
      return { ok: true };
    },
  } as unknown as ComposioService;
  return { composio, executed };
}

test("read-only app tools run immediately", async () => {
  const { composio, executed } = fakeComposio(true);
  const writes: AppWrite[] = [];
  const [, use] = appTools(composio, "owner", async (w) => writes.push(w));
  const result = await use?.execute({
    tool: "SLACK_LIST_CHANNELS",
    arguments: {},
    summary: "List",
  });
  assert.deepEqual(executed, ["SLACK_LIST_CHANNELS"]);
  assert.equal(writes.length, 0);
  assert.equal((result as { data: string }).data, '{"ok":true}');
});

test("app tools that change something are prepared for review, never executed", async () => {
  const { composio, executed } = fakeComposio(false);
  const writes: AppWrite[] = [];
  const [, use] = appTools(composio, "owner", async (w) => {
    writes.push(w);
    return { status: "waiting_approval" };
  });
  const result = await use?.execute({
    tool: "SLACK_SEND_MESSAGE",
    arguments: { channel: "#eng", text: "hi" },
    summary: "Post hi in #eng",
  });
  assert.deepEqual(executed, []);
  assert.deepEqual(writes, [
    {
      toolkit: "slack",
      tool: "SLACK_SEND_MESSAGE",
      summary: "Post hi in #eng",
      arguments: { channel: "#eng", text: "hi" },
      connectedAccountId: "ca_1",
    },
  ]);
  assert.deepEqual(result, { status: "waiting_approval" });
});

test("app tools are absent without a Composio key", () => {
  const composio = { enabled: false } as unknown as ComposioService;
  assert.equal(appTools(composio, "owner", async () => ({})).length, 0);
});

test("approved app actions run once and skip the Google connection checks", async () => {
  const runs: unknown[] = [];
  const service = new ActionService(db, {
    execute: async (_owner, input) => {
      runs.push(input);
      return "done";
    },
    connected: async () => false,
    connection: async () => null,
  });
  const proposal = await service.propose("app-user", {
    kind: "app.action",
    data: {
      toolkit: "slack",
      tool: "SLACK_SEND_MESSAGE",
      summary: "Post hi",
      arguments: { text: "hi" },
    },
  });
  assert.equal(proposal.title, "Post hi");
  assert.equal(runs.length, 0);
  const done = await service.decide("app-user", proposal.id, proposal.hash, "approve");
  assert.equal(done.status, "succeeded");
  assert.equal(runs.length, 1);
});

test("per-app permission: read-only refuses changes and off hides the app", async () => {
  const { composio, executed } = fakeComposio(false);
  const writes: AppWrite[] = [];
  const [, readOnlyUse] = appTools(
    composio,
    "owner",
    async (w) => writes.push(w),
    undefined,
    async () => "read",
  );
  const refused = await readOnlyUse?.execute({
    tool: "SLACK_SEND_MESSAGE",
    arguments: {},
    summary: "Post",
  });
  assert.match(String((refused as { error: string }).error), /read-only/);
  assert.equal(writes.length, 0);
  const [find, offUse] = appTools(
    composio,
    "owner",
    async () => ({}),
    undefined,
    async () => "off",
  );
  assert.deepEqual((await find?.execute({ query: "send" })) as unknown, {
    connected: [],
    tools: [],
    note: "The person turned their connected apps off for the agent; they can change it in Ajustes › Apps.",
  });
  assert.ok(offUse);
  const off = (await offUse.execute({ tool: "X", arguments: {}, summary: "x" })) as {
    error: string;
  };
  assert.match(off.error, /turned slack off/);
  assert.deepEqual(executed, []);
});

/** Two Gmail accounts: work (default) and personal. */
function twoAccounts(readOnly: boolean) {
  const executed: { slug: string; account?: string }[] = [];
  const composio = {
    enabled: true,
    connections: async () => [
      {
        id: "ca_work",
        toolkit: "gmail",
        status: "ACTIVE",
        account: "voce@empresa.com",
        label: "Trabalho",
        isDefault: true,
      },
      { id: "ca_home", toolkit: "gmail", status: "ACTIVE", account: "jv@gmail.com" },
    ],
    search: async () => [],
    toolIndex: async () => [],
    inspect: async (_owner: string, slug: string) => ({
      slug,
      toolkit: "gmail",
      name: slug,
      description: "",
      readOnly,
      parameters: {},
    }),
    execute: async (
      _owner: string,
      slug: string,
      _args: unknown,
      _signal?: AbortSignal,
      account?: string,
    ) => {
      executed.push({ slug, account });
      return { ok: true };
    },
  } as unknown as ComposioService;
  return { composio, executed };
}

test("find_app_tools lists each app's accounts, default first", async () => {
  const { composio } = twoAccounts(true);
  const [find] = appTools(composio, "owner", async () => ({}));
  const result = (await find?.execute({ query: "email" })) as {
    accounts: Record<string, { id: string; account: string; default: boolean }[]>;
  };
  assert.deepEqual(
    result.accounts.gmail?.map((a) => [a.id, a.account, a.default]),
    [
      ["ca_work", "voce@empresa.com", true],
      ["ca_home", "jv@gmail.com", false],
    ],
  );
});

test("reads use the named account, or every account at once when none is named", async () => {
  const { composio, executed } = twoAccounts(true);
  const [, use] = appTools(composio, "owner", async () => ({}));
  const byEmail = (await use?.execute({
    tool: "GMAIL_FETCH_EMAILS",
    arguments: {},
    summary: "Read",
    account: "JV@gmail.com",
  })) as { account: string };
  assert.equal(byEmail.account, "jv@gmail.com");
  const byLabel = await use?.execute({
    tool: "GMAIL_FETCH_EMAILS",
    arguments: {},
    summary: "Read",
    account: "trabalho",
  });
  assert.ok(byLabel);
  const all = (await use?.execute({
    tool: "GMAIL_FETCH_EMAILS",
    arguments: {},
    summary: "Read",
  })) as { results: { account: string }[]; note: string };
  assert.deepEqual(all.results.map((r) => r.account).sort(), [
    "Trabalho (voce@empresa.com)",
    "jv@gmail.com",
  ]);
  assert.match(all.note, /all 2 gmail accounts/);
  assert.deepEqual(executed.map((e) => e.account).sort(), [
    "ca_home",
    "ca_home",
    "ca_work",
    "ca_work",
  ]);
  const unknown = (await use?.execute({
    tool: "GMAIL_FETCH_EMAILS",
    arguments: {},
    summary: "Read",
    account: "nobody@x.com",
  })) as { error: string; accounts: unknown[] };
  assert.match(unknown.error, /No connected gmail account/);
  assert.equal(unknown.accounts.length, 2);
  assert.equal(executed.length, 4);
});

test("a change with several accounts must name one, then is pinned to it for review", async () => {
  const { composio, executed } = twoAccounts(false);
  const writes: AppWrite[] = [];
  const [, use] = appTools(composio, "owner", async (w) => {
    writes.push(w);
    return { status: "waiting_approval" };
  });
  const refused = (await use?.execute({
    tool: "GMAIL_SEND_EMAIL",
    arguments: { to: "ana@acme.com" },
    summary: "Email Ana",
  })) as { error: string; accounts: { id: string }[] };
  assert.match(refused.error, /2 gmail accounts/);
  assert.deepEqual(
    refused.accounts.map((a) => a.id),
    ["ca_work", "ca_home"],
  );
  assert.equal(writes.length, 0);
  await use?.execute({
    tool: "GMAIL_SEND_EMAIL",
    arguments: { to: "ana@acme.com" },
    summary: "Email Ana",
    account: "ca_home",
  });
  assert.deepEqual(writes, [
    {
      toolkit: "gmail",
      tool: "GMAIL_SEND_EMAIL",
      summary: "Email Ana",
      arguments: { to: "ana@acme.com" },
      connectedAccountId: "ca_home",
      account: "jv@gmail.com",
    },
  ]);
  assert.deepEqual(executed, []);
});

test("an approved app action runs as the account it was prepared for", async () => {
  const runs: unknown[] = [];
  const service = new ActionService(db, {
    execute: async (_owner, input) => {
      if (input.kind === "app.action") runs.push(input.data.connectedAccountId);
      return "done";
    },
    connected: async () => false,
    connection: async () => null,
  });
  const proposal = await service.propose("app-user", {
    kind: "app.action",
    data: {
      toolkit: "gmail",
      tool: "GMAIL_SEND_EMAIL",
      summary: "Email Ana",
      arguments: {},
      connectedAccountId: "ca_home",
      account: "jv@gmail.com",
    },
  });
  await service.decide("app-user", proposal.id, proposal.hash, "approve");
  assert.deepEqual(runs, ["ca_home"]);
});

test("Composio execution passes the connected account; accounts get names and one default", async () => {
  const calls: Record<string, unknown>[] = [];
  const service = new ComposioService({ publicUrl: "http://x" } as never, db);
  Object.assign(service, {
    client: {
      tools: {
        getRawComposioToolBySlug: async (slug: string) => ({ slug, version: "v1" }),
        execute: async (_slug: string, body: Record<string, unknown>) => {
          calls.push(body);
          return { successful: true, data: {} };
        },
      },
      toolkits: { get: async (slug: string) => ({ slug, name: slug, meta: {} }) },
      connectedAccounts: {
        list: async () => ({
          items: [
            {
              id: "ca_b",
              toolkit: { slug: "gmail" },
              status: "ACTIVE",
              createdAt: "2026-02-01",
              data: { displayName: "b@x.com" },
            },
            {
              id: "ca_a",
              toolkit: { slug: "gmail" },
              status: "ACTIVE",
              createdAt: "2026-01-01",
              data: { displayName: "a@x.com" },
            },
            // No identity listed; tests never call real apps to find one.
            { id: "ca_c", toolkit: { slug: "googlecalendar" }, status: "ACTIVE", data: {} },
          ],
        }),
      },
    },
  });
  await service.execute("acct-user", "GMAIL_SEND_EMAIL", {}, undefined, "ca_b");
  await service.execute("acct-user", "GMAIL_FETCH_EMAILS", {});
  assert.equal(calls[0]?.connectedAccountId, "ca_b");
  assert.equal("connectedAccountId" in (calls[1] ?? {}), false);
  const listed = await service.connections("acct-user");
  assert.deepEqual(
    listed.map((c) => [c.id, c.account, !!c.isDefault]),
    [
      ["ca_b", "b@x.com", false],
      ["ca_a", "a@x.com", true],
      ["ca_c", undefined, true],
    ],
  );
  assert.equal(calls.length, 2);
  await service.updateAccount("acct-user", "ca_b", { label: "Pessoal", isDefault: true });
  const renamed = await service.connections("acct-user");
  assert.deepEqual(
    renamed.filter((c) => c.toolkit === "gmail").map((c) => [c.id, c.label, !!c.isDefault]),
    [
      ["ca_b", "Pessoal", true],
      ["ca_a", undefined, false],
    ],
  );
});

test("an oversized result comes back as a digest, with the raw result readable by page", async () => {
  const { composio } = fakeComposio(true);
  const messages = Array.from({ length: 3000 }, (_, i) => ({ text: `mensagem ${i} `.repeat(3) }));
  (composio as unknown as { execute: () => Promise<unknown> }).execute = async () => ({ messages });
  const seen: string[] = [];
  const [, use, , page] = appTools(
    composio,
    "owner",
    async () => ({}),
    undefined,
    undefined,
    undefined,
    {
      request: "Olha nas DMs",
      digest: async (tool, data) => {
        seen.push(`${tool}:${data.length}`);
        return "3000 mensagens, 2 relevantes: …";
      },
    },
  );
  const result = (await use?.execute({
    tool: "SLACK_SEARCH_MESSAGES",
    arguments: {},
    summary: "Search",
  })) as { digest: string; resultId: string; pages: number; data?: string };
  assert.equal(result.digest, "3000 mensagens, 2 relevantes: …");
  assert.equal(result.data, undefined);
  assert.ok(result.pages >= 2);
  assert.equal(seen.length, 1);
  const first = (await page?.execute({ resultId: result.resultId, page: 1 } as never)) as {
    data: string;
    pages: number;
  };
  assert.equal(first.pages, result.pages);
  assert.match(first.data, /mensagem 0/);
});

test("files an app hands back are saved to the library and replaced by their fileId", async () => {
  const { saveDownloads } = await import("../apps/server/src/connected-apps/composio-tools.ts");
  const saved: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("%PDF-1.4 fake")) as typeof fetch;
  try {
    const result = {
      data: {
        file: { name: "boleto.pdf", s3url: "https://s3.example/x", mimetype: "application/pdf" },
      },
      broken: { s3url: "http://insecure" },
    };
    await saveDownloads(result, async (name) => {
      saved.push(name);
      return { id: "f-1", name };
    });
    assert.deepEqual(saved, ["boleto.pdf"]);
    assert.deepEqual(result.data.file, { fileId: "f-1", name: "boleto.pdf", saved: true });
    // Only https links are fetched.
    assert.equal((result.broken as { s3url?: string }).s3url, "http://insecure");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a route polyline in an app result is found for show_route", async () => {
  const { findPolyline } = await import("../apps/server/src/connected-apps/composio-tools.ts");
  assert.equal(
    findPolyline({
      response_data: { routes: [{ polyline: { encodedPolyline: "dqynCpuv{Gs@|@YWmIe" } }] },
    }),
    "dqynCpuv{Gs@|@YWmIe",
  );
  assert.equal(
    findPolyline({ routes: [{ overview_polyline: { points: "_p~iF~ps|U_ulLnnqC" } }] }),
    "_p~iF~ps|U_ulLnnqC",
  );
  assert.equal(findPolyline({ routes: [] }), undefined);
});

test("an account is named from its OpenID id_token or its instance URL, without a call", async () => {
  const { idTokenIdentity } = await import("../apps/server/src/connected-apps/composio.ts");
  const payload = Buffer.from(JSON.stringify({ email: "pessoa@empresa.com" })).toString(
    "base64url",
  );
  assert.equal(idTokenIdentity(`header.${payload}.signature`), "pessoa@empresa.com");
  assert.equal(idTokenIdentity("not-a-jwt"), undefined);
  assert.equal(idTokenIdentity(undefined), undefined);
});

test("the Apps list hides dead connections of an app that has a working one", async () => {
  const { tidyConnections, NATIVE_APPS } = await import(
    "../apps/server/src/connected-apps/catalog.ts"
  );
  const list = [
    { id: "1", toolkit: "notion", status: "EXPIRED" },
    { id: "2", toolkit: "google_maps", status: "EXPIRED" },
    { id: "3", toolkit: "google_maps", status: "ACTIVE" },
    { id: "4", toolkit: "gmail", status: "ACTIVE" },
    { id: "5", toolkit: "gmail", status: "ACTIVE" },
  ];
  assert.deepEqual(
    tidyConnections(list).map((c) => c.id),
    ["1", "3", "4", "5"],
    "an app with only a dead connection keeps it, to reconnect",
  );
  assert.ok(NATIVE_APPS.some((native) => native.test("apify_mcp")));
});

test("Apify is offered as a connector for searches about it, with its own logo", async () => {
  const { APIFY_APP, apifyMatches } = await import("../apps/server/src/connected-apps/catalog.ts");
  for (const q of ["", "Apify", "api", "scraper", "coletores"]) assert.ok(apifyMatches(q), q);
  for (const q of ["gmail", "hubspot"]) assert.ok(!apifyMatches(q), q);
  assert.equal(APIFY_APP.native, "apify");
  assert.match(APIFY_APP.logo, /apify$/);
});
