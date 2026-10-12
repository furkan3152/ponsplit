import Link from "next/link";
import { coinImage, recipientNames } from "@/lib/coin-ui";
import { compact, formatPrice, progressText } from "@/lib/format";
import type { Coin } from "@/lib/types";
import { GithubAvatarStack } from "./GithubAvatar";
import { Progress } from "./Progress";
import { TokenAvatar } from "./TokenAvatar";

/** pump.fun's "king of the hill": the bonding coin closest to graduating, in a spotlight. */
export function KingCard({ t }: { t: Coin }) {
  return (
    <Link href={`/token/${t.token}`} className="card ring-glow group relative block rounded-[28px] p-5 sm:p-7">
      {/* Decorations are clipped in their own layer: clipping the card would hide its neon edge. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
        <div className="bg-grid absolute inset-0 opacity-70" />
        <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-lime opacity-[0.13] blur-3xl" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-lime px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--lime-ink)]">
          <span aria-hidden>👑</span> King of the hill
        </span>
        <span className="eyebrow hidden sm:block">Closest to graduating</span>
      </div>
      <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
        <TokenAvatar src={coinImage(t)} seed={t.token} size={112} className="transition duration-500 group-hover:-rotate-3 group-hover:scale-105" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="display truncate text-[34px] leading-none sm:text-[40px]">{t.name}</h2>
            <span className="shrink-0 font-mono text-[13px] text-ink-2">${t.symbol}</span>
          </div>
          <p className="mt-2 line-clamp-2 max-w-xl text-[15px] text-ink-2">
            {t.description || `Every trade pays ${recipientNames(t).map((h) => `@${h}`).join(", ")} on GitHub.`}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-ink-2">
            <GithubAvatarStack people={t.recipients} size={24} />
            <span>
              mcap <span className="num font-semibold text-ink">{compact(t.marketCap)} SOL</span>
            </span>
            <span>
              price <span className="num font-semibold text-ink">{formatPrice(t.price)}</span>
            </span>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <div className="flex-1">
              <Progress value={t.progress} />
            </div>
            <span className="num text-neon text-[15px] font-bold">{progressText(t.progress, 1)}%</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
