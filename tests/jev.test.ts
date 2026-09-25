import assert from "node:assert/strict";
import test from "node:test";
import { buildActionSpace, stepQuestions } from "../apps/worker/src/navigator/jev.ts";

const raw = (text: string, extra: Record<string, unknown> = {}) => ({
  attr: `j-${text}`,
  tag: "input",
  text,
  href: "",
  typeAttr: "text",
  clickable: false,
  typeable: true,
  selectable: false,
  ...extra,
});

test("Jev is never offered password or file fields", () => {
  const elements = buildActionSpace([
    raw("Email"),
    raw("Password", { typeAttr: "password" }),
    raw("Upload", { typeAttr: "file" }),
  ]);
  assert.deepEqual(
    elements.map((e) => e.description),
    ['input "Email" (type into this field)'],
  );
});

test("Jev action space drops duplicate links and page chrome", () => {
  const link = (text: string, href: string) =>
    raw(text, { tag: "a", href, typeable: false, clickable: true });
  const elements = buildActionSpace([
    link("Capybara", "/wiki/Capybara"),
    link("Capybara again", "/wiki/Capybara#Diet"),
    link("Skip to content", "/x"),
    link("Top", "#top"),
    link("Edit", "/edit"),
  ]);
  assert.equal(elements.length, 1);
  assert.equal(elements[0]?.kind, "click");
});

test("Jev cannot go back before navigating or scroll forever", () => {
  const { action } = stepQuestions([], { canGoBack: false, canScroll: false });
  assert.deepEqual(Object.keys(action?.type === "choice" ? action.criteria : {}), ["done"]);
});

test("every Jev step can stop, scroll or go back", () => {
  const { action } = stepQuestions([]);
  assert.equal(action?.type, "choice");
  assert.deepEqual(Object.keys(action?.type === "choice" ? action.criteria : {}), [
    "scroll_down",
    "scroll_up",
    "back",
    "done",
  ]);
});

test("page items matching the request come before sponsored ones", async () => {
  const { rankItems } = await import("../apps/worker/src/navigator/items.ts");
  const item = (title: string) => ({ title, url: `https://x.com/${title.length}` });
  const ranked = rankItems(
    [item("Relógio Chilli Beans Dourado"), item("Relógio Omega Seamaster Automático")],
    "Find Omega watches",
    "https://lista.mercadolivre.com.br/relogio-omega",
  );
  assert.equal(ranked[0]?.title, "Relógio Omega Seamaster Automático");
});
