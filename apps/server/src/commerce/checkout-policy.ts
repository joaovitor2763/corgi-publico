/**
 * Spending guardrails for agent checkouts. Defaults: R$ 100 per order, iFood and
 * Mercado Livre only. Override with CHECKOUT_MAX_BRL and CHECKOUT_MERCHANTS.
 */
export function checkoutPolicy(env = process.env) {
  const max = Number(env.CHECKOUT_MAX_BRL ?? 100);
  return {
    maxBrl: Number.isFinite(max) && max > 0 ? max : 100,
    merchants: (env.CHECKOUT_MERCHANTS ?? "ifood.com.br,mercadolivre.com.br,mercadolivre.com")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** Why an order may not be proposed, or undefined when it is within the rules. */
export function checkoutRefusal(
  review: { merchant: string; total?: string; totalValue?: number },
  policy = checkoutPolicy(),
) {
  const host = review.merchant.toLowerCase();
  if (!policy.merchants.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)))
    return `Compras só são permitidas em ${policy.merchants.join(", ")}.`;
  if (review.totalValue === undefined)
    return "O total do pedido não aparece nesta página, então não dá para checar o limite.";
  if (review.totalValue > policy.maxBrl)
    return `O total ${review.total} passa do limite de R$ ${policy.maxBrl} por pedido.`;
  return undefined;
}
