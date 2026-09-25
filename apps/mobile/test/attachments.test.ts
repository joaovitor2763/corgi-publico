import assert from "node:assert/strict";
import { test } from "node:test";
import { aboutTask, splitAttachments } from "../src/features/chat/attachments.ts";

test("the attachment line is hidden and becomes file names", () => {
  const sent =
    "O que tem aqui?\n\nAttached files: placa.png (file ID: c9aa-1), receita, set.csv (file ID: 06a4-2)";
  assert.deepEqual(splitAttachments(sent), {
    text: "O que tem aqui?",
    files: [
      { name: "placa.png", id: "c9aa-1" },
      { name: "receita, set.csv", id: "06a4-2" },
    ],
  });
  assert.deepEqual(splitAttachments("só texto"), { text: "só texto", files: [] });
  const old = "Veja\n\nAttached documents: slip.pdf (artifact ID: abc)";
  assert.equal(splitAttachments(old).files[0].name, "slip.pdf");
});

test("the task line becomes a task reference and never shows in the bubble", () => {
  const sent = aboutTask("Confirmar presença para Jéssica", {
    title: "Convite do aniversário (sábado)",
    id: "t-42",
  });
  assert.equal(
    sent,
    "Confirmar presença para Jéssica\n\nAbout task: Convite do aniversário (sábado) (task ID: t-42)",
  );
  assert.deepEqual(splitAttachments(sent), {
    text: "Confirmar presença para Jéssica",
    files: [],
    task: { title: "Convite do aniversário (sábado)", id: "t-42" },
  });
});

test("files and a task can travel together, in either order", () => {
  const files = "Veja isto\n\nAttached files: a.pdf (file ID: f1)";
  const both = `${files}\n\nAbout task: Reembolso (task ID: t1)`;
  assert.deepEqual(splitAttachments(both), {
    text: "Veja isto",
    files: [{ name: "a.pdf", id: "f1" }],
    task: { title: "Reembolso", id: "t1" },
  });
  const reversed =
    "Veja isto\n\nAbout task: Reembolso (task ID: t1)\n\nAttached files: a.pdf (file ID: f1)";
  assert.deepEqual(splitAttachments(reversed), splitAttachments(both));
});

test("titles are one line and a mention in the middle of the text is kept", () => {
  assert.match(
    aboutTask("ok", { title: "Linha\num  dois", id: "x" }),
    /About task: Linha um dois \(task ID: x\)$/,
  );
  const inline = "O que significa About task: X (task ID: 1) no meio?";
  assert.deepEqual(splitAttachments(inline), { text: inline, files: [] });
});

test("a message with only files shows no text bubble, just the files", () => {
  const split = splitAttachments("Attached files: foto.jpg (file ID: f1)");
  assert.equal(split.text, "");
  assert.deepEqual(split.files, [{ name: "foto.jpg", id: "f1" }]);
  assert.deepEqual(splitAttachments("\n\nAttached files: a.pdf (file ID: f2)").files, [
    { name: "a.pdf", id: "f2" },
  ]);
});
