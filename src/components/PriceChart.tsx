"use client";

import { ColorType, CrosshairMode, LineStyle, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildCandles, candleForAll, RANGES } from "@/lib/candles";
import { formatPrice } from "@/lib/format";
import type { Trade } from "@/lib/types";
import { StepTrade } from "./art";
import { Flash } from "./motion";

// The axis needs one more digit than the headline so adjacent ticks never read the same. The axis
// padding can put a tick a hair below zero (float noise, e.g. -6e-24); that is zero. Ticks further
// down, in the room left for the volume bars, get no label (prices are never negative).
const axisPrice = (n: number) => (n < -1e-18 ? "" : n < 1e-18 ? "0" : formatPrice(n, 4));


function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** "#rrggbb" plus an alpha → rgba(); any other color comes back as is. */
function withAlpha(color: string, alpha: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** SOL volume, short: 0.1234, 12.3, <0.0001. */
function volume(n: number) {
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : 2 });
}

type Ohlcv = { o: number; h: number; l: number; c: number; v?: number };

/**
 * Candles from on-chain trades (the pump.fun curve, then its pool), drawn like a terminal: mono type, dotted grid, volume at the
 * foot. Up candles have a faint body and down candles a solid one, so direction never relies on
 * red/green alone (deuteranopia), and the crosshair readout spells out OHLC. Colors come from the
 * theme's CSS variables; the chart is rebuilt whenever the theme changes.
 */
export function PriceChart({
  trades,
  loading,
  error = false,
  partial = false,
  symbol,
}: {
  trades: readonly Trade[] | undefined;
  loading?: boolean;
  error?: boolean;
  /** Older trades exist that aren't loaded yet. */
  partial?: boolean;
  /** Shown faintly behind the candles, the way trading terminals label a chart. */
  symbol?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi>();
  const series = useRef<ISeriesApi<"Candlestick">>();
  const volumes = useRef<ISeriesApi<"Histogram">>();
  const volumeColors = useRef({ up: "", down: "" });
  // A range, as on pump.fun: the last 5 minutes, hour, 6 hours, day, or everything loaded.
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("ALL");
  // The window ends now and moves with the clock, so a quiet coin's line keeps reaching the present.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(id);
  }, []);
  const [hover, setHover] = useState<Ohlcv | null>(null);
  // Bumped whenever the chart is rebuilt (theme change) so the data effect repaints it.
  const [epoch, setEpoch] = useState(0);

  const firstAt = trades?.find((t) => t.timestamp > 0)?.timestamp;
  const { candles, candle } = useMemo(() => {
    const r = RANGES.find((x) => x.label === range) ?? RANGES[RANGES.length - 1];
    const to = Math.max(now, trades?.at(-1)?.timestamp ?? 0);
    if (!firstAt) return { candles: [], candle: 60 };
    const size = r.span ? r.candle : candleForAll(firstAt, to);
    const from = r.span ? to - r.span : firstAt;
    return { candles: buildCandles(trades ?? [], size, { from, to }), candle: size };
  }, [trades, range, now, firstAt]);
  const last = candles[candles.length - 1];
  const first = candles[0];
  const change = first && last ? (last.close / first.open - 1) * 100 : 0;

  useEffect(() => {
    if (!el.current) return;
    const make = () => {
      const up = cssVar("--green");
      const down = cssVar("--red");
      const mono = cssVar("--font-mono") || "ui-monospace, SF Mono, monospace";
      const c = createChart(el.current!, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: cssVar("--ink-2"), fontFamily: mono, fontSize: 10 },
        grid: {
          vertLines: { color: cssVar("--grid"), style: LineStyle.Dotted },
          horzLines: { color: cssVar("--line"), style: LineStyle.Dotted },
        },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.14, bottom: 0.24 } },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: cssVar("--line-2"), width: 1, style: LineStyle.Dashed, labelBackgroundColor: cssVar("--card-3") },
          horzLine: { color: cssVar("--line-2"), width: 1, style: LineStyle.Dashed, labelBackgroundColor: cssVar("--card-3") },
        },
        watermark: {
          visible: false,
          color: cssVar("--line"),
          fontFamily: cssVar("--font-display") || mono,
          fontSize: 64,
          fontStyle: "800",
        },
        // A vertical swipe over the chart scrolls the page on phones instead of getting stuck.
        handleScroll: { vertTouchDrag: false },
        localization: { locale: "en-US", priceFormatter: axisPrice },
      });
      const s = c.addCandlestickSeries({
        upColor: withAlpha(up, 0.22),
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
        priceLineStyle: LineStyle.Dotted,
        priceFormat: { type: "custom", formatter: axisPrice, minMove: 1e-15 },
        // Prices are never negative; keep the axis from padding below zero.
        autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
          const r = original();
          if (r?.priceRange && r.priceRange.minValue < 0) r.priceRange.minValue = 0;
          return r;
        },
      });
      // Volume sits on its own hidden scale along the bottom fifth of the chart.
      const v = c.addHistogramSeries({ priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      v.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volumeColors.current = { up: withAlpha(up, 0.24), down: withAlpha(down, 0.24) };
      c.subscribeCrosshairMove((p) => {
        const d = p.seriesData.get(s) as { open: number; high: number; low: number; close: number } | undefined;
        const vol = p.seriesData.get(v) as { value?: number } | undefined;
        setHover(d ? { o: d.open, h: d.high, l: d.low, c: d.close, v: vol?.value } : null);
      });
      chart.current = c;
      series.current = s;
      volumes.current = v;
    };
    make();
    // Text on a canvas doesn't redraw when a web font arrives; nudge it once the fonts are in.
    void document.fonts?.ready.then(() => chart.current?.applyOptions({ layout: { fontFamily: cssVar("--font-mono") || "ui-monospace, monospace" } }));
    // Rebuild on theme change (<html data-theme>) so colors follow light/dark.
    const onTheme = () => {
      chart.current?.remove();
      make();
      setEpoch((e) => e + 1);
    };
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mo.disconnect();
      chart.current?.remove();
      chart.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!series.current) return;
    series.current.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    const { up, down } = volumeColors.current;
    volumes.current?.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? up : down })));
    chart.current?.applyOptions({ timeScale: { secondsVisible: candle < 60 } });
    if (candles.length) chart.current?.timeScale().fitContent();
  }, [candles, candle, epoch]);

  // The watermark only once there are candles, so it never sits under the empty-state message;
  // smaller on phones, where the chart is narrow.
  useEffect(() => {
    const narrow = (el.current?.clientWidth ?? 800) < 520;
    chart.current?.applyOptions({ watermark: { visible: Boolean(symbol) && candles.length > 0, text: symbol ? `$${symbol}` : "", fontSize: narrow ? 44 : 64 } });
  }, [symbol, candles.length, epoch]);

  const shown: Ohlcv | null = hover ?? (last ? { o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume } : null);

  return (
    <section className="card relative isolate overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-[radial-gradient(70%_80%_at_50%_100%,var(--lime-soft),transparent_70%)] opacity-60" />
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <div className="eyebrow flex items-center gap-2">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" />
            {symbol ? `$${symbol} / SOL` : "Price"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="num text-[26px] font-semibold leading-none tracking-tight sm:text-[30px]">
              <Flash value={last?.close}>{last ? `${formatPrice(last.close)} SOL` : "–"}</Flash>
            </span>
            {first && !hover ? (
              <span className={`num rounded-full px-2 py-1 text-[11.5px] font-semibold leading-none ${change >= 0 ? "bg-up-soft text-up-ink" : "bg-down-soft text-down-ink"}`}>
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
              </span>
            ) : null}
          </div>
          <div className="num mt-2.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-2">
            {shown ? (
              <>
                <Readout k="O" v={formatPrice(shown.o)} />
                <Readout k="H" v={formatPrice(shown.h)} />
                <Readout k="L" v={formatPrice(shown.l)} />
                <Readout k="C" v={formatPrice(shown.c)} />
                {shown.v !== undefined ? <Readout k="Vol" v={`${volume(shown.v)} SOL`} /> : null}
              </>
            ) : (
              <span>{loading ? "Loading trade history…" : error ? "Trade history is temporarily unavailable." : trades?.length ? "Waiting for trade timestamps…" : trades ? "No trades yet" : "Trade history has not loaded."}</span>
            )}
            {first && !hover && partial && trades ? <span className="text-ink-3">over the last {trades.length.toLocaleString("en-US")} trades</span> : null}
          </div>
        </div>
        <div className="segmented" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button key={r.label} type="button" role="tab" aria-selected={range === r.label} data-active={range === r.label} onClick={() => setRange(r.label)} className="relative after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] !px-3 !py-2 font-mono !text-[11.5px] sm:!py-1.5">
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-3 h-[300px] sm:h-[380px]">
        <div ref={el} className="absolute inset-0" />
        {loading && candles.length === 0 ? (
          <div aria-hidden className="absolute inset-x-4 bottom-8 top-2 animate-pulse rounded-2xl bg-card-2 sm:inset-x-5" />
        ) : null}
        {!loading && candles.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center px-6">
            <div className="flex flex-col items-center gap-2 text-center">
              <StepTrade className="h-24 w-24 animate-float" />
              <p className="text-[14px] text-ink-2">{error ? "Trade history is temporarily unavailable." : trades?.length ? "Waiting for confirmed trade timestamps." : trades ? "The chart starts with the first trade." : "Trade history has not loaded."}</p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Readout({ k, v }: { k: string; v: string }) {
  return (
    <span>
      <span className="text-ink-3">{k}</span> {v}
    </span>
  );
}
