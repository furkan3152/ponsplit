import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCandles, candleForAll } from "./candles.ts";
import type { Trade } from "./solana/trades.ts";

// Block times are real unix seconds; 0 means "not read yet" and is skipped, so tests start at B.
const B = 1_800_000_000;
const trade = (at: number, price: number, eth = 1n): Trade =>
  ({ timestamp: B + at, price, sol: eth * 10n ** 9n, slot: at }) as unknown as Trade;

test("without a window, only buckets with trades get candles", () => {
  const c = buildCandles([trade(0, 1), trade(130, 2)], 60);
  assert.deepEqual(c.map((x) => x.time - B), [0, 120]);
  assert.equal(c[1].open, 1);
});

test("a window fills quiet buckets flat at the last price, up to now", () => {
  const c = buildCandles([trade(0, 1), trade(130, 2)], 60, { from: B, to: B + 300 });
  assert.deepEqual(c.map((x) => x.time - B), [0, 60, 120, 180, 240, 300]);
  assert.deepEqual([c[1].open, c[1].close, c[1].volume], [1, 1, 0]);
  assert.deepEqual([c[5].open, c[5].close], [2, 2]);
});

test("trades before the window only set the opening price", () => {
  const c = buildCandles([trade(0, 1), trade(1000, 3)], 60, { from: B + 900, to: B + 1100 });
  assert.equal(c[0].time, B + 900);
  assert.equal(c[0].open, 1);
  assert.equal(c.find((x) => x.time === B + 960)!.close, 3);
});

test("different ranges give different pictures of the same trades", () => {
  const trades = [trade(0, 1), trade(3000, 2), trade(3500, 1.5)];
  const hour = buildCandles(trades, 60, { from: B, to: B + 3600 });
  const fiveMin = buildCandles(trades, 10, { from: B + 3300, to: B + 3600 });
  assert.equal(hour.length, 61);
  assert.equal(fiveMin.length, 31);
  assert.equal(fiveMin[0].open, 2);
});

test("ALL picks a candle size that keeps the chart readable", () => {
  assert.equal(candleForAll(0, 600), 10);
  assert.equal(candleForAll(0, 86_400), 15 * 60);
  assert.equal(candleForAll(0, 30 * 86_400), 4 * 3600);
});
