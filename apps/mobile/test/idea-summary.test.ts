import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archiveLabel,
  humanizeExcerpt,
  placeLabel,
  relativeDay,
  snoozeOptions,
  snoozeUntil,
  sourceChips,
  whyLine,
} from "../src/features/ideas/idea-summary.ts";

// A Wednesday, 10:30 local time.
const wednesday = new Date(2026, 8, 23, 10, 30);

test("the why line is the first sentence, on one line, without its final period", () => {
  assert.equal(
    whyLine("Ela pediu resposta até sexta. O contrato depende disso e ninguém respondeu."),
    "Ela pediu resposta até sexta",
  );
  assert.equal(whyLine("  sem   ponto final  "), "sem ponto final");
  const long = whyLine(`${"palavra ".repeat(30)}fim.`, 40);
  assert.ok(long.length <= 40 && long.endsWith("…"), long);
  assert.equal(whyLine(""), "");
});

test("source chips say app, place, who and when, once per person", () => {
  const now = new Date(2026, 8, 23, 12).getTime();
  const chips = sourceChips(
    {
      kind: "agent",
      evidence: [
        {
          id: "slack:s1",
          kind: "user",
          title: "Pode revisar o forecast?",
          excerpt: "slack Acme · #vendas · de ana · 2026-09-22T14:00:00.000Z · menciona você",
        },
        {
          id: "slack:s2",
          kind: "user",
          title: "Outra da Ana no mesmo canal",
          excerpt: "slack Acme · #vendas · de ana · 2026-09-23T09:00:00.000Z",
        },
        {
          id: "mail:m1",
          kind: "mail",
          title: "Proposta revisada",
          excerpt: "caixa x · de Ana Lima <ana@acme.com> · 2026-09-20T10:00:00Z · não lido · Segue",
        },
        { id: "legacy-mail-id", kind: "mail", title: "Formulário", excerpt: "Corpo do e-mail." },
      ],
    },
    now,
  );
  assert.deepEqual(
    chips.map((chip) => [chip.app, chip.label]),
    [
      ["slack", "Slack · #vendas · ana · hoje"],
      ["mail", "E-mail · Ana Lima · há 3 d"],
      ["mail", "E-mail"],
    ],
  );
  assert.deepEqual(sourceChips({ kind: "plan", evidence: [] }), [{ app: "goal", label: "Meta" }]);
});

test("a source's detail shows readable times instead of ISO instants", () => {
  const iso = new Date(2026, 8, 22, 11, 0).toISOString();
  const text = humanizeExcerpt(`caixa trabalho · de Ana · ${iso} · não lido · pedido 2026-09-30`);
  assert.doesNotMatch(text, /T\d{2}:\d{2}/);
  assert.match(text, /de Ana · 22 de set\.?,? 11:00 · não lido · pedido 2026-09-30/);
  assert.equal(humanizeExcerpt("sem data"), "sem data");
});

test("relative days read naturally in Portuguese", () => {
  const now = new Date(2026, 8, 23, 12).getTime();
  assert.equal(relativeDay(new Date(2026, 8, 23, 8).toISOString(), now), "hoje");
  assert.equal(relativeDay(new Date(2026, 8, 22, 23).toISOString(), now), "ontem");
  assert.equal(relativeDay(new Date(2026, 8, 24, 9).toISOString(), now), "amanhã");
  assert.equal(relativeDay(new Date(2026, 8, 19, 12).toISOString(), now), "há 4 d");
  assert.match(relativeDay(new Date(2026, 7, 1, 12).toISOString(), now), /1.*ago/);
  assert.equal(relativeDay("nope", now), "");
});

test("snooze choices land on tonight 19:00, tomorrow 08:00 and next Monday 08:00", () => {
  assert.deepEqual(snoozeUntil("tonight", wednesday), new Date(2026, 8, 23, 19, 0));
  assert.deepEqual(snoozeUntil("tomorrow", wednesday), new Date(2026, 8, 24, 8, 0));
  assert.deepEqual(snoozeUntil("next-week", wednesday), new Date(2026, 8, 28, 8, 0));
  // From a Monday, "next week" is the following Monday, never today.
  assert.deepEqual(snoozeUntil("next-week", new Date(2026, 8, 21, 9)), new Date(2026, 8, 28, 8));
  // From a Sunday, it is tomorrow.
  assert.deepEqual(snoozeUntil("next-week", new Date(2026, 8, 27, 9)), new Date(2026, 8, 28, 8));
});

test("tonight is only offered while 19:00 is still ahead", () => {
  assert.deepEqual(
    snoozeOptions(wednesday).map((o) => [o.label, o.detail]),
    [
      ["Hoje à noite", "hoje, 19:00"],
      ["Amanhã de manhã", "amanhã, 08:00"],
      ["Próxima semana", "seg, 08:00"],
    ],
  );
  assert.deepEqual(
    snoozeOptions(new Date(2026, 8, 23, 21)).map((o) => o.label),
    ["Amanhã de manhã", "Próxima semana"],
  );
});

test("an archived idea says why it is there and when it was suggested", () => {
  const now = new Date(2026, 8, 23, 12).getTime();
  assert.equal(
    archiveLabel({ status: "dismissed", createdAt: new Date(2026, 8, 22, 9).toISOString() }, now),
    "Ignorada · sugerida ontem",
  );
  assert.match(
    archiveLabel({ status: "expired", createdAt: new Date(2026, 8, 10, 9).toISOString() }, now),
    /^Expirou · sugerida em 10/,
  );
});

test("a Slack group DM reads as a group, and one conversation is one chip", () => {
  assert.match(placeLabel("#mpdm-bruno--voce--carla--diego-1"), /^Grupo \([^,]+, [^,]+ \+2\)$/);
  assert.equal(placeLabel("#geral"), "#geral");
  const evidence = (who: string) => ({
    id: `slack:${who}`,
    kind: "user",
    title: "Contrato Acme",
    excerpt: `slack voce (Acme) · #mpdm-bruno--voce--carla--diego-1 · de ${who} · 2026-09-25 10:00`,
  });
  const chips = sourceChips(
    {
      kind: "task",
      evidence: [evidence("bruno"), evidence("carla"), evidence("diego")],
    } as never,
    Date.parse("2026-09-25T15:00:00Z"),
  );
  assert.equal(chips.length, 1);
  assert.match(chips[0]?.label ?? "", /^Slack · Grupo \(/);
  assert.doesNotMatch(chips[0]?.label ?? "", /mpdm/);
});
