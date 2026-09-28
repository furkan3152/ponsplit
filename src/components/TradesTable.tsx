"use client";

import { useMemo } from "react";
import { explorerUrl } from "@/lib/chains";
import { formatEth, formatPrice, formatTokens, recordPrice, shortAddress, timeAgo } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { TradeRecord } from "@/lib/types";
import { EmptyArt } from "./art";

/**
 * Stable row keys from the trade itself (plus a counter for identical trades), so rows that are
 * already on screen keep their elements and only new trades mount, and slide in.
 */
function keyed(trades: readonly TradeRecord[]) {
  const seen = new Map<string, number>();
  return trades.map((t) => {
    const base = `${t.trader}-${t.timestamp}-${t.isBuy ? "b" : "s"}-${t.ethAmount}-${t.tokenAmount}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: `${base}-${n}`, t };
  });
}

export function TradesTable({
  trades,
  symbol,
  me,
  total,
}: {
  trades: readonly TradeRecord[] | undefined;
  symbol: string;
  me?: string;
  /** The token's real trade count; `trades` may hold only the most recent ones. */
  total?: bigint;
}) {
  useNow(10_000);
  const rows = useMemo(() => keyed(trades ?? []).slice(-60).reverse(), [trades]);
  return (
    <section className="card overflow-hidden">
      <div className="flex items-end justify-between gap-3 px-4 pb-3.5 pt-4 sm:px-5 sm:pt-5">
        <div>
          <div className="eyebrow flex items-center gap-2">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" />
            Live tape
          </div>
          <h2 className="display mt-1 text-[26px] leading-none">Trades</h2>
        </div>
        <span className="num pb-0.5 text-[11px] text-ink-3">{trades ? `${(total ?? BigInt(trades.length)).toLocaleString("en-US")} total` : ""}</span>
      </div>
      {!trades ? (
        <div className="border-t border-line px-4 pb-5 pt-3 sm:px-5">
          <p className="text-[13px] text-ink-2">Loading…</p>
          <div aria-hidden className="mt-3 space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-5 animate-pulse rounded-md bg-card-2" style={{ width: `${92 - i * 14}%` }} />
            ))}
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 border-t border-line px-4 pb-8 pt-6 text-center">
          <EmptyArt className="h-16 w-20 animate-float" />
          <p className="text-[14px] text-ink-2">No trades yet. Be the first.</p>
        </div>
      ) : (
        <div className="max-h-[440px] overflow-auto border-t border-line">
          <table className="w-full font-mono text-[12px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-card text-left text-[10px] uppercase tracking-[0.12em] text-ink-3 shadow-[0_1px_0_var(--line)]">
              <tr>
                <th className="py-2.5 pl-4 pr-2 font-medium sm:pl-5">Account</th>
                <th className="px-2 py-2.5 font-medium">Type</th>
                <th className="px-2 py-2.5 text-right font-medium">ETH</th>
                <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">{symbol}</th>
                <th className="hidden px-2 py-2.5 text-right font-medium md:table-cell">Price</th>
                <th className="py-2.5 pl-2 pr-4 text-right font-medium sm:pr-5">Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, t }) => {
                const mine = Boolean(me && t.trader.toLowerCase() === me.toLowerCase());
                return (
                  <tr key={key} className="animate-slide-up border-t border-line transition-colors first:border-t-0 hover:bg-card-2">
                    <td className="relative py-2.5 pl-4 pr-2 sm:pl-5">
                      <span aria-hidden className={`absolute inset-y-2 left-0 w-[3px] rounded-r-full ${t.isBuy ? "bg-up" : "bg-down"}`} />
                      <a
                        className={`hover:underline ${mine ? "rounded-full bg-lime px-1.5 py-0.5 font-semibold text-[var(--lime-ink)] no-underline" : "text-ink"}`}
                        href={explorerUrl("address", t.trader)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {mine ? "you" : shortAddress(t.trader)}
                      </a>
                    </td>
                    <td className={`px-2 py-2.5 font-semibold ${t.isBuy ? "text-up-ink" : "text-down-ink"}`}>
                      <span aria-hidden>{t.isBuy ? "▲ " : "▼ "}</span>
                      {t.isBuy ? "Buy" : "Sell"}
                    </td>
                    <td className="px-2 py-2.5 text-right text-ink">{formatEth(t.ethAmount, 4)}</td>
                    <td className="hidden px-2 py-2.5 text-right text-ink-2 sm:table-cell">{formatTokens(t.tokenAmount)}</td>
                    <td className="hidden px-2 py-2.5 text-right text-ink-2 md:table-cell">{formatPrice(recordPrice(t.price))}</td>
                    <td className="py-2.5 pl-2 pr-4 text-right text-ink-3 sm:pr-5">{timeAgo(t.timestamp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
