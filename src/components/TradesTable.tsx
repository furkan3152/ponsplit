"use client";

import { useMemo } from "react";
import { formatEth, formatPrice, formatTokens, shortAddress, timeAgo } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useNetwork } from "@/lib/network-context";
import { explorerLink } from "@/lib/networks";
import type { Trade } from "@/lib/types";
import { EmptyArt } from "./art";

/** Rows keyed by where the trade sits on-chain, so rows already on screen keep their elements. */
const keyOf = (t: Trade) => `${t.txHash}-${t.logIndex}`;

export function TradesTable({
  trades,
  symbol,
  me,
  hasOlder,
  loadOlder,
  loadingOlder,
}: {
  trades: readonly Trade[] | undefined;
  symbol: string;
  me?: string;
  /** Older trades exist beyond what's loaded. */
  hasOlder?: boolean;
  loadOlder?: () => void;
  loadingOlder?: boolean;
}) {
  const n = useNetwork();
  useNow(10_000);
  const rows = useMemo(() => (trades ?? []).slice(-60).reverse(), [trades]);
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
        <span className="num pb-0.5 text-[11px] text-ink-3">{trades ? `${trades.length.toLocaleString("en-US")}${hasOlder ? "+" : ""} loaded` : ""}</span>
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
              {rows.map((t) => {
                const mine = Boolean(me && t.trader.toLowerCase() === me.toLowerCase());
                const buy = t.kind === "buy";
                return (
                  <tr key={keyOf(t)} className="animate-slide-up border-t border-line transition-colors first:border-t-0 hover:bg-card-2">
                    <td className="relative py-2.5 pl-4 pr-2 sm:pl-5">
                      <span aria-hidden className={`absolute inset-y-2 left-0 w-[3px] rounded-r-full ${buy ? "bg-up" : "bg-down"}`} />
                      <a
                        className={`hover:underline ${mine ? "rounded-full bg-lime px-1.5 py-0.5 font-semibold text-[var(--lime-ink)] no-underline" : "text-ink"}`}
                        href={explorerLink(n, "address", t.trader)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {mine ? "you" : shortAddress(t.trader)}
                      </a>
                    </td>
                    <td className={`px-2 py-2.5 font-semibold ${buy ? "text-up-ink" : "text-down-ink"}`}>
                      <span aria-hidden>{buy ? "▲ " : "▼ "}</span>
                      {buy ? "Buy" : "Sell"}
                      {t.venue === "pool" ? <span className="ml-1 hidden font-normal text-ink-3 sm:inline">· pool</span> : null}
                    </td>
                    <td className="px-2 py-2.5 text-right text-ink">{formatEth(t.ethAmount, 4)}</td>
                    <td className="hidden px-2 py-2.5 text-right text-ink-2 sm:table-cell">{formatTokens(t.tokenAmount)}</td>
                    <td className="hidden px-2 py-2.5 text-right text-ink-2 md:table-cell">{formatPrice(t.price)}</td>
                    <td className="py-2.5 pl-2 pr-4 text-right text-ink-3 sm:pr-5">{t.timestamp ? timeAgo(t.timestamp) : "…"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasOlder && loadOlder ? (
            <div className="border-t border-line px-4 py-3 text-center sm:px-5">
              <button className="btn-secondary min-h-[36px] px-4 py-1.5 text-[12px]" disabled={loadingOlder} onClick={loadOlder}>
                {loadingOlder ? "Loading…" : "Load older trades"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
