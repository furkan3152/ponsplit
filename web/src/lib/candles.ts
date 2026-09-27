import type { TradeRecord } from "./types";
import { recordPrice } from "./format";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/** Buckets trades into OHLC candles. Each candle opens at the previous close so there are no gaps. */
export function buildCandles(trades: readonly TradeRecord[], intervalSec: number): Candle[] {
  const candles: Candle[] = [];
  let prevClose: number | undefined;
  for (const t of trades) {
    const time = Math.floor(Number(t.timestamp) / intervalSec) * intervalSec;
    const price = recordPrice(t.price);
    const vol = Number(t.ethAmount) / 1e18;
    const last = candles[candles.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += vol;
    } else {
      const open = prevClose ?? price;
      candles.push({ time, open, high: Math.max(open, price), low: Math.min(open, price), close: price, volume: vol });
    }
    prevClose = price;
  }
  return candles;
}
