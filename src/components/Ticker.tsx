"use client";

import Link from "next/link";
import { formatEth, shortAddress, timeAgo } from "@/lib/format";
import { useNow, useRecentTrades } from "@/lib/hooks";
import { TokenSticker } from "./art";

/** pump.fun-style live tape of the latest trades across every token. */
export function Ticker() {
  const { data } = useRecentTrades(24);
  useNow(15_000);
  if (!data || data.length === 0) return null;

  // Rendered twice so the marquee loops seamlessly.
  const items = [...data, ...data];
  return (
    <div className="group relative overflow-hidden border-b border-line bg-card">
      <div className="flex w-max animate-marquee gap-2 py-2 pl-2 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {items.map((r, i) => (
          <Link
            key={`${r.token}-${i}`}
            href={`/token/${r.token}`}
            aria-hidden={i >= data.length}
            tabIndex={i >= data.length ? -1 : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1 text-[12px] font-medium ${
              r.trade.isBuy ? "bg-up-soft text-up-ink" : "bg-down-soft text-down-ink"
            }`}
          >
            <TokenSticker seed={r.token} size={18} />
            <span className="num">{shortAddress(r.trade.trader)}</span>
            <span>{r.trade.isBuy ? "bought" : "sold"}</span>
            <span className="num font-semibold">{formatEth(r.trade.ethAmount, 3)} ETH</span>
            <span>of ${r.symbol}</span>
            <span className="text-ink-3">{timeAgo(r.trade.timestamp)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
