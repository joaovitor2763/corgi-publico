import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fileKind,
  filterFiles,
  formatSize,
  middleEllipsis,
  typeLabel,
} from "../src/shared/file-kind.ts";

test("a file's kind comes from its MIME type, else its extension", () => {
  assert.equal(fileKind("IMG_0254.jpeg", "image/jpeg"), "image");
  assert.equal(fileKind("scan", "image/webp"), "image");
  assert.equal(fileKind("contrato.pdf", "application/pdf"), "pdf");
  assert.equal(fileKind("vendas.xlsx"), "sheet");
  assert.equal(fileKind("base.CSV", "text/csv"), "sheet");
  assert.equal(fileKind("proposta.docx"), "doc");
  assert.equal(fileKind("notas.md", "text/markdown"), "text");
  assert.equal(fileKind("config.json"), "data");
  assert.equal(fileKind("sem-extensao"), "other");
});

test("type labels use the extension people know", () => {
  assert.equal(typeLabel("foto.jpeg"), "JPG");
  assert.equal(typeLabel("vendas.xlsx"), "XLSX");
  assert.equal(typeLabel("contrato", "application/pdf"), "PDF");
  assert.equal(typeLabel("misterio"), "Arquivo");
});

test("sizes read in pt-BR units", () => {
  assert.equal(formatSize(820), "820 B");
  assert.equal(formatSize(240 * 1024), "240 KB");
  assert.equal(formatSize(1.44 * 1024 * 1024), "1,4 MB");
  assert.equal(formatSize(23 * 1024 * 1024), "23 MB");
  assert.equal(formatSize(undefined), "");
});

test("long names shrink in the middle and keep the extension", () => {
  assert.equal(middleEllipsis("curto.pdf"), "curto.pdf");
  const short = middleEllipsis("Relatorio_financeiro_consolidado_setembro_2026.pdf", 28);
  assert.ok(Array.from(short).length <= 28);
  assert.ok(short.startsWith("Relatorio_financ"));
  assert.ok(short.endsWith("2026.pdf"));
  assert.ok(short.includes("…"));
});

test("the library filters by kind and query, newest first", () => {
  const files = [
    { name: "Praia.jpg", mimeType: "image/jpeg", createdAt: "2026-09-01T10:00:00Z" },
    { name: "Orçamento 2026.xlsx", mimeType: "", createdAt: "2026-09-03T10:00:00Z" },
    { name: "Contrato.pdf", mimeType: "application/pdf", createdAt: "2026-09-02T10:00:00Z" },
    { name: "notas.md", mimeType: "text/markdown", createdAt: "2026-09-04T10:00:00Z" },
  ];
  const names = (list: { name: string }[]) => list.map((f) => f.name);
  assert.deepEqual(names(filterFiles(files, "", "all")), [
    "notas.md",
    "Orçamento 2026.xlsx",
    "Contrato.pdf",
    "Praia.jpg",
  ]);
  assert.deepEqual(names(filterFiles(files, "", "photos")), ["Praia.jpg"]);
  assert.deepEqual(names(filterFiles(files, "", "docs")), ["notas.md"]);
  assert.deepEqual(names(filterFiles(files, "orcamento", "all")), ["Orçamento 2026.xlsx"]);
  assert.deepEqual(names(filterFiles(files, "contrato  PDF", "pdfs")), ["Contrato.pdf"]);
  assert.deepEqual(names(filterFiles(files, "nada", "all")), []);
});
