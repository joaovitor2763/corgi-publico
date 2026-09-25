import assert from "node:assert/strict";
import { test } from "node:test";

test("the test suite never loads the developer's .env", () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, "node --test sets NODE_TEST_CONTEXT");
  assert.equal(process.env.COMPOSIO_API_KEY, undefined);
  assert.equal(process.env.IMPOSSIBL_API_KEY, undefined);
});
