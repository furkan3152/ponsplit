"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { formatUnits } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { EmptyState } from "@/components/EmptyState";
import { Stat } from "@/components/Stat";
import { TokenAvatar } from "@/components/TokenAvatar";
import { splitTokenAbi } from "@/lib/abi";
import { activeChain } from "@/lib/chains";
import { compact, formatEth, formatTokens } from "@/lib/format";
import { useTokens } from "@/lib/hooks";
import { describe } from "@/lib/market";

export default function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { data: tokens } = useTokens();

  const { data: balances } = useReadContracts({
    contracts: (tokens ?? []).map((t) => ({
      address: t.token,
      abi: splitTokenAbi,
      chainId: activeChain.id,
      functionName: "balanceOf" as const,
      args: [address!] as const,
    })),
    query: { enabled: Boolean(address && tokens?.length), refetchInterval: 15_000 },
  });

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-md pt-10">
        <EmptyState title="Connect to see your coins">
          <button className="btn-primary mt-2" onClick={openConnectModal}>
            Connect wallet
          </button>
        </EmptyState>
      </div>
    );
  }

  const holdings = (tokens ?? [])
    .map((t, i) => {
      const bal = (balances?.[i]?.result as bigint | undefined) ?? 0n;
      const d = describe(t);
      return { t, bal, value: Number(formatUnits(bal, 18)) * d.price, meta: d.meta };
    })
    .filter((h) => h.bal > 0n)
    .sort((a, b) => b.value - a.value);
  const created = (tokens ?? []).filter((t) => t.market.creator.toLowerCase() === address!.toLowerCase());
  const total = holdings.reduce((a, h) => a + h.value, 0);

  return (
    <div className="space-y-8 pt-4">
      <h1 className="font-display text-[40px] font-bold tracking-[-0.03em]">Portfolio</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Holdings value" value={`${compact(total, 4)} Ξ`} />
        <Stat label="Coins held" value={holdings.length} />
        <Stat label="Coins launched" value={created.length} />
      </div>

      <section className="card overflow-hidden">
        <h2 className="px-5 pb-2 pt-5 text-[17px] font-semibold">Holdings</h2>
        {holdings.length === 0 ? (
          <p className="px-5 pb-5 text-[14px] text-ink-2">
            No coins yet.{" "}
            <Link href="/" className="font-medium text-ink underline">
              Explore
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {holdings.map(({ t, bal, value, meta }) => (
              <li key={t.token}>
                <Link href={`/token/${t.token}`} className="flex items-center gap-3 px-5 py-3 hover:bg-card-2">
                  <TokenAvatar src={meta.image} seed={t.token} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{t.name}</div>
                    <div className="num text-[12px] text-ink-2">
                      {formatTokens(bal)} ${t.symbol}
                    </div>
                  </div>
                  <div className="num text-right text-[15px] font-semibold">{compact(value, 5)} Ξ</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="px-5 pb-2 pt-5 text-[17px] font-semibold">Launched by you</h2>
        {created.length === 0 ? (
          <p className="px-5 pb-5 text-[14px] text-ink-2">
            Nothing yet.{" "}
            <Link href="/create" className="font-medium text-ink underline">
              Launch a coin
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {created.map((t) => (
              <li key={t.token}>
                <Link href={`/token/${t.token}`} className="flex items-center gap-3 px-5 py-3 hover:bg-card-2">
                  <TokenAvatar src={describe(t).meta.image} seed={t.token} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{t.name}</div>
                    <div className="text-[12px] text-ink-2">
                      {t.market.graduated ? "Graduated" : `${describe(t).progress.toFixed(1)}% bonded`} · {t.tradeCount.toString()} trades
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[15px] font-semibold">{formatEth(t.creatorFees, 4)} Ξ</div>
                    <div className="text-[11px] text-ink-2">split to X</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
