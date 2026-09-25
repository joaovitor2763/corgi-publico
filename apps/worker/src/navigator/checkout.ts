// Checkout with approval: the agent brings a store to its final review page, the worker
// records exactly what is on screen (URL, total, the "place order" button, a screenshot),
// and the button is clicked only after the person approves and only if none of that changed.
import type { Page } from "playwright";
import { validatePublicUrl } from "../browser/network.ts";
import { WorkerError } from "../errors.ts";

export interface CheckoutReview {
  url: string;
  merchant: string;
  title: string;
  total?: string;
  totalValue?: number;
  button: string;
  excerpt: string;
  screenshot: string;
}

export const PLACE_ORDER =
  /^(finalizar( (compra|pedido))?|fazer pedido|confirmar (compra|pedido)|comprar agora|pagar( agora)?|place (your )?order|buy now|pay now)$/i;
/**
 * Decoration stores put around the button text: icons and arrows, and a trailing price
 * ("Finalizar pedido • R$ 58,90"). Stripped before the exact match, so the review accepts
 * the same buttons Jev stops at (jev.ts PURCHASE_BUTTON), without matching longer labels.
 */
export const DECORATION = /^[^\p{L}]+|[\s•·|–—-]*(R\$|US\$|\$)\s?[\d.,]+\s*$|[^\p{L}]+$/gu;
export function purchaseLabel(raw: string) {
  const once = raw.replace(/\s+/g, " ").replace(DECORATION, "");
  return once.replace(DECORATION, "").trim();
}
/** Whether a button label is a final purchase button, after stripping decoration. */
export const isPurchaseLabel = (raw: string) => PLACE_ORDER.test(purchaseLabel(raw));

// Runs in the page. Finds the one place-order button and the order total, if shown.
export function inspectCheckout([source, decoration]: [string, string]) {
  const placeOrder = new RegExp(source, "i");
  // Same as purchaseLabel(): this function is serialized into the page, so it cannot import it.
  const strip = (raw: string) => {
    const pattern = new RegExp(decoration, "gu");
    return raw.replace(/\s+/g, " ").replace(pattern, "").replace(pattern, "").trim();
  };
  const buttons = [
    ...document.querySelectorAll<HTMLElement>(
      'button, input[type="submit"], a[role="button"], [role="button"]',
    ),
  ].filter((el) => {
    const style = getComputedStyle(el);
    return (
      !!el.getClientRects().length &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      placeOrder.test(strip(el.innerText || (el as HTMLInputElement).value || ""))
    );
  });
  for (const el of document.querySelectorAll("[data-om-checkout]"))
    el.removeAttribute("data-om-checkout");
  const button = buttons[0];
  if (button) button.setAttribute("data-om-checkout", "1");
  const text = document.body?.innerText ?? "";
  // The total is the amount on the line that says "Total" (not subtotal or frete).
  const lines = text.split("\n").map((line) => line.trim());
  let total: string | undefined;
  for (let i = 0; i < lines.length && !total; i++) {
    const line = lines[i] ?? "";
    if (!/^total\b/i.test(line) || /sub/i.test(line)) continue;
    const here = line.match(/(R\$|US\$|\$)\s*\d[\d.,]*/);
    const next = (lines[i + 1] ?? "").match(/(R\$|US\$|\$)\s*\d[\d.,]*/);
    total = (here ?? next)?.[0].replace(/\s+/g, " ");
  }
  return {
    buttons: buttons.length,
    button: button ? (button.innerText || (button as HTMLInputElement).value || "").trim() : "",
    total,
    excerpt: text.replace(/\s+/g, " ").slice(0, 1500),
  };
}

export function amount(label?: string) {
  if (!label) return undefined;
  const raw = label.replace(/^[^\d]+/, "").replace(/[.,]$/, "");
  const normalized = /,\d{2}$/.test(raw)
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(/,/g, "");
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : undefined;
}

export async function reviewCheckout(page: Page): Promise<CheckoutReview> {
  const url = page.url();
  await validatePublicUrl(url);
  if (new URL(url).protocol !== "https:")
    throw new WorkerError("CHECKOUT_UNAVAILABLE", "O checkout precisa de uma página HTTPS.", 409);
  // Dev runs through tsx, whose __name helper is missing inside the page.
  await page.evaluate("globalThis.__name ??= (fn) => fn").catch(() => {});
  const found = await page.evaluate(inspectCheckout, [PLACE_ORDER.source, DECORATION.source] as [
    string,
    string,
  ]);
  if (found.buttons !== 1)
    throw new WorkerError(
      "CHECKOUT_UNAVAILABLE",
      found.buttons
        ? "Há mais de um botão de finalizar pedido na tela. Assuma o controle para concluir."
        : "Essa ainda não é a página final de revisão: nenhum botão de finalizar pedido está visível.",
      409,
    );
  const shot = await page.screenshot({ type: "jpeg", quality: 60, timeout: 10_000 });
  return {
    url,
    merchant: new URL(url).hostname.replace(/^www\./, ""),
    title: (await page.title()).slice(0, 200),
    total: found.total,
    totalValue: amount(found.total),
    button: found.button.slice(0, 60),
    excerpt: found.excerpt,
    screenshot: `data:image/jpeg;base64,${shot.toString("base64")}`,
  };
}

/** Places the order only if the page still matches what the person approved. */
export async function confirmCheckout(
  page: Page,
  approved: { url: string; total?: string; button: string },
) {
  const current = await reviewCheckout(page);
  if (
    current.url !== approved.url ||
    current.total !== approved.total ||
    current.button !== approved.button
  )
    throw new WorkerError(
      "CHECKOUT_CHANGED",
      "A página do pedido mudou desde a sua aprovação. Nada foi comprado; revise de novo.",
      409,
    );
  await page.click('[data-om-checkout="1"]', { timeout: 5000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
  const shot = await page.screenshot({ type: "jpeg", quality: 60, timeout: 10_000 });
  return {
    url: page.url(),
    title: (await page.title()).slice(0, 200),
    // The receipt is whatever the store shows next; the agent reports it, never assumes success.
    excerpt: text.replace(/\s+/g, " ").slice(0, 1500),
    screenshot: `data:image/jpeg;base64,${shot.toString("base64")}`,
  };
}
