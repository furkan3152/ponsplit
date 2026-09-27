"use client";

import Link from "next/link";
import { useReadContract } from "wagmi";
import { feeVaultAbi } from "@/lib/abi";
import { activeChain } from "@/lib/chains";
import { FEE_VAULT_ADDRESS } from "@/lib/config";
import { formatEth, pct } from "@/lib/format";
import { xProfileUrlById } from "@/lib/handles";
import type { TokenView } from "@/lib/types";
import { XAvatar } from "./XAvatar";

const BAR_COLORS = ["var(--lime)", "var(--sky)", "var(--pink)", "var(--sun)", "var(--lilac)", "var(--orange)"];

/** Who gets this token's fees, how much of each fee, and what they've earned from it. */
export function SplitCard({ t, feeBps, protocolShareBps }: { t: TokenView; feeBps?: bigint; protocolShareBps?: bigint }) {
  const { data } = useReadContract({
    address: FEE_VAULT_ADDRESS,
    abi: feeVaultAbi,
    chainId: activeChain.id,
    functionName: "earningsOf",
    args: [t.xIds],
    query: { enabled: Boolean(FEE_VAULT_ADDRESS && t.xIds.length), refetchInterval: 10_000 },
  });
  const creatorPct = feeBps !== undefined && protocolShareBps !== undefined ? (Number(feeBps) * (10_000 - Number(protocolShareBps))) / 1e6 : undefined;

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold">Fee split</h2>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {creatorPct !== undefined ? `${creatorPct.toLocaleString("en-US", { maximumFractionDigits: 2 })}% of every trade goes to these accounts.` : "Every trade pays these accounts."}{" "}
            <Link href="/claim" className="font-medium text-ink underline-offset-2 hover:underline">
              Claim with X →
            </Link>
          </p>
        </div>
        <div className="text-right">
          <div className="num text-[17px] font-semibold">{formatEth(t.creatorFees, 4)}</div>
          <div className="text-[11px] text-ink-2">ETH split</div>
        </div>
      </div>

      {/* One bar showing each share, with the same colors as the dots below. */}
      <div className="mt-4 flex h-3 overflow-hidden rounded-full border-2 border-outline">
        {t.bps.map((b, i) => (
          <div key={i} style={{ width: `${Number(b) / 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} className={i ? "border-l-2 border-outline" : ""} />
        ))}
      </div>

      <ul className="mt-4 space-y-3">
        {t.handles.map((h, i) => {
          const fromToken = (t.creatorFees * BigInt(t.bps[i])) / 10_000n;
          return (
            <li key={h} className="flex items-center gap-3">
              <XAvatar handle={h} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-outline" style={{ background: BAR_COLORS[i % BAR_COLORS.length] }} aria-hidden />
                  <a href={xProfileUrlById(t.xIds[i])} target="_blank" rel="noreferrer" className="truncate text-[14px] font-semibold hover:underline">
                    @{h}
                  </a>
                </div>
                <div className="num text-[12px] text-ink-2">
                  {formatEth(fromToken, 5)} ETH from this coin
                  {data ? ` · ${formatEth(data[0][i], 5)} ETH unclaimed overall` : ""}
                </div>
              </div>
              <span className="num text-[15px] font-semibold">{pct(t.bps[i])}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
