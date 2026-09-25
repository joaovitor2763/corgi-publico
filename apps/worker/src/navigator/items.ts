import type { Page } from "playwright";

/** A listing on the final page (product, place, article) the app can show as a card. */
export interface PageItem {
  title: string;
  url: string;
  image?: string;
  price?: string;
  /** Crossed-out list price, when the page shows a discount. */
  was?: string;
  detail?: string;
}

// Runs in the page. A card is the smallest block that holds one image, one link and,
// for shopping pages, a price. Everything comes from the DOM, so nothing is invented.
function collect(limit: number): PageItem[] {
  // Stores often split the currency and the amount across elements (and lines).
  const priceRe = /(R\$|US\$|\$|€|£)\s*\d[\d.,]*/;
  const noise =
    /^(dispon[ií]vel em|frete|patrocinado|an[uú]ncio|oferta do dia|mais vendido|\d+% off)/i;
  const items: PageItem[] = [];
  const seen = new Set<string>();
  for (const img of document.querySelectorAll("img")) {
    if (items.length >= limit * 3) break;
    const box = img.getBoundingClientRect();
    if (box.width < 70 || box.height < 70) continue;
    const src = img.currentSrc || img.src;
    if (!/^https:\/\//.test(src)) continue;
    let node: HTMLElement | null = img.parentElement;
    for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
      const text = (node.innerText || "").trim();
      const link = (node.closest("a[href]") ?? node.querySelector("a[href]")) as HTMLAnchorElement;
      if (!link || text.length < 8) continue;
      if (text.length > 700) break; // grew past one card into the whole list
      const href = link.href.split("#")[0] ?? link.href;
      if (!/^https:\/\//.test(href) || seen.has(href)) break;
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const title = [
        (link.getAttribute("title") || "").trim(),
        img.alt.trim(),
        ...lines.filter((line) => !priceRe.test(line) && !/^(R\$|US\$|\$|€|£)$/.test(line)),
      ].find((line) => line.length > 15 && !noise.test(line));
      if (!title) break;
      // Image alt text often reads "banner do filme X" / "poster of X": keep just X.
      const cleanTitle = title.replace(
        /^(banner|poster|p[oô]ster|capa|imagem|foto|image|cover|thumbnail)\s+(d[oa]s?|de|of|for)?\s*(filme|livro|produto|movie|book|product)?\s*/i,
        "",
      );
      // A card can show the list price, the sale price and installments ("12x R$ 199").
      // The sale price is the lowest amount that is not an installment.
      const amounts = [...text.matchAll(new RegExp(priceRe.source, "g"))]
        .filter(
          (m) =>
            // Installments, coupons and shipping are amounts, not the item's price.
            !/(\d\s*x|x\s*de|parcela|economize|cupom|frete|entrega|save|desconto de)\s*$/i.test(
              text.slice(Math.max(0, (m.index ?? 0) - 25), m.index),
            ) &&
            !/^\s*(off|de desconto|sem juros|de frete|de cashback)/i.test(
              text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 16),
            ),
        )
        .map((m) => {
          const label = m[0].replace(/\s+/g, " ");
          let digits = label.replace(/^[^\d]+/, "");
          digits = /,\d{2}$/.test(digits)
            ? digits.replace(/\./g, "").replace(",", ".")
            : digits.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", ".");
          return { label, value: Number.parseFloat(digits) };
        })
        .filter((amount) => Number.isFinite(amount.value))
        // The same amount often appears twice ("R$196" + ",59" split, plus a hidden label).
        .filter(
          (amount, _, all) =>
            !all.some(
              (other) =>
                other !== amount &&
                Math.floor(other.value) === Math.floor(amount.value) &&
                other.label.length > amount.label.length,
            ),
        );
      const sorted = [...amounts].sort((a, b) => a.value - b.value);
      const price = sorted[0]?.label;
      const top = sorted[sorted.length - 1];
      const was = top && sorted[0] && top.value > sorted[0].value * 1.05 ? top.label : undefined;
      seen.add(href);
      items.push({
        title: (cleanTitle || title).slice(0, 140),
        url: href,
        image: src,
        price,
        was,
        detail: lines
          .filter(
            (line) =>
              !line.startsWith(title.slice(0, 24)) &&
              line.length > 3 &&
              !priceRe.test(line) &&
              !/^[\d.,%]+$|^(R\$|US\$|\$|€|£)$/.test(line),
          )
          .slice(0, 2)
          .join(" · ")
          .slice(0, 120),
      });
      break;
    }
  }
  // Shopping pages: keep only priced cards once there are enough of them.
  const priced = items.filter((item) => item.price);
  return (priced.length >= 3 ? priced : items).slice(0, limit);
}

export async function pageItems(page: Page, limit = 12): Promise<PageItem[]> {
  // Dev runs through tsx, whose __name helper is missing inside the page.
  await page.evaluate("globalThis.__name ??= (fn) => fn").catch(() => {});
  return page.evaluate(collect, limit).catch(() => []);
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "com",
  "para",
  "que",
  "dos",
  "das",
  "stop",
  "now",
  "results",
  "visible",
  "https",
  "www",
  "html",
  "search",
  "lista",
]);

function words(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP.has(word));
}

/**
 * Puts listings that match what was asked first, so a sponsored carousel at the top
 * of a store page does not bury the real results. Order is otherwise kept.
 */
export function rankItems(items: PageItem[], task: string, url: string) {
  let decoded = url;
  try {
    const parsed = new URL(url);
    decoded = decodeURIComponent(`${parsed.pathname} ${parsed.search}`);
  } catch {
    /* keep the raw URL */
  }
  const wanted = new Set([...words(task), ...words(decoded)]);
  if (!wanted.size) return items;
  const score = (item: PageItem) => words(item.title).filter((word) => wanted.has(word)).length;
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
}
