import assert from "node:assert/strict";
import { test } from "node:test";
import { decode, encode } from "./wire.ts";

test("bigints and Maps survive the trip, nested", () => {
  const value = { a: 1n, list: [2n, { b: -3n }], m: new Map([["x", 4n]]), s: "5", n: 6 };
  const back = decode<typeof value>(encode(value));
  assert.deepEqual(back, value);
  assert.equal(typeof back.a, "bigint");
  assert.ok(back.m instanceof Map);
});
