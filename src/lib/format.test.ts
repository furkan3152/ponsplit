import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPrice, progressText } from "./format.ts";

// Run with: node --experimental-strip-types --test src/lib/format.test.ts
test("tiny prices use the subscript zero count (0.0₈205 = 0.00000000205)", () => {
  assert.equal(formatPrice(2.05e-9), "0.0₈205");
  assert.equal(formatPrice(1.5 / 1.073e9), "0.0₈140"); // launch price of every coin
  assert.equal(formatPrice(2.054e-8), "0.0₇205"); // around graduation
  assert.equal(formatPrice(5.821e-5), "0.0₄582");
  assert.equal(formatPrice(5.12e-4), "0.0₃512");
});

test("exact powers of ten and their neighbours read the same", () => {
  assert.equal(formatPrice(1e-9), "0.0₈100");
  assert.equal(formatPrice(1.01e-9), "0.0₈101");
  assert.equal(formatPrice(9.99e-10), "0.0₉999");
});

test("rounding that carries into a new digit drops a zero", () => {
  assert.equal(formatPrice(9.9996e-4), "0.0₂100");
  assert.equal(formatPrice(9.9996e-9), "0.0₇100");
});

test("axis precision keeps 4 significant digits", () => {
  assert.equal(formatPrice(1.398e-9, 4), "0.0₈1398");
});

test("negative values (a chart axis tick below zero) keep their sign instead of reading NaN", () => {
  assert.equal(formatPrice(-2e-9, 4), "-0.0₈2000");
  assert.equal(formatPrice(-0.5), "-0.500");
  assert.equal(formatPrice(Number.NaN), "0");
});

test("larger prices", () => {
  assert.equal(formatPrice(0), "0");
  assert.equal(formatPrice(0.0123), "0.0123");
  assert.equal(formatPrice(1.5), "1.5");
});

test("curve progress rounds down, so a coin still on the curve never reads 100%", () => {
  assert.equal(progressText(99.62), "99");
  assert.equal(progressText(99.96, 1), "99.9");
  assert.equal(progressText(100), "100");
  assert.equal(progressText(0), "0");
  // float noise must not push a value below its own digits
  assert.equal(progressText(0.29 * 100), "29");
  assert.equal(progressText(12.3, 1), "12.3");
  assert.equal(progressText(57.07, 1), "57.0");
});
