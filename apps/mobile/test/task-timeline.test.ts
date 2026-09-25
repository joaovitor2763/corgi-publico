import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composerFor,
  eventDetail,
  eventTitle,
  followUpsOf,
  taskTimeline,
  workingOnInstruction,
} from "../src/features/activity/task-timeline.ts";
import { pythonFilesOf, sentFileOf } from "../src/features/chat/sent-file.ts";

const event = (id: string, date: string, title: string, detail = "") => ({
  id,
  date,
  kind: "status",
  title,
  detail,
});

test("instructions sit among events in time order, once each", () => {
  const events = [
    event("e1", "2026-09-24T10:00:00Z", "Started working"),
    event("e2", "2026-09-24T10:05:00Z", "Nova instrução sua", "usa o endereço de casa"),
    event("e3", "2026-09-24T10:06:00Z", "Resumed work"),
  ];
  const followUps = followUpsOf({
    followUps: [
      { text: "usa o endereço de casa", at: "2026-09-24T10:05:00Z", previousResult: "x" },
    ],
  });
  const items = taskTimeline(events, followUps, [
    { text: "usa o endereço de casa", at: "2026-09-24T10:04:59Z" },
    { text: "e confirma com a Jéssica", at: "2026-09-24T10:07:00Z" },
  ]);
  assert.deepEqual(
    items.map((item) =>
      item.type === "event" ? item.event.id : `${item.text}${item.pending ? "…" : ""}`,
    ),
    ["e1", "usa o endereço de casa", "e3", "e confirma com a Jéssica…"],
  );
});

test("an instruction event without saved follow-ups still shows as a bubble", () => {
  const items = taskTimeline([event("e", "2026-01-01T00:00:00Z", "Nova instrução sua", "oi")], []);
  assert.equal(items[0].type, "instruction");
  assert.deepEqual(followUpsOf({ followUps: "nope" }), []);
  assert.deepEqual(followUpsOf(undefined), []);
});

test("working on the instruction until a result or error arrives", () => {
  const sent = [{ text: "faz X", at: "2026-01-01T00:02:00Z" }];
  const before = [event("e1", "2026-01-01T00:01:00Z", "Started working")];
  assert.equal(workingOnInstruction(taskTimeline(before, [], sent), "running"), true);
  assert.equal(workingOnInstruction(taskTimeline(before, [], sent), "succeeded"), false);
  assert.equal(workingOnInstruction(taskTimeline(before, []), "running"), false);
  const done = [...before, { ...event("e2", "2026-01-01T00:03:00Z", "Pronto"), kind: "result" }];
  assert.equal(workingOnInstruction(taskTimeline(done, [], sent), "queued"), false);
});

test("the composer steers agent tasks, answers questions and stays out of monitors", () => {
  assert.equal(composerFor({ kind: "agent", status: "running" }).mode, "steer");
  assert.deepEqual(composerFor({ kind: "monitor", status: "waiting_input" }), {
    mode: "answer",
    placeholder: "Responder…",
  });
  assert.deepEqual(composerFor({ kind: "monitor", status: "scheduled" }), {
    mode: "hint",
    hint: "Acompanhamentos não recebem instruções; peça no chat.",
  });
  assert.equal(composerFor({ kind: "document", status: "succeeded" }).mode, "hint");
});

test("older English event titles read in pt-BR", () => {
  assert.equal(eventTitle("Started working"), "Comecei a trabalhar");
  assert.equal(eventTitle("Task paused"), "Tarefa pausada");
  assert.equal(eventTitle("browse_web failed"), "browse_web falhou");
  assert.equal(eventTitle("Lendo g1.globo.com"), "Lendo g1.globo.com");
  assert.equal(eventDetail("Changed by you"), "Alterado por você");
  assert.equal(
    eventDetail("Review prepared for the connected account"),
    "Revisão preparada para a conta conectada",
  );
});

test("send_file and run_python results parse, malformed ones don't", () => {
  const sent = sentFileOf(
    JSON.stringify({
      sent: true,
      caption: "Aqui está",
      file: {
        id: "f",
        name: "r.pdf",
        mimeType: "application/pdf",
        size: 10,
        pageCount: 2,
        url: "u",
        thumbnailUrl: "t",
      },
    }),
  );
  assert.equal(sent?.caption, "Aqui está");
  assert.equal(sent?.file.thumbnailUrl, "t");
  assert.equal(sent?.file.excerpt, undefined);
  assert.equal(sentFileOf("not json"), undefined);
  assert.equal(sentFileOf({ file: { name: "x" } }), undefined);
  assert.deepEqual(
    pythonFilesOf({
      ok: true,
      files: [{ fileId: "a", name: "g.png", type: "image/png", size: 3 }, {}],
    }),
    [{ id: "a", name: "g.png", mimeType: "image/png", size: 3 }],
  );
  assert.deepEqual(pythonFilesOf("{}"), []);
});
