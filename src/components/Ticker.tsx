"use client";

import Link from "next/link";
import { formatEth, shortAddress, timeAgo } from "@/lib/format";
import { useNow, useRecentTrades } from "@/lib/hooks";
import { TokenSticker } from "./art";

/** A live tape of the latest trades across every coin, like the ticker on a trading floor. */
export function Ticker() {
  const { data } = useRecentTrades(24);
  useNow(15_000);
  if (!data || data.length === 0) return null;

  // Rendered twice so the marquee loops seamlessly.
  const items = [...data, ...data];
  return (
    <div className="group relative overflow-hidden border-b border-line bg-[var(--glass)] backdrop-blur-xl">
      <div className="mask-fade-x">
        <div className="flex w-max animate-marquee items-center py-2 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
          {items.map((r, i) => (
            <Link
              key={`${r.token}-${i}`}
              href={`/token/${r.token}`}
              aria-hidden={i >= data.length}
              tabIndex={i >= data.length ? -1 : undefined}
              className="flex shrink-0 items-center gap-2 px-4 font-mono text-[11.5px] transition hover:opacity-80"
            >
              <TokenSticker seed={r.token} size={16} />
              <span className="text-ink-3">{shortAddress(r.trade.trader)}</span>
              <span className={`font-semibold ${r.trade.isBuy ? "text-up-ink" : "text-down-ink"}`}>{r.trade.isBuy ? "▲ bought" : "▼ sold"}</span>
              <span className="text-ink">{formatEth(r.trade.ethAmount, 3)} ETH</span>
              <span className="text-ink-2">of ${r.symbol}</span>
              <span className="text-ink-3">{timeAgo(r.trade.timestamp)}</span>
              <span className="pl-2 text-ink-3" aria-hidden>
                /
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
