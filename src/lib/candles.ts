import type { Trade } from "./types";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/** Buckets trades into OHLC candles. Each candle opens at the previous close so there are no gaps. */
export function buildCandles(trades: readonly Trade[], intervalSec: number): Candle[] {
  const candles: Candle[] = [];
  let prevClose: number | undefined;
  for (const t of trades) {
    // A trade whose block time couldn't be read yet has no place on the time axis.
    if (!t.timestamp || !(t.price > 0)) continue;
    const time = Math.floor(t.timestamp / intervalSec) * intervalSec;
    const price = t.price;
    const vol = Number(t.ethAmount) / 1e18;
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
  return candles;
}
