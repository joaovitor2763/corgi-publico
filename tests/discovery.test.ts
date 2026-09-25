import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppTool } from "../apps/server/src/connected-apps/composio.ts";
import { discover, preselect } from "../apps/server/src/connected-apps/discovery.ts";
import type { AskJev } from "../apps/server/src/trust/jev.ts";

const tool = (slug: string, description: string, readOnly = true): AppTool => ({
  slug,
  toolkit: slug.split("_")[0].toLowerCase(),
  name: slug,
  description,
  readOnly,
  parameters: {},
});
const index = [
  tool("GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS", "List events across all calendars"),
  tool("GOOGLECALENDAR_EVENTS_LIST", "List events of a calendar"),
  tool("GOOGLECALENDAR_CREATE_EVENT", "Create an event", false),
  tool("GOOGLECALENDAR_ACL_DELETE", "Delete an access rule", false),
  tool("GMAIL_FETCH_EMAILS", "Fetch emails matching a query"),
  tool("GMAIL_SEND_EMAIL", "Send an email", false),
  tool("SLACK_SEARCH_MESSAGES", "Search messages in Slack"),
  tool("SLACK_CHAT_POST_MESSAGE", "Post a message to a channel", false),
];

test("candidates come from the model's search words and the apps' guides, not the person's words", () => {
  const slugs = preselect(index, "calendar events tomorrow").map((t) => t.slug);
  assert.ok(slugs.includes("GOOGLECALENDAR_EVENTS_LIST"));
  assert.equal(
    slugs[0],
    "GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS",
    "the guide's pick ranks first",
  );
  assert.ok(!slugs.includes("GOOGLECALENDAR_ACL_DELETE"), "unrelated tools stay out");
  assert.deepEqual(preselect(index, "zzz qqq"), [], "nothing matches: no guesses");
});

test("Jev keeps the best few with schemas and the rest by name; without Jev the order decides", async () => {
  const ask: AskJev = async (_state, questions) =>
    Object.fromEntries(
      Object.entries(questions).map(([id, q]) => [
        id,
        { noul: /SLACK_SEARCH_MESSAGES/.test(q.instructions) ? 0.95 : 0.1 },
      ]),
    );
  const picked = await discover(
    index,
    "search messages slack channel",
    "o que a Ana mandou?",
    ask,
    {
      keep: 1,
    },
  );
  assert.deepEqual(
    picked.tools.map((t) => t.slug),
    ["SLACK_SEARCH_MESSAGES"],
  );
  assert.ok(picked.more.some((t) => t.slug === "SLACK_CHAT_POST_MESSAGE"));
  const plain = await discover(index, "search messages slack channel", "x", undefined, { keep: 1 });
  assert.equal(plain.tools.length, 1);
  const failing: AskJev = async () => {
    throw new Error("down");
  };
  const fallback = await discover(index, "search messages slack", "x", failing, { keep: 1 });
  assert.equal(fallback.tools.length, 1, "a Jev failure falls back to the lexical order");
});

test("one plain SELECT is a read; anything that could change data stays a reviewed change", async () => {
  const { readOnlySql } = await import("../apps/server/src/connected-apps/composio-tools.ts");
  for (const sql of [
    "SELECT sum(valor) FROM vendas WHERE dia = current_date - 1",
    "  with t as (select 1) select * from t;",
    "SHOW TABLES IN main.vendas",
    "DESCRIBE main.vendas.pedidos",
    "-- total\nSELECT count(*) FROM pedidos",
  ])
    assert.equal(readOnlySql(sql), true, sql);
  for (const sql of [
    "DELETE FROM vendas",
    "SELECT 1; DROP TABLE vendas",
    "UPDATE vendas SET valor = 0",
    "CREATE TABLE x AS SELECT * FROM vendas",
    "WITH x AS (SELECT 1) INSERT INTO y SELECT * FROM x",
    "GRANT SELECT ON vendas TO everyone",
    42,
  ])
    assert.equal(readOnlySql(sql), false, String(sql));
});

test("plural words and verb kin still match, and naming an app keeps the search in it", () => {
  const drive = [
    ...index,
    tool("GOOGLEDRIVE_FIND_FILE", "Find a file in Google Drive by name or query"),
    tool("GOOGLEDRIVE_LIST_PERMISSIONS", "List the sharing permissions of a file"),
    tool("GMAIL_LIST_DRAFTS", "List drafts with their files attached"),
  ];
  const slugs = preselect(drive, "drive search files").map((t) => t.slug);
  assert.equal(slugs[0], "GOOGLEDRIVE_FIND_FILE", "search ~ find, files ~ file");
  assert.ok(
    slugs.every((slug) => slug.startsWith("GOOGLEDRIVE_")),
    "the named app narrows the results",
  );
});
