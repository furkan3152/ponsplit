"use client";

import Link from "next/link";
import { coinImage } from "@/lib/coin-ui";
import { compact, progressText } from "@/lib/format";
import { useCoins } from "@/lib/hooks";
import { TokenAvatar } from "./TokenAvatar";

/** A live tape of every Tiksplit coin's market cap and curve progress, like a trading floor's ticker. */
export function Ticker() {
  const { data } = useCoins();
  const coins = data ? [...data].sort((a, b) => b.marketCap - a.marketCap).slice(0, 24) : undefined;
  if (!coins || coins.length === 0) return null;

  // Rendered twice so the marquee loops seamlessly.
  const items = [...coins, ...coins];
  return (
    <div className="group relative overflow-hidden border-b border-line bg-[var(--glass)] backdrop-blur-xl">
      <div className="mask-fade-x">
        <div className="flex w-max animate-marquee items-center py-2 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
          {items.map((t, i) => (
            <Link
              key={`${t.token}-${i}`}
              href={`/token/${t.token}`}
              aria-hidden={i >= coins.length}
              tabIndex={i >= coins.length ? -1 : undefined}
              className="flex shrink-0 items-center gap-2 px-4 font-mono text-[11.5px] transition hover:opacity-80"
            >
              <TokenAvatar src={coinImage(t)} seed={t.token} size={16} />
              <span className="font-semibold text-ink">${t.symbol}</span>
              <span className="text-ink-2">{compact(t.marketCap)} SOL</span>
              <span className={t.graduated ? "text-up-ink" : "text-ink-3"}>{t.graduated ? "graduated" : `${progressText(t.progress)}%`}</span>
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
