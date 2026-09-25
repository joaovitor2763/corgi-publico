import assert from "node:assert/strict";
import test from "node:test";
import { mainPrice, pagePrices } from "../apps/server/src/commerce/prices.ts";

test("Brazilian and US prices parse, installments and coupons do not count", () => {
  const text =
    "High Output Management R$ 77,82 R$ 59,93 em até 5x de R$ 11,99 sem juros Economize R$ 10,00 R$ 20,00 off";
  assert.deepEqual(
    pagePrices(text).map((p) => p.value),
    [77.82, 59.93],
  );
  assert.equal(mainPrice(text), 59.93);
  assert.equal(mainPrice("Book $1,299.50 list price"), 1299.5);
  assert.equal(mainPrice("Relógio R$ 2.389"), 2389);
});

test("a price alert ignores related products further down the page", () => {
  const text = "Livro R$ 89,90 R$ 79,90 R$ 84,00 Quem comprou também comprou: Caneta R$ 5,00";
  assert.equal(mainPrice(text), 79.9);
});
