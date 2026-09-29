import type { Trade } from "./types";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/** Most candles a chart draws; a wider window gets bigger candles instead. */
export const MAX_CANDLES = 1_500;

/**
 * Buckets trades into OHLC candles of `intervalSec`. Each candle opens at the previous close so
 * there are no gaps. With a `window` (unix seconds) only that window is drawn and every bucket in
 * it gets a candle: one without trades is flat at the last price, so the time axis is true time
 * and each range really shows its own stretch of time. Trades before the window only set the
 * opening price.
 */
export function buildCandles(trades: readonly Trade[], intervalSec: number, window?: { from: number; to: number }): Candle[] {
  const candles: Candle[] = [];
  let prevClose: number | undefined;
  const start = window ? Math.floor(window.from / intervalSec) * intervalSec : -Infinity;
  // Flat candles for quiet buckets from after the last candle (or the window's start) to `until`.
  const fill = (until: number) => {
    if (!window || prevClose === undefined) return;
    let t = candles.length ? candles[candles.length - 1].time + intervalSec : start;
    for (; t < until && candles.length < MAX_CANDLES * 4; t += intervalSec) {
      candles.push({ time: t, open: prevClose, high: prevClose, low: prevClose, close: prevClose, volume: 0 });
    }
  };
  for (const t of trades) {
    // A trade whose block time couldn't be read yet has no place on the time axis.
    if (!t.timestamp || !(t.price > 0)) continue;
    const time = Math.floor(t.timestamp / intervalSec) * intervalSec;
    const price = t.price;
    const vol = Number(t.ethAmount) / 1e18;
    if (time < start) {
      prevClose = price;
      continue;
    }
    fill(time);
    const last = candles[candles.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += vol;
    } else if (last && time < last.time) {
      // Out of order (shouldn't happen: trades come sorted by block); fold it into the last candle.
      last.volume += vol;
    } else {
      const open = prevClose ?? price;
      candles.push({ time, open, high: Math.max(open, price), low: Math.min(open, price), close: price, volume: vol });
    }
    prevClose = price;
  }
  if (window) fill(Math.floor(window.to / intervalSec) * intervalSec + intervalSec);
  return candles.length > MAX_CANDLES ? candles.slice(-MAX_CANDLES) : candles;
}

/** The chart's ranges, as on pons: a stretch of time and the candle size that suits it. */
export const RANGES = [
  { label: "5M", span: 5 * 60, candle: 10 },
  { label: "1H", span: 60 * 60, candle: 60 },
  { label: "6H", span: 6 * 3600, candle: 5 * 60 },
  { label: "1D", span: 24 * 3600, candle: 15 * 60 },
  { label: "ALL", span: 0, candle: 0 },
] as const;

const SIZES = [10, 60, 5 * 60, 15 * 60, 3600, 4 * 3600, 24 * 3600];

/** Candle size for everything since `first`: the smallest that fits in about 200 candles. */
export function candleForAll(first: number, now: number): number {
  const span = Math.max(1, now - first);
  return SIZES.find((s) => span / s <= 200) ?? SIZES[SIZES.length - 1];
}
