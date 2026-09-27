"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { getAddress, isAddress, zeroAddress } from "viem";
import { useAccount } from "wagmi";
import { GraduatedArt, NotFoundArt } from "@/components/art";
import { PriceChart } from "@/components/PriceChart";
import { Progress } from "@/components/Progress";
import { SplitCard } from "@/components/SplitCard";
import { Stat } from "@/components/Stat";
import { TokenAvatar } from "@/components/TokenAvatar";
import { TradePanel } from "@/components/TradePanel";
import { TradesTable } from "@/components/TradesTable";
import { explorerUrl } from "@/lib/chains";
import { compact, formatEth, formatPrice, formatTokens, shortAddress, timeAgo } from "@/lib/format";
import { useLaunchpadNumber, useNow, useToken, useTrades } from "@/lib/hooks";
import { describe } from "@/lib/market";

export default function TokenPage({ params }: { params: { address: string } }) {
  const token = isAddress(params.address) ? getAddress(params.address) : undefined;
  const { data: t, isLoading, refetch } = useToken(token);
  const trades = useTrades(token, t?.tradeCount);
  const feeBps = useLaunchpadNumber("feeBps");
  const protocolShareBps = useLaunchpadNumber("protocolShareBps");
  const { address } = useAccount();
  const launched = useSearchParams().get("launched") === "1";
  useNow(15_000);

  if (!token) return <Missing text="That is not a valid coin address." />;
  if (isLoading) return <div className="card mt-4 h-[480px] animate-pulse" />;
  if (!t || t.token === zeroAddress) return <Missing text="This coin wasn't launched on PonSplit." />;

  const { price, marketCap, progress, meta } = describe(t);
  const links = [
    meta.website && { label: "Website", href: meta.website },
    meta.telegram && { label: "Telegram", href: meta.telegram },
    meta.twitter && { label: "X", href: meta.twitter },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <div className="space-y-5 pt-2">
      {launched ? (
        <div className="animate-pop rounded-3xl border-2 border-outline bg-lime px-5 py-3 text-[15px] font-semibold text-[#1d1d1f] shadow-sticker">
          🎉 ${t.symbol} is live. Share the link, and every trade pays your X accounts.
        </div>
      ) : null}

      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <TokenAvatar src={meta.image} seed={t.token} size={76} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <h1 className="font-display text-[30px] font-bold tracking-tight">{t.name}</h1>
            <span className="text-[17px] font-semibold text-ink-2">${t.symbol}</span>
            {t.market.graduated ? <span className="chip !bg-up-soft !text-up-ink">Graduated</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
            <CopyAddress value={token} />
            <span>
              by{" "}
              <a className="num hover:text-ink" href={explorerUrl("address", t.market.creator)} target="_blank" rel="noreferrer">
                {address && t.market.creator.toLowerCase() === address.toLowerCase() ? "you" : shortAddress(t.market.creator)}
              </a>
            </span>
            <span>{timeAgo(t.market.createdAt)} ago</span>
            {links.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer nofollow" className="font-medium text-ink hover:underline">
                {l.label} ↗
              </a>
            ))}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Price" value={`${formatPrice(price)} Ξ`} />
        <Stat label="Market cap" value={`${compact(marketCap)} Ξ`} />
        <Stat label={t.market.graduated ? "Pool liquidity" : "Raised on curve"} value={`${formatEth(t.market.realEth, 3)} Ξ`} />
        <Stat label="Paid to X accounts" value={`${formatEth(t.creatorFees, 4)} Ξ`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <PriceChart trades={trades.data} loading={trades.isLoading} />
          <TradesTable trades={trades.data} symbol={t.symbol} me={address} />
          {meta.description ? (
            <div className="card p-5">
              <h2 className="text-[17px] font-semibold">About</h2>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{meta.description}</p>
            </div>
          ) : null}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <TradePanel token={token} symbol={t.symbol} graduated={t.market.graduated} onTraded={() => refetch()} />

          <div className="card p-4">
            {t.market.graduated ? (
              <div className="flex items-center gap-3">
                <GraduatedArt className="h-16 w-16 shrink-0" />
                <div>
                  <div className="text-[15px] font-semibold">Graduated to PonSwap</div>
                  <p className="text-[13px] text-ink-2">
                    The curve sold out {timeAgo(t.market.graduatedAt)} ago. {formatTokens(t.market.realToken)} {t.symbol} and {formatEth(t.market.realEth, 3)} ETH sit in a
                    pool with locked liquidity. Fees keep flowing to the X accounts.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-[15px] font-semibold">Bonding curve</span>
                  <span className="num text-[15px] font-bold">{progress.toFixed(1)}%</span>
                </div>
                <div className="mt-2.5">
                  <Progress value={progress} />
                </div>
                <p className="mt-2.5 text-[13px] text-ink-2">
                  {formatTokens(t.market.realToken)} {t.symbol} left to sell. When it sells out, the coin graduates to PonSwap and keeps trading here.
                </p>
              </>
            )}
          </div>

          <SplitCard t={t} feeBps={feeBps} protocolShareBps={protocolShareBps} />
        </aside>
      </div>
    </div>
  );
}

function CopyAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="num rounded-full bg-card-2 px-2 py-0.5 hover:text-ink"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? "copied ✓" : `${shortAddress(value)} ⧉`}
    </button>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <div className="card mx-auto mt-6 flex max-w-lg flex-col items-center gap-3 px-6 py-12 text-center">
      <NotFoundArt className="h-36 w-48" />
      <p className="text-[17px] font-semibold">{text}</p>
      <Link href="/" className="btn-secondary">
        Back to explore
      </Link>
    </div>
  );
}
