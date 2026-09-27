"use client";

import { explorerUrl } from "@/lib/chains";
import { formatEth, formatPrice, formatTokens, recordPrice, shortAddress, timeAgo } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { TradeRecord } from "@/lib/types";

export function TradesTable({ trades, symbol, me }: { trades: readonly TradeRecord[] | undefined; symbol: string; me?: string }) {
  useNow(10_000);
  const rows = (trades ?? []).slice(-60).reverse();
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="text-[17px] font-semibold">Trades</h2>
        <span className="text-[12px] text-ink-2">{trades ? `${trades.length} total` : ""}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-6 pt-2 text-[14px] text-ink-2">No trades yet. Be the first.</p>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-card text-left text-[12px] text-ink-2">
              <tr>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 text-right font-medium">ETH</th>
                <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">{symbol}</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">Price</th>
                <th className="px-4 py-2 text-right font-medium">Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={`${t.timestamp}-${i}`} className="border-t border-line">
                  <td className="px-4 py-2">
                    <a className="num hover:underline" href={explorerUrl("address", t.trader)} target="_blank" rel="noreferrer">
                      {me && t.trader.toLowerCase() === me.toLowerCase() ? "you" : shortAddress(t.trader)}
                    </a>
                  </td>
                  <td className="px-2 py-2">
                    <span className={`chip ${t.isBuy ? "!bg-up-soft !text-up-ink" : "!bg-down-soft !text-down-ink"}`}>{t.isBuy ? "Buy" : "Sell"}</span>
                  </td>
                  <td className="num px-2 py-2 text-right">{formatEth(t.ethAmount, 4)}</td>
                  <td className="num hidden px-2 py-2 text-right sm:table-cell">{formatTokens(t.tokenAmount)}</td>
                  <td className="num hidden px-2 py-2 text-right text-ink-2 md:table-cell">{formatPrice(recordPrice(t.price))}</td>
                  <td className="num px-4 py-2 text-right text-ink-2">{timeAgo(t.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
