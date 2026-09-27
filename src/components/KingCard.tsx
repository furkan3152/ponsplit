import Link from "next/link";
import { compact, formatPrice } from "@/lib/format";
import { describe } from "@/lib/market";
import type { TokenView } from "@/lib/types";
import { Progress } from "./Progress";
import { TokenAvatar } from "./TokenAvatar";
import { XAvatarStack } from "./XAvatar";

/** pump.fun's "king of the hill": the bonding token closest to graduating. */
export function KingCard({ t }: { t: TokenView }) {
  const { price, marketCap, progress, meta } = describe(t);
  return (
    <Link
      href={`/token/${t.token}`}
      className="group relative block overflow-hidden rounded-4xl border-2 border-outline bg-lime p-5 text-[#1d1d1f] shadow-sticker transition hover:-translate-y-0.5 sm:p-6"
    >
      <div className="absolute right-5 top-4 rotate-6 rounded-full border-2 border-outline bg-sun px-3 py-1 text-[12px] font-bold uppercase tracking-wide shadow-sticker-sm">
        👑 King of the hill
      </div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <TokenAvatar src={meta.image} seed={t.token} size={112} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="truncate font-display text-[28px] font-bold tracking-tight">{t.name}</h2>
            <span className="font-semibold opacity-70">${t.symbol}</span>
          </div>
          <p className="mt-1 line-clamp-2 max-w-xl text-[15px] opacity-80">{meta.description || "No description"}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] font-medium">
            <XAvatarStack handles={t.handles} size={24} />
            <span>
              mcap <span className="num font-bold">{compact(marketCap)} ETH</span>
            </span>
            <span>
              price <span className="num font-bold">{formatPrice(price)}</span>
            </span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="flex-1">
              <Progress value={progress} />
            </div>
            <span className="num text-[15px] font-bold">{progress.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
