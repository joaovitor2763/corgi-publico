import assert from "node:assert/strict";
import { test } from "node:test";
import {
  columnWeights,
  excerptTable,
  excerptText,
  numeric,
  previewOf,
  splitCsvLine,
} from "../src/shared/file-preview.ts";

test("PDFs preview their first page, photos themselves, others nothing without an excerpt", () => {
  assert.deepEqual(previewOf({ name: "a.pdf", mimeType: "application/pdf", thumbnailUrl: "t" }), {
    kind: "page",
    uri: "t",
  });
  assert.deepEqual(previewOf({ name: "a.pdf", mimeType: "application/pdf" }), { kind: "none" });
  assert.deepEqual(
    previewOf({ name: "f.jpg", mimeType: "image/jpeg", url: "u", thumbnailUrl: "t" }),
    { kind: "image", uri: "u" },
  );
  assert.deepEqual(previewOf({ name: "x.zip" }), { kind: "none" });
  assert.equal(previewOf({ name: "n.md", excerpt: "# Oi\n\nTexto" }).kind, "text");
});

test("workbook excerpts become a small table with the sheet name", () => {
  const excerpt = '## Vendas\nMês,Receita,Meta\nJan,"R$ 1.200,00",100%\nFev,900,80%\nMar,1';
  assert.deepEqual(excerptTable(excerpt), {
    sheet: "Vendas",
    header: ["Mês", "Receita", "Meta"],
    // The last line was cut by the 600-character excerpt.
    rows: [
      ["Jan", "R$ 1.200,00", "100%"],
      ["Fev", "900", "80%"],
    ],
  });
  assert.equal(previewOf({ name: "v.xlsx", excerpt }).kind, "table");
});

test("CSV with semicolons and tabs; prose is not a table", () => {
  assert.deepEqual(excerptTable("a;b\n1;2\n3;4")?.rows, [
    ["1", "2"],
    ["3", "4"],
  ]);
  assert.deepEqual(excerptTable("a\tb\tc\n1\t2\t3")?.header, ["a", "b", "c"]);
  assert.equal(excerptTable("Olá, tudo bem?\nSim, e você, como vai?"), undefined);
  assert.equal(excerptTable("só uma linha"), undefined);
  assert.equal(previewOf({ name: "p.csv", excerpt: "Olá mundo" }).kind, "text");
});

test("wide tables keep five columns and six rows; quotes are honored", () => {
  const rows = ["a,b,c,d,e,f,g", ...Array.from({ length: 9 }, (_, i) => `${i},1,2,3,4,5,6`)];
  const table = excerptTable(rows.join("\n"));
  assert.equal(table?.header.length, 5);
  assert.equal(table?.rows.length, 6);
  assert.deepEqual(splitCsvLine('"x, y","a ""b""",c', ","), ["x, y", 'a "b"', "c"]);
});

test("wider values get wider columns; numbers read right-aligned", () => {
  const weights = columnWeights({
    header: ["Cliente", "Prob."],
    rows: [["Delta Foods Comércio", "60%"]],
  });
  assert.equal(weights[0], 2.9);
  assert.equal(weights[1], 1);
  assert.ok(numeric("R$ 1.200,00") && numeric("60%") && numeric("-3,5"));
  assert.ok(!numeric("Acme") && !numeric("R$"));
});

test("excerpt text is tidy and cut at a word", () => {
  assert.equal(excerptText("a  b\n\n\n\nc"), "a b\n\nc");
  const cut = excerptText("palavra ".repeat(100), 50);
  assert.ok(cut.endsWith("palavra…"));
  assert.ok(cut.length <= 51);
});
