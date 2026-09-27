import Link from "next/link";
import { compact, formatEth, shortAddress, timeAgo } from "@/lib/format";
import { describe } from "@/lib/market";
import type { TokenView } from "@/lib/types";
import { Progress } from "./Progress";
import { TokenAvatar } from "./TokenAvatar";
import { XAvatarStack } from "./XAvatar";

export function TokenCard({ t }: { t: TokenView }) {
  const { marketCap, progress, meta } = describe(t);
  return (
    <Link
      href={`/token/${t.token}`}
      className="card group flex gap-3.5 p-3.5 transition duration-200 hover:-translate-y-0.5 hover:shadow-lift"
    >
      <TokenAvatar src={meta.image} seed={t.token} size={84} className="transition group-hover:rotate-[-2deg]" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[15px] font-semibold">{t.name}</span>
          <span className="shrink-0 text-[13px] font-medium text-ink-2">${t.symbol}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-2">
          <span className="num">{shortAddress(t.market.creator)}</span>
          <span className="text-ink-3">·</span>
          <span>{timeAgo(t.market.createdAt)} ago</span>
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-2">{meta.description || "No description"}</p>
        <div className="mt-auto flex items-center gap-2 pt-2">
          <XAvatarStack handles={t.handles} size={20} max={3} />
          <span className="ml-auto text-[12px] text-ink-2">
            mcap <span className="num font-semibold text-ink">{compact(marketCap)} Ξ</span>
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1">
            <Progress value={progress} graduated={t.market.graduated} size="sm" />
          </div>
          <span className={`num text-[11px] font-semibold ${t.market.graduated ? "text-up-ink" : "text-ink-2"}`}>
            {t.market.graduated ? "PonSwap" : `${progress.toFixed(0)}%`}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-ink-3">
          split so far <span className="num text-ink-2">{formatEth(t.creatorFees, 4)} ETH</span>
        </div>
      </div>
    </Link>
  );
}
