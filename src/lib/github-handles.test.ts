import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidLogin, normalizeLogin } from "./github-handles";

test("normalizeLogin accepts the forms people paste", () => {
  assert.equal(normalizeLogin("@Torvalds"), "torvalds");
  assert.equal(normalizeLogin("https://github.com/gaearon/react"), "gaearon");
  assert.equal(normalizeLogin("github.com/sindresorhus?tab=repositories"), "sindresorhus");
  assert.equal(normalizeLogin("  yyx990803 "), "yyx990803");
});

test("isValidLogin follows GitHub's rules", () => {
  for (const ok of ["a", "torvalds", "some-dev", "a1-b2-c3", "x".repeat(39)]) assert.ok(isValidLogin(ok), ok);
  for (const bad of ["", "-dev", "dev-", "two--hyphens", "x".repeat(40), "with_underscore", "dot.name"]) assert.ok(!isValidLogin(bad), bad);
});
