"use client";

import Link from "next/link";
import { formatEth, shortAddress, timeAgo } from "@/lib/format";
import { useActivity, useNow } from "@/lib/hooks";
import { TokenSticker } from "./art";

/** A live tape of the latest trades across every coin, like the ticker on a trading floor. */
export function Ticker() {
  const { data } = useActivity();
  useNow(15_000);
  const trades = data?.trades.slice(0, 24);
  if (!trades || trades.length === 0) return null;

  // Rendered twice so the marquee loops seamlessly.
  const items = [...trades, ...trades];
  return (
    <div className="group relative overflow-hidden border-b border-line bg-[var(--glass)] backdrop-blur-xl">
      <div className="mask-fade-x">
        <div className="flex w-max animate-marquee items-center py-2 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
          {items.map((t, i) => (
            <Link
              key={`${t.txHash}-${t.logIndex}-${i}`}
              href={`/token/${t.token}`}
              aria-hidden={i >= trades.length}
              tabIndex={i >= trades.length ? -1 : undefined}
              className="flex shrink-0 items-center gap-2 px-4 font-mono text-[11.5px] transition hover:opacity-80"
            >
              <TokenSticker seed={t.token} size={16} />
              <span className="text-ink-3">{shortAddress(t.trader)}</span>
              <span className={`font-semibold ${t.kind === "buy" ? "text-up-ink" : "text-down-ink"}`}>{t.kind === "buy" ? "▲ bought" : "▼ sold"}</span>
              <span className="text-ink">{formatEth(t.ethAmount, 3)} ETH</span>
              <span className="text-ink-2">of ${t.symbol}</span>
              {t.timestamp ? <span className="text-ink-3">{timeAgo(t.timestamp)}</span> : null}
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
