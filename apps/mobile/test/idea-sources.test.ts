import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addChannel,
  type SourceAppInfo,
  setAccount,
  setApp,
  toSources,
  toState,
  update,
  watching,
} from "../src/features/ideas/idea-sources.ts";

const apps: SourceAppInfo[] = [
  {
    app: "googlecalendar",
    name: "Google Agenda",
    detail: "",
    connected: true,
    accounts: [{ id: "cal-1", label: "trabalho@exemplo.com" }],
  },
  {
    app: "gmail",
    name: "Gmail",
    detail: "",
    connected: true,
    accounts: [
      { id: "mail-1", label: "trabalho@exemplo.com" },
      { id: "mail-2", label: "pessoal@exemplo.com" },
      { id: "mail-3", label: "vendas@exemplo.com" },
    ],
  },
  {
    app: "slack",
    name: "Slack",
    detail: "",
    connected: true,
    accounts: [{ id: "slack-1", label: "Empresa" }],
  },
  { app: "instagram", name: "Instagram", detail: "", connected: false, accounts: [] },
];

test("the defaults round-trip: every account of calendar and Gmail, one source each", () => {
  const sources = [
    { app: "googlecalendar" as const, enabled: true },
    { app: "gmail" as const, enabled: true },
  ];
  const state = toState(apps, sources);
  assert.deepEqual(watching(state), ["Agenda", "Gmail"]);
  assert.deepEqual(state[1].chosen, ["mail-1", "mail-2", "mail-3"]);
  assert.equal(state[2].on, false);
  assert.equal(state[2].mentions, true);
  assert.equal(state[2].dms, true);
  assert.deepEqual(toSources(state), sources);
});

test("a subset of accounts becomes one source per account, with the Gmail search on each", () => {
  let state = toState(apps, [{ app: "gmail", enabled: true }]);
  state = setAccount(state, "gmail", "mail-2", false);
  state = update(state, "gmail", { query: "  is:important  " });
  assert.deepEqual(toSources(state), [
    { app: "gmail", account: "mail-1", enabled: true, query: "is:important" },
    { app: "gmail", account: "mail-3", enabled: true, query: "is:important" },
  ]);
  const again = toState(apps, toSources(state));
  assert.deepEqual(again[1].chosen, ["mail-1", "mail-3"]);
  assert.equal(again[1].query, "is:important");
  // Turning every account back on collapses to one source without `account`.
  state = setAccount(state, "gmail", "mail-2", true);
  assert.deepEqual(toSources(state), [{ app: "gmail", enabled: true, query: "is:important" }]);
});

test("the last account off turns the app off; the app switch brings the accounts back", () => {
  let state = toState(apps, [{ app: "gmail", account: "mail-2", enabled: true }]);
  state = setAccount(state, "gmail", "mail-2", false);
  assert.equal(state[1].on, false);
  assert.deepEqual(toSources(state), []);
  state = setApp(state, "gmail", true);
  assert.deepEqual(state[1].chosen, ["mail-1", "mail-2", "mail-3"]);
  assert.deepEqual(toSources(state), [{ app: "gmail", enabled: true }]);
});

test("Slack keeps its switches and channels; an app turned off keeps what was typed", () => {
  let state = setApp(toState(apps, []), "slack", true);
  state = update(state, "slack", {
    dms: false,
    channels: addChannel(addChannel([], " #Vendas "), "vendas"),
  });
  assert.deepEqual(toSources(state), [
    { app: "slack", enabled: true, mentions: true, dms: false, channels: ["vendas"] },
  ]);
  state = setApp(state, "slack", false);
  const saved = toSources(state);
  assert.deepEqual(saved, [
    { app: "slack", enabled: false, mentions: true, dms: false, channels: ["vendas"] },
  ]);
  const back = toState(apps, saved);
  assert.equal(back[2].on, false);
  assert.deepEqual(back[2].channels, ["vendas"]);
  assert.equal(back[2].dms, false);
});

test("sources of an app that isn't connected now are kept untouched", () => {
  const sources = [{ app: "instagram" as const, account: "ig-1", enabled: true }];
  const state = toState(apps, sources);
  assert.equal(state[3].on, false);
  assert.deepEqual(watching(state), []);
  assert.deepEqual(toSources(state), sources);
});

test("channel names lose the # and the case; blanks and repeats are ignored", () => {
  assert.deepEqual(addChannel(["geral"], "##Diretoria"), ["geral", "diretoria"]);
  assert.deepEqual(addChannel(["geral"], "  #  "), ["geral"]);
  assert.deepEqual(addChannel(["geral"], "GERAL"), ["geral"]);
});
