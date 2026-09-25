import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ActionService } from "../apps/server/src/approvals/actions.ts";
import { checkoutPolicy, checkoutRefusal } from "../apps/server/src/commerce/checkout-policy.ts";
import { createStore, type Store } from "../apps/server/src/platform/db.ts";
import { amount, isPurchaseLabel } from "../apps/worker/src/navigator/checkout.ts";
import { PURCHASE_BUTTON } from "../apps/worker/src/navigator/jev.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close();
});

const policy = checkoutPolicy({});

test("checkout rules: R$ 100 per order, allowed stores only, visible total required", () => {
  assert.equal(policy.maxBrl, 100);
  assert.equal(
    checkoutRefusal({ merchant: "ifood.com.br", total: "R$ 58,90", totalValue: 58.9 }, policy),
    undefined,
  );
  assert.equal(
    checkoutRefusal(
      { merchant: "lista.mercadolivre.com.br", total: "R$ 99,90", totalValue: 99.9 },
      policy,
    ),
    undefined,
  );
  assert.match(
    String(
      checkoutRefusal({ merchant: "ifood.com.br", total: "R$ 120,00", totalValue: 120 }, policy),
    ),
    /passa do limite de R\$ 100/,
  );
  assert.match(
    String(checkoutRefusal({ merchant: "amazon.com.br", total: "R$ 10", totalValue: 10 }, policy)),
    /só são permitidas/,
  );
  assert.match(String(checkoutRefusal({ merchant: "ifood.com.br" }, policy)), /não aparece/);
  assert.match(
    String(checkoutRefusal({ merchant: "fakeifood.com.br", totalValue: 5 }, policy)),
    /só são permitidas/,
  );
});

test("order totals parse in real and dollar formats", () => {
  assert.equal(amount("R$ 1.234,56"), 1234.56);
  assert.equal(amount("R$ 58,90"), 58.9);
  assert.equal(amount("$1,299.50"), 1299.5);
});

test("the browser agent never clicks a purchase button on its own", () => {
  for (const label of [
    'button "Finalizar pedido"',
    'button "Fazer pedido"',
    'button "Comprar agora"',
    'button "Place your order"',
  ])
    assert.ok(PURCHASE_BUTTON.test(label), label);
  for (const label of ['button "Adicionar ao carrinho"', 'a "Ver pedidos"', 'button "Continuar"'])
    assert.ok(!PURCHASE_BUTTON.test(label), label);
});

test("an approved checkout runs once without the Google connection", async () => {
  const runs: unknown[] = [];
  const service = new ActionService(db, {
    execute: async (_owner, input) => {
      runs.push(input);
      return "Pedido #123";
    },
    connected: async () => false,
    connection: async () => null,
  });
  const proposal = await service.propose("buyer", {
    kind: "browser.checkout",
    data: {
      sessionId: "s1",
      merchant: "ifood.com.br",
      url: "https://www.ifood.com.br/pedido/revisao",
      total: "R$ 58,90",
      totalValue: 58.9,
      button: "Fazer pedido",
      summary: "Poke de salmão",
    },
  });
  assert.equal(proposal.title, "Pedido em ifood.com.br · R$ 58,90");
  assert.equal(runs.length, 0);
  const denied = await service.propose("buyer2", {
    kind: "browser.checkout",
    data: {
      sessionId: "s1",
      merchant: "ifood.com.br",
      url: "https://www.ifood.com.br/pedido/revisao",
      total: "R$ 20,00",
      totalValue: 20,
      button: "Fazer pedido",
      summary: "Outro",
    },
  });
  await service.decide("buyer2", denied.id, denied.hash, "deny");
  assert.equal(runs.length, 0);
  const done = await service.decide("buyer", proposal.id, proposal.hash, "approve");
  assert.equal(done.status, "succeeded");
  assert.equal(runs.length, 1);
});

test("the action service refuses checkouts outside the spending rules", async () => {
  const service = new ActionService(db, {
    execute: async () => "never",
    connected: async () => false,
  });
  const order = (merchant: string, totalValue?: number) => ({
    kind: "browser.checkout",
    data: {
      sessionId: "s1",
      merchant,
      url: `https://${merchant}/checkout`,
      total: totalValue === undefined ? undefined : `R$ ${totalValue}`,
      totalValue,
      button: "Fazer pedido",
      summary: "Teste",
    },
  });
  await assert.rejects(service.propose("guard", order("amazon.com.br", 10)), /só são permitidas/);
  await assert.rejects(
    service.propose("guard", order("ifood.com.br", 150)),
    /passa do limite de R\$ 100/,
  );
  await assert.rejects(service.propose("guard", order("ifood.com.br")), /não aparece/);
});

test("the checkout review accepts decorated purchase buttons, not longer labels", () => {
  for (const label of [
    "Finalizar pedido",
    "Finalizar pedido →",
    "  Fazer pedido  ",
    "🛒 Comprar agora",
    "Finalizar pedido • R$ 58,90",
    "Place your order - $12.99",
  ])
    assert.ok(isPurchaseLabel(label), label);
  for (const label of [
    "Finalizar pedido e continuar comprando",
    "Adicionar ao carrinho",
    "Ver pedidos",
    "Pagar depois com boleto parcelado",
  ])
    assert.ok(!isPurchaseLabel(label), label);
});
