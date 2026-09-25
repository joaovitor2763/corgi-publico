import assert from "node:assert/strict";
import { test } from "node:test";
import { calculate } from "../apps/server/src/agent/calculate.ts";

test("exact arithmetic for figures the agent shows", () => {
  assert.equal(calculate("420000+310000+150000"), 880000);
  assert.equal(calculate("(880/980-1)*100"), -10.2040816327);
  assert.equal(calculate("2 * (3 + 4) - -1"), 15);
  assert.equal(calculate("1,5*2"), 3, "comma decimals");
  assert.throws(() => calculate("process.exit()"), /only numbers/);
  assert.throws(() => calculate("1/0"), /zero/);
  assert.throws(() => calculate("(1+2"), /Missing/);
});
