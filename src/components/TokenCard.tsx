import Link from "next/link";
import { compact, formatEth, shortAddress, timeAgo } from "@/lib/format";
import { describe } from "@/lib/market";
import type { TokenView } from "@/lib/types";
import { Progress } from "./Progress";
import { TokenAvatar } from "./TokenAvatar";
import { XAvatarStack } from "./XAvatar";

export function TokenCard({ t }: { t: TokenView }) {
  const { marketCap, progress, meta } = describe(t);
  const graduated = t.market.graduated;
  return (
    <Link href={`/token/${t.token}`} className="card card-hover group relative flex flex-col gap-3 overflow-hidden p-4">
      <div className="flex gap-3.5">
        <TokenAvatar src={meta.image} seed={t.token} size={72} className="transition duration-500 group-hover:-rotate-3 group-hover:scale-105" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[16px] font-semibold">{t.name}</span>
            <span className="shrink-0 font-mono text-[12px] text-ink-2">${t.symbol}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
            <span>{shortAddress(t.market.creator)}</span>
            <span>·</span>
            <span>{timeAgo(t.market.createdAt)} ago</span>
          </div>
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-ink-2">{meta.description || "No description"}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2">
        <XAvatarStack handles={t.handles} size={20} max={3} />
        <span className="ml-auto font-mono text-[11px] text-ink-3">
          mcap <span className="text-[13px] font-semibold text-ink">{compact(marketCap)} Ξ</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Progress value={progress} graduated={graduated} size="sm" />
        </div>
        <span className={`num text-[11px] font-semibold ${graduated ? "text-up-ink" : "text-ink-2"}`}>{graduated ? "PonSwap" : `${progress.toFixed(0)}%`}</span>
      </div>
      <div className="flex items-center justify-between border-t border-line pt-2.5 font-mono text-[11px] text-ink-3">
        <span>split so far</span>
        <span className="text-up-ink">{formatEth(t.creatorFees, 4)} ETH</span>
      </div>
    </Link>
  );
}
