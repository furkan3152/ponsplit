import Link from "next/link";
import type { TokenView } from "@/lib/types";
import { curveProgress, formatEth, timeAgo } from "@/lib/format";
import { Progress } from "./Progress";
import { SplitList } from "./SplitList";
import { TokenAvatar } from "./TokenAvatar";

export function TokenCard({ t }: { t: TokenView }) {
  const progress = curveProgress(t.curve.realToken, t.curveSupply);
  return (
    <Link href={`/token/${t.token}`} className="card group flex flex-col gap-3 p-4 transition hover:border-lime/50">
      <div className="flex items-start gap-3">
        <TokenAvatar src={t.imageUrl} symbol={t.symbol} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-semibold group-hover:text-lime">{t.name}</span>
            <span className="font-mono text-xs text-mute">${t.symbol}</span>
          </div>
          <p className="line-clamp-2 text-sm text-mute">{t.description || "No description"}</p>
        </div>
      </div>
      <SplitList handles={t.handles} bps={t.bps} compact />
      <div className="mt-auto space-y-1.5">
        <div className="flex justify-between font-mono text-[11px] text-mute">
          <span>{t.curve.graduated ? (t.curve.migrated ? "Live on DEX" : "Graduated") : `${progress.toFixed(1)}% bonded`}</span>
          <span>{formatEth(t.curve.realEth, 3)} ETH</span>
        </div>
        <Progress value={progress} graduated={t.curve.graduated} />
        <div className="flex justify-between font-mono text-[11px] text-mute">
          <span>fees split {formatEth(t.creatorFees, 4)} ETH</span>
          <span>{timeAgo(Number(t.curve.createdAt))}</span>
        </div>
      </div>
    </Link>
  );
}
