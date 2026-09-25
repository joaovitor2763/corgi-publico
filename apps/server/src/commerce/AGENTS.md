# commerce/ — purchase guardrails and prices

- `checkout-policy.ts` — `CHECKOUT_MAX_BRL` (default R$ 100) and `CHECKOUT_MERCHANTS` (default iFood,
  Mercado Livre). `checkoutRefusal` must be called wherever a checkout is proposed or approved.
  A missing total is a refusal, never a pass.
- `prices.ts` — price extraction for tracking monitors (not for checkout totals).

Keep these pure (no I/O). Changing a default is a product decision: note it in the commit message.
