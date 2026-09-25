import assert from "node:assert/strict";
import { test } from "node:test";
import { insertSkill, skillQuery } from "../src/features/chat/skill-query.ts";

test("the @ being typed opens the picker; emails and finished words don't", () => {
  assert.equal(skillQuery("@"), "");
  assert.equal(skillQuery("faz o @br"), "br");
  assert.equal(skillQuery("manda pra ana@empresa"), undefined);
  assert.equal(skillQuery("@ads da semana"), undefined);
  assert.equal(insertSkill("faz o @br", "briefing"), "faz o @briefing ");
});
