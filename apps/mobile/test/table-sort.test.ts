import assert from "node:assert/strict";
import { test } from "node:test";
import {
  columnKind,
  layoutTable,
  nextSort,
  numberOf,
  sortRows,
  textWidth,
} from "../src/features/chat/table-sort.ts";

test("cell labels read as numbers: currency, units, percentages, signs, dates", () => {
  assert.equal(numberOf("R$ 420 mil"), 420_000);
  assert.equal(numberOf("R$ 1,2 mi"), 1_200_000);
  assert.equal(numberOf("US$10/membro/mês"), 10);
  assert.equal(numberOf("84%"), 84);
  assert.equal(numberOf("(-16%)"), -16);
  assert.equal(numberOf("-16% vs meta"), -16);
  assert.equal(numberOf("▲ 1.234,5"), 1234.5);
  assert.equal(numberOf("▼ 3"), -3);
  assert.equal(numberOf("1.234"), 1234);
  assert.equal(numberOf("12,500"), 12_500);
  assert.equal(numberOf("1,5"), 1.5);
  assert.equal(numberOf("2.5k"), 2500);
  assert.equal(numberOf("12/09/2025"), 20250912);
  assert.equal(numberOf("2025-09-12"), 20250912);
  assert.equal(numberOf("Sala 8"), undefined, "text with a number inside stays text");
  assert.equal(numberOf("Personalizado"), undefined);
  assert.equal(numberOf(""), undefined);
});

test("a column is numeric when most of its cells are; sorting is value-aware and stable", () => {
  assert.equal(columnKind(["R$ 420 mil", "R$ 310 mil", "Personalizado"]), "number");
  assert.equal(columnKind(["Plus", "Business", "Enterprise"]), "text");
  assert.equal(columnKind(["", "  "]), "text");
  const rows = [
    { cells: ["Varejo", "R$ 420 mil", "84%"] },
    { cells: ["Atacado", "R$ 310 mil", "111%"] },
    { cells: ["Eventos", "R$ 150 mil", "75%"] },
    { cells: ["Outros", "—", "—"] },
  ];
  const names = (sorted: typeof rows) => sorted.map((row) => row.cells[0]);
  assert.deepEqual(names(sortRows(rows, 1, "asc")), ["Eventos", "Atacado", "Varejo", "Outros"]);
  assert.deepEqual(names(sortRows(rows, 1, "desc")), ["Varejo", "Atacado", "Eventos", "Outros"]);
  assert.deepEqual(names(sortRows(rows, 2, "desc")), ["Atacado", "Varejo", "Eventos", "Outros"]);
  assert.deepEqual(names(sortRows(rows, 0, "asc")), ["Atacado", "Eventos", "Outros", "Varejo"]);
  assert.deepEqual(names(rows), ["Varejo", "Atacado", "Eventos", "Outros"], "input untouched");
  assert.deepEqual(nextSort(undefined, 1), { column: 1, direction: "asc" });
  assert.deepEqual(nextSort({ column: 1, direction: "asc" }, 1), { column: 1, direction: "desc" });
  assert.equal(nextSort({ column: 1, direction: "desc" }, 1), undefined);
  assert.deepEqual(nextSort({ column: 1, direction: "desc" }, 2), { column: 2, direction: "asc" });
});

test("columns size from their longest text; narrow tables stretch, wide ones scroll", () => {
  assert.ok(textWidth("R$ 420 mil") > 66 && textWidth("R$ 420 mil") < 78, "close to the real 69px");
  assert.ok(textWidth("Online", true) > textWidth("Online"), "bold is wider");
  const narrow = layoutTable(
    [{ cells: ["Varejo", "R$ 420 mil"] }, { cells: ["Atacado", "R$ 310 mil"] }],
    ["Produto", "Receita"],
    340,
  );
  assert.equal(narrow.fits, true);
  assert.equal(narrow.font, 14);
  assert.equal(narrow.hidden, 0);
  assert.equal(Math.round(narrow.widths.reduce((sum, w) => sum + w, 0)), 340);
  assert.deepEqual(narrow.kinds, ["text", "number"]);
  assert.deepEqual(narrow.align, ["left", "right"]);
  assert.deepEqual(narrow.lines, [1, 1]);
  const revenue = [
    { cells: ["Varejo", "R$ 420 mil", "R$ 500 mil", "84% (-16%)"] },
    { cells: ["Eventos", "R$ 310 mil", "R$ 280 mil", "111% (+11%)"] },
  ];
  const four = layoutTable(revenue, ["Produto", "Receita", "Meta", "Ating."], 324);
  assert.equal(four.fits, true, "four short columns fit a phone instead of scrolling");
  assert.equal(four.font, 13, "at 13px, like a compact spreadsheet");
  assert.deepEqual(four.align, ["left", "right", "right", "right"]);
  assert.equal(Math.round(four.widths.reduce((sum, w) => sum + w, 0)), 324);
  assert.equal(layoutTable(revenue, ["Produto", "Receita", "Meta", "Ating."], 350).font, 14);
  const squeezed = layoutTable(
    [
      { cells: ["Plano Plus", "R$ 49,90", "Para quem começa e quer testar"] },
      { cells: ["Plano Pro", "R$ 129,90", "Times pequenos com integrações"] },
    ],
    ["Plano", "Preço", "Ideal para"],
    340,
  );
  assert.equal(squeezed.fits, true, "a little over: text columns wrap, numbers keep their width");
  assert.equal(squeezed.align[1], "right");
  assert.ok(
    squeezed.lines.some((n) => n > 1),
    "the text column wrapped",
  );
  assert.equal(Math.round(squeezed.widths.reduce((sum, w) => sum + w, 0)), 340);
  const plans = [
    { cells: ["Plus", "US$10/membro/mês", "Profissionais e equipes pequenas", "Sim", "Não"] },
    { cells: ["Enterprise", "US$25/membro/mês", "x".repeat(120), "Sim", "Sim"] },
    { cells: ["Free", "US$0 para sempre, sem cartão e sem limite", "Uso pessoal", "Não", "Não"] },
  ];
  const headers = ["Plano", "Preço", "Ideal para", "SSO", "Auditoria"];
  const wide = layoutTable(plans, headers, 340);
  assert.equal(wide.fits, false, "the full table pins the first column and scrolls");
  assert.equal(wide.hidden, 0);
  assert.ok(wide.widths[0] >= 68 && wide.widths[0] <= 150, "first column stays pinnable");
  assert.equal(wide.widths[2], 200, "long text caps and wraps");
  assert.deepEqual(wide.lines, [2, 3, 2], "rows grow to fit wrapped text, up to three lines");
  assert.equal(wide.kinds[1], "number", "prices sort by value");
  assert.equal(wide.align[1], "left", "but a wrapping price column reads left-aligned");
  const clipped = layoutTable(plans, headers, 340, true);
  assert.equal(clipped.fits, true, "a preview shows only the leading columns that fit");
  assert.equal(clipped.hidden, 3);
  assert.equal(clipped.widths.length, 2);
  assert.ok(clipped.widths.reduce((sum, w) => sum + w, 0) <= 340 - 44, "room for the +N pill");
  assert.deepEqual(clipped.lines, [1, 1, 2], "row heights come from the visible columns only");
});
