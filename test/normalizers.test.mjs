import assert from "node:assert/strict";
import test from "node:test";

import { normalizePercent } from "../src/lib/normalizers.mjs";

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}

test("keeps fractional percentage strings exported by Douyin", () => {
  assert.equal(normalizePercent("0.418760"), 0.41876);
});

test("converts strings with an explicit percent sign", () => {
  assertClose(normalizePercent("41.876%"), 0.41876);
});

test("keeps fractional numeric cells", () => {
  assert.equal(normalizePercent(0.41876), 0.41876);
});

test("normalizes whole-number percent strings and empty markers", () => {
  assertClose(normalizePercent("41.876"), 0.41876);
  assert.equal(normalizePercent("-"), 0);
  assert.equal(normalizePercent(""), 0);
});
