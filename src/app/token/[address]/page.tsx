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
import { useHandleChecks, useNow, useToken, useTrades } from "@/lib/hooks";
import { describe } from "@/lib/market";

export default function TokenPage({ params }: { params: { address: string } }) {
  const token = isAddress(params.address) ? getAddress(params.address) : undefined;
  const { data: t, isLoading, isError, refetch } = useToken(token);
  const trades = useTrades(token, t?.tradeCount);
  const { address } = useAccount();
  const launched = useSearchParams().get("launched") === "1";
  useNow(15_000);

  if (!token) return <Missing text="That is not a valid coin address." />;
  if (isLoading) return <div className="card mt-4 h-[480px] animate-pulse" />;
  // A failed read is a network problem, not proof the coin doesn't exist.
  if (!t && isError) return <Missing text="Couldn't load this coin right now. Retrying…" />;
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
        <div className="flex animate-pop flex-col gap-3 rounded-3xl border-2 border-outline bg-lime px-5 py-3 text-[15px] font-semibold text-[#1d1d1f] shadow-sticker sm:flex-row sm:items-center">
          <span className="flex-1">🎉 ${t.symbol} is live. Share it: every trade pays your X accounts.</span>
          <ShareButton t={t} className="!border-outline !bg-white" />
        </div>
      ) : null}

      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <TokenAvatar src={meta.image} seed={t.token} size={76} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5">
            <h1 className="font-display text-[30px] font-bold tracking-tight">{t.name}</h1>
            <span className="text-[17px] font-semibold text-ink-2">${t.symbol}</span>
            {t.market.graduated ? <span className="chip !bg-up-soft !text-up-ink">Graduated</span> : null}
            <ShareButton t={t} className="ml-auto" />
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
          {trades.isError && !trades.data ? (
            <p className="card p-4 text-[14px] font-medium text-down-ink">Couldn&apos;t load this coin&apos;s trades right now. Retrying…</p>
          ) : null}
          <PriceChart trades={trades.data} loading={trades.isLoading || (trades.isError && !trades.data)} total={t.tradeCount} />
          <TradesTable trades={trades.data} total={t.tradeCount} symbol={t.symbol} me={address} />
          {meta.description ? (
            <div className="card p-5">
              <h2 className="text-[17px] font-semibold">About</h2>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{meta.description}</p>
            </div>
          ) : null}
        </div>

        <aside className="order-first space-y-5 lg:sticky lg:top-20 lg:order-none lg:self-start">
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

          <SplitCard t={t} />
        </aside>
      </div>
    </div>
  );
}

/** Opens an X post with the coin, its fee split and a link that unfurls into the coin's card. */
function ShareButton({
  t,
  className = "",
}: {
  t: { name: string; symbol: string; handles: readonly string[]; xIds: readonly bigint[]; token: string };
  className?: string;
}) {
  const checks = useHandleChecks(t.handles, t.xIds);
  function share() {
    // @-mention only usernames confirmed to still belong to the fee recipient; a renamed account's
    // old name may now be someone else's, so it is written without the @.
    const who = checks.map((c) => (c.status === "current" ? `@${c.handle}` : c.handle)).join(" ");
    const text = `${t.name} ($${t.symbol}) on PonSplit: every trade splits fees to ${who}`;
    const url = `${location.origin}/token/${t.token}`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener,noreferrer");
  }
  return (
    <button className={`btn-secondary px-3.5 py-1.5 text-[13px] ${className}`} onClick={share}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" />
      </svg>
      Share
    </button>
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
