"use client";

import { ColorType, CrosshairMode, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildCandles } from "@/lib/candles";
import { formatPrice } from "@/lib/format";

// The axis needs one more digit than the headline so adjacent ticks never read the same. The axis
// padding can put a tick a hair below zero (float noise, e.g. -6e-24); that is zero.
const axisPrice = (n: number) => (n < 1e-18 ? "0" : formatPrice(n, 4));
import type { TradeRecord } from "@/lib/types";

const FRAMES = [
  { label: "1m", sec: 60 },
  { label: "5m", sec: 300 },
  { label: "15m", sec: 900 },
  { label: "1h", sec: 3600 },
  { label: "4h", sec: 14400 },
];

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Candles from on-chain trade records. Up candles are hollow and down candles filled, so direction
 * never relies on red/green alone (deuteranopia), and the crosshair tooltip spells out OHLC.
 */
export function PriceChart({ trades, loading, total }: { trades: readonly TradeRecord[] | undefined; loading?: boolean; total?: bigint }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi>();
  const series = useRef<ISeriesApi<"Candlestick">>();
  const [frame, setFrame] = useState(300);
  const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number } | null>(null);
  // Bumped whenever the chart is rebuilt (theme change) so the data effect repaints it.
  const [epoch, setEpoch] = useState(0);

  const candles = useMemo(() => buildCandles(trades ?? [], frame), [trades, frame]);
  const last = candles[candles.length - 1];
  const first = candles[0];
  const change = first && last ? (last.close / first.open - 1) * 100 : 0;

  useEffect(() => {
    if (!el.current) return;
    const make = () => {
      const up = cssVar("--green");
      const down = cssVar("--red");
      const c = createChart(el.current!, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: cssVar("--ink-2"), fontFamily: "ui-monospace, SF Mono, monospace", fontSize: 11 },
        grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--line") } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
        crosshair: { mode: CrosshairMode.Normal },
        localization: { locale: "en-US", priceFormatter: axisPrice },
      });
      const s = c.addCandlestickSeries({
        upColor: "rgba(0,0,0,0)",
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
        priceFormat: { type: "custom", formatter: axisPrice, minMove: 1e-15 },
        // Prices are never negative; keep the axis from padding below zero.
        autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
          const r = original();
          if (r?.priceRange && r.priceRange.minValue < 0) r.priceRange.minValue = 0;
          return r;
        },
      });
      c.subscribeCrosshairMove((p) => {
        const d = p.seriesData.get(s) as { open: number; high: number; low: number; close: number } | undefined;
        setHover(d ? { o: d.open, h: d.high, l: d.low, c: d.close } : null);
      });
      chart.current = c;
      series.current = s;
    };
    make();
    // Rebuild on theme change so colors follow light/dark.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => {
      chart.current?.remove();
      make();
      setEpoch((e) => e + 1);
    };
    mq.addEventListener("change", onTheme);
    return () => {
      mq.removeEventListener("change", onTheme);
      chart.current?.remove();
      chart.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!series.current) return;
    series.current.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    if (candles.length) chart.current?.timeScale().fitContent();
  }, [candles, epoch]);

  const shown = hover ?? (last ? { o: last.open, h: last.high, l: last.low, c: last.close } : null);

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="num text-[22px] font-semibold tracking-tight">{last ? `${formatPrice(last.close)} ETH` : "–"}</div>
          <div className="num mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-ink-2">
            {shown ? (
              <>
                <span>O {formatPrice(shown.o)}</span>
                <span>H {formatPrice(shown.h)}</span>
                <span>L {formatPrice(shown.l)}</span>
                <span>C {formatPrice(shown.c)}</span>
              </>
            ) : (
              <span>No trades yet</span>
            )}
            {first && !hover ? (
              <span className={change >= 0 ? "text-up-ink" : "text-down-ink"}>
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
                {trades && total !== undefined && total > BigInt(trades.length) ? ` over the last ${trades.length.toLocaleString("en-US")} trades` : ""}
              </span>
            ) : null}
          </div>
        </div>
        <div className="segmented" role="tablist" aria-label="Candle interval">
          {FRAMES.map((f) => (
            <button key={f.sec} role="tab" aria-selected={frame === f.sec} data-active={frame === f.sec} onClick={() => setFrame(f.sec)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative h-[320px] sm:h-[380px]">
        <div ref={el} className="absolute inset-0" />
        {!loading && candles.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-[14px] text-ink-2">The chart starts with the first trade.</div>
        ) : null}
      </div>
    </div>
  );
}
