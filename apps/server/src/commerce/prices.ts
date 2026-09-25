/** Amounts in page text, in reading order, without installments, coupons or shipping. */
export function pagePrices(text: string) {
  const prices: { label: string; value: number }[] = [];
  for (const m of text.matchAll(/(R\$|US\$|USD|\$|€|£)\s*(\d[\d.,]*)/g)) {
    const index = m.index ?? 0;
    const before = text.slice(Math.max(0, index - 25), index);
    const after = text.slice(index + m[0].length, index + m[0].length + 16);
    if (/(\d\s*x|x\s*de|parcela|economize|cupom|frete|entrega|save|desconto de)\s*$/i.test(before))
      continue;
    if (/^\s*(off|de desconto|sem juros|de frete|de cashback)/i.test(after)) continue;
    const raw = (m[2] ?? "").replace(/[.,]$/, "");
    const normalized =
      m[1] === "R$" || /,\d{2}$/.test(raw)
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "");
    const value = Number.parseFloat(normalized);
    if (Number.isFinite(value) && value > 0) prices.push({ label: m[0], value });
  }
  return prices;
}

/**
 * The watched item's price: the lowest of the first few amounts, which on a product
 * page are its current and list price, not related products further down.
 */
export function mainPrice(text: string) {
  const first = pagePrices(text).slice(0, 3);
  return first.length ? Math.min(...first.map((price) => price.value)) : undefined;
}
