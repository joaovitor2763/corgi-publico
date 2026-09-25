import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  BUDGET,
  keptMessages,
  searchHistory,
  textOf,
  tokens,
} from "../apps/server/src/agent/context-window.ts";
import { compactThread, fitThread } from "../apps/server/src/agent/thread-summary.ts";
import { compact } from "../apps/server/src/connected-apps/compact.ts";
import { createStore, type Store } from "../apps/server/src/platform/db.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close();
});

const user = (content: string) => ({ role: "user", content, timestamp: 0 }) as AgentMessage;
const reply = (text: string) =>
  ({ role: "assistant", content: [{ type: "text", text }], timestamp: 0 }) as AgentMessage;
const call = (name: string) =>
  ({
    role: "assistant",
    content: [{ type: "toolCall", id: name, name, arguments: {} }],
    timestamp: 0,
  }) as AgentMessage;
const result = (text: string) =>
  ({
    role: "toolResult",
    toolCallId: "x",
    toolName: "x",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 0,
  }) as AgentMessage;

/** n turns: question, tool call, tool result of `size` characters, answer. */
const thread = (turns: number, size = 4000) =>
  Array.from({ length: turns }, (_, i) => [
    user(`pergunta ${i + 1}`),
    call("find"),
    result("x".repeat(size)),
    reply(`resposta ${i + 1}`),
  ]).flat();

test("a thread under the budget goes whole, with nothing summarized", async () => {
  const history = thread(20);
  const fitted = await fitThread(db, "o", "small", history, async () => {
    throw new Error("must not summarize");
  });
  assert.equal(fitted.history.length, history.length);
  assert.equal(fitted.context, "");
});

test("past the hard limit, the old part becomes a checkpoint with its message range", async () => {
  // ~6k tokens per turn: 80 turns is ~480k tokens, over the hard limit.
  const history = thread(80, 21_000);
  const prompts: string[] = [];
  const fitted = await fitThread(db, "o", "big", history, async (prompt) => {
    prompts.push(prompt);
    return "- A Cora é filha da pessoa [1–2]";
  });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /\[1\] Pessoa: pergunta 1/);
  assert.ok(tokens(fitted.history) <= BUDGET.keepRecent + 10_000);
  assert.equal(fitted.history[0].role, "user");
  assert.match(fitted.context, /## Mensagens 1–\d+\n- A Cora é filha da pessoa/);
  assert.match(fitted.context, /conversation_history with from\/to/);
  // Next turn: the same checkpoint is reused, no new summary, same cut (stable prefix).
  const again = await fitThread(db, "o", "big", [...history, user("e agora?")], async () => {
    throw new Error("must not summarize again");
  });
  assert.equal(textOf(again.history[0]), textOf(fitted.history[0]));
});

test("checkpoints merge into a higher level when their summaries grow", async () => {
  let calls = 0;
  const long = "resumo ".repeat(20_000); // ~40k tokens per summary
  const summarize = async (prompt: string) => {
    calls++;
    return prompt.startsWith("Merge") ? "fundido" : long;
  };
  let history: AgentMessage[] = [];
  let checkpoints: Awaited<ReturnType<typeof compactThread>> = [];
  for (let round = 0; round < 3; round++) {
    history = [...history, ...thread(80, 21_000)];
    checkpoints = await compactThread(db, "o", "merge", history, summarize);
  }
  assert.equal(checkpoints[0].summary, "fundido");
  assert.equal(checkpoints[0].level, 2);
  assert.equal(checkpoints[0].from, 0);
  assert.ok(calls >= 3);
});

test("big old tool results are shortened; the last turns keep theirs", () => {
  const history = thread(20, 30_000);
  const kept = keptMessages(history, 0);
  assert.match(textOf(kept[2]), /resultado antigo encurtado/);
  assert.equal(textOf(kept.at(-2) as AgentMessage).length, 30_000);
  assert.equal(
    keptMessages(thread(10, 30_000), 0).filter((m) => /encurtado/.test(textOf(m))).length,
    0,
    "a short chat keeps everything",
  );
});

test("the shortening point moves every 10 turns, so the cached prefix survives turn to turn", () => {
  const history = thread(24, 30_000);
  const shape = (turns: number) => {
    const part = history.slice(0, turns * (history.length / 24));
    return keptMessages(part, 0).map((m) => textOf(m).length);
  };
  const before = shape(21);
  const after = shape(22);
  assert.deepEqual(after.slice(0, before.length), before, "one more turn changes nothing earlier");
});

test("conversation_history finds earlier words, ignoring accents, or reads a range", () => {
  const history = [
    { role: "user", text: "Essa é a Cora, minha filha" },
    { role: "assistant", text: "Que fofa!" },
    { role: "tool", text: "{}" },
    { role: "user", text: "Qual a reunião de amanhã?" },
  ];
  const found = searchHistory(history, { query: "cora filha" });
  assert.equal(found.matches, 1);
  assert.equal(found.messages[0].n, 1);
  assert.equal(searchHistory(history, { query: "reuniao" }).messages[0].n, 4);
  const range = searchHistory(history, { from: 2, to: 4 });
  assert.deepEqual(
    range.messages.map((m) => m.n),
    [2, 4],
  );
});

test("app results lose their noise, not their content", () => {
  const slack = {
    messages: {
      matches: [
        {
          text: "Pode revisar o PR?",
          username: "ana",
          permalink: "https://x.slack.com/p1",
          blocks: [{ type: "rich_text", elements: [{ text: "Pode revisar o PR?" }] }],
          channel: { id: "D1", is_im: true, is_archived: false, is_private: true, name: "U1" },
          attachments: [
            { title: "Link", image_url: "https://img", image_bytes: 1, text: "prévia" },
          ],
          no_reactions: true,
          score: 0.3,
        },
      ],
    },
  };
  const out = compact(slack) as typeof slack;
  const match = out.messages.matches[0] as Record<string, unknown>;
  assert.equal(match.text, "Pode revisar o PR?");
  assert.equal(match.permalink, "https://x.slack.com/p1");
  assert.equal(match.blocks, undefined);
  assert.equal(match.score, undefined);
  assert.deepEqual(match.channel, { id: "D1", is_im: true, is_private: true, name: "U1" });
  assert.deepEqual(match.attachments, [{ title: "Link", text: "prévia" }]);
  // A text on its own (one document) stays whole; inside a list of items, each is cut.
  assert.equal(
    (compact({ description: "a".repeat(5000) }) as { description: string }).description.length,
    5000,
  );
  const list = compact({ items: [1, 2, 3].map(() => ({ body: "a".repeat(5000) })) }) as {
    items: { body: string }[];
  };
  assert.ok(list.items[0].body.length < 3100);
});

test("e-mail bodies in HTML become plain words, and the raw payload is dropped", () => {
  const out = compact({
    messageText: `<!doctype html><html><head><style>.x{}</style></head><body><div>Olá JV,</div><p>O boleto vence <b>amanhã</b>.</p>${"<span></span>".repeat(50)}</body></html>`,
    payload: { parts: [{ body: { data: "PGh0bWw+" } }] },
    subject: "Boleto",
  }) as Record<string, string>;
  assert.equal(out.payload, undefined);
  assert.equal(out.messageText, "Olá JV,\nO boleto vence amanhã .");
  assert.equal(out.subject, "Boleto");
});

test("links in HTML e-mails keep their address", () => {
  const out = compact({
    messageText: `<html><body><p>Documento pronto.</p><a href="https://netlex.io/sign/abc?x=1" style="color:red"><span>Visualizar para assinar</span></a> <a href="#top">topo</a>${"<span></span>".repeat(50)}</body></html>`,
  }) as Record<string, string>;
  assert.match(out.messageText, /Visualizar para assinar \(https:\/\/netlex\.io\/sign\/abc\?x=1\)/);
  assert.doesNotMatch(out.messageText, /#top/);
});

test("cutting a long text keeps every link from the cut part (not images)", async () => {
  const { cutKeepingLinks } = await import("../apps/server/src/connected-apps/compact.ts");
  const text = `${"a".repeat(3100)} ata: https://docs.google.com/document/d/abc/edit logo https://x.com/logo.png fim`;
  const out = cutKeepingLinks(text);
  assert.ok(out.length < 3300);
  assert.match(out, /Links no resto do texto: https:\/\/docs\.google\.com\/document\/d\/abc\/edit/);
  assert.doesNotMatch(out, /logo\.png/);
  assert.equal(cutKeepingLinks("curto https://a.com"), "curto https://a.com");
});
