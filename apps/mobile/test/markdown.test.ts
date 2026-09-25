import assert from "node:assert/strict";
import test from "node:test";
import { parseInlineMarkdown, parseMarkdown, plainText } from "../src/shared/markdown-parser";

test("chat markdown recognizes headings, lists and paragraphs", () => {
  assert.deepEqual(parseMarkdown("# Status\n\n- Tasks\n2. Goals\nDone"), [
    { type: "heading", text: "Status" },
    { type: "space" },
    { type: "bullet", text: "Tasks" },
    { type: "ordered", marker: "2.", text: "Goals" },
    { type: "paragraph", text: "Done" },
  ]);
});

test("chat markdown removes inline markers while retaining styles", () => {
  assert.deepEqual(parseInlineMarkdown("A **bold** and *italic* with `code`."), [
    { text: "A " },
    { text: "bold", style: "bold" },
    { text: " and " },
    { text: "italic", style: "italic" },
    { text: " with " },
    { text: "code", style: "code" },
    { text: "." },
  ]);
});

test("chat markdown shows unfinished streamed bold without literal markers", () => {
  assert.deepEqual(parseInlineMarkdown("Tarefas **ativ"), [
    { text: "Tarefas " },
    { text: "ativ", style: "bold" },
  ]);
  assert.deepEqual(parseInlineMarkdown("ends with **"), [{ text: "ends with **" }]);
});

test("raw URLs and markdown links render as short labeled links", () => {
  assert.deepEqual(parseInlineMarkdown("Veja https://www.ingresso.com/filme/verity."), [
    { text: "Veja " },
    { text: "ingresso.com", style: "link", url: "https://www.ingresso.com/filme/verity" },
    { text: "." },
  ]);
  assert.deepEqual(parseInlineMarkdown("[Verity](https://www.ingresso.com/filme/verity)"), [
    { text: "Verity", style: "link", url: "https://www.ingresso.com/filme/verity" },
  ]);
});

test("code inside bold renders bold without backticks", () => {
  assert.deepEqual(parseInlineMarkdown("- **Lovable — `Leo virou admin`** — checar"), [
    { text: "- " },
    { text: "Lovable — Leo virou admin", style: "bold" },
    { text: " — checar" },
  ]);
});

test("previews drop markdown symbols", () => {
  assert.equal(
    plainText("**Briefing 23/09**\n- **Lovable — `admin`** — checar\n## Fim"),
    "Briefing 23/09 Lovable — admin — checar Fim",
  );
});
