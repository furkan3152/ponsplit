"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TokenCard } from "@/components/TokenCard";
import { ArrowIcon, ClaimIcon, ExploreIcon, ShieldIcon, WalletIcon } from "@/components/icons";
import { LogoMark } from "@/components/art/Logo";
import { useNow, useSnapshot } from "@/lib/hooks";
import { sortCoins } from "@/lib/sort-coins";
import { isTikTokLaunchReady } from "@/lib/tiktok-config";

export default function Home() {
  const ready = isTikTokLaunchReady();
  const snapshot = useSnapshot();
  const [sort, setSort] = useState<"trending" | "new">("trending");
  useNow(15_000);
  const coins = snapshot.data?.coins;
  const sorted = useMemo(() => sortCoins(coins ?? [], sort), [coins, sort]);
  const hasData = ready && Boolean(snapshot.data) && !snapshot.isError;
  const creators = useMemo(() => new Set((coins ?? []).flatMap((coin) => coin.recipients.map((r) => r.handle))).size, [coins]);
  const stats = [
    { label: "Creator coins", value: coins?.length },
    { label: "Creators named", value: creators },
    { label: "Graduated coins", value: coins?.filter((coin) => coin.graduated).length },
  ];

  return (
    <div className="space-y-12 sm:space-y-16">
      <section className="home-hero grid items-center gap-10 pb-1 pt-5 lg:grid-cols-[1.08fr_1fr] lg:gap-8 lg:pt-10">
        <div className="relative z-10">
          <div className="mb-7 flex flex-wrap items-center gap-2.5">
            <span className="network-pill"><span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />Solana mainnet</span>
            <span className="text-[12px] text-ink-3">Powered by pump.fun</span>
          </div>
          <p className="eyebrow mb-4">For the people behind the feed</p>
          <h1 className="display max-w-[620px] text-[clamp(44px,5.25vw,76px)] leading-[1.02] tracking-[-0.055em]">
            Turn attention<br />into creator<br /><span className="text-neon">earnings.</span>
          </h1>
          <p className="mt-6 max-w-[460px] text-[16px] leading-[1.75] text-ink-2 sm:text-[17px]">
            Launch a coin for a TikTok creator. Route its pump.fun creator fees to their escrow. They verify their account and claim in SOL.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/create" className="btn-primary px-5 py-3.5">Launch a creator coin <ArrowIcon size={17} /></Link>
            <Link href="/claim" className="btn-secondary px-5 py-3.5">Claim your earnings</Link>
          </div>
          <div className="mt-5 flex items-center gap-2 text-[12px] text-ink-3">
            <ShieldIcon size={15} /><span>Account ownership verified with TikTok</span>
          </div>
        </div>
        <FeeFlow />
      </section>

      {!ready ? (
        <div className="flex flex-col gap-3 border-l-2 border-[var(--coral)] bg-card px-5 py-4 text-[13px] leading-relaxed sm:flex-row sm:items-center sm:justify-between">
          <div><span className="font-semibold text-ink">Mainnet launch is in preparation.</span><span className="ml-1 text-ink-2">Creator escrow and the verification service must be configured before launch or claim transactions are enabled.</span></div>
          <Link href="/docs" className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-neon">View setup <ArrowIcon size={15} /></Link>
        </div>
      ) : null}

      <section aria-label="On-chain activity" className="grid grid-cols-3 divide-x divide-line border-y border-line py-6">
        {stats.map((stat) => (
          <div key={stat.label} className="px-3 first:pl-0 sm:px-6">
            <div className="num text-[30px] font-medium leading-none sm:text-[38px]">{hasData ? stat.value ?? 0 : "—"}</div>
            <div className="mt-2 text-[11px] text-ink-2 sm:text-[13px]">{stat.label}</div>
          </div>
        ))}
      </section>

      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">Discover the creator economy</p>
            <h2 className="display text-[28px] sm:text-[34px]">Creator coins<span className="text-[var(--coral)]">.</span></h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="segmented" aria-label="Sort coins">
              <button type="button" data-active={sort === "trending"} onClick={() => setSort("trending")}>Trending</button>
              <button type="button" data-active={sort === "new"} onClick={() => setSort("new")}>Newest</button>
            </div>
            <Link href="/explore" className="hidden items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink sm:inline-flex">View all <ArrowIcon size={16} /></Link>
          </div>
        </div>
        {!ready ? (
          <DiscoveryEmpty title="A new stage for creators" description="Creator coins will appear here after the mainnet escrow is configured and the first coin is launched." />
        ) : snapshot.isError ? (
          <div role="alert" className="card flex flex-col items-center px-6 py-12 text-center">
            <ExploreIcon size={30} className="mb-4 text-ink-3" />
            <h3 className="display text-xl">On-chain data is unavailable</h3>
            <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-2">The Solana connection could not load creator coins. Activity totals are unavailable until the connection recovers.</p>
            <button type="button" className="btn-secondary mt-5 text-[13px]" disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()}>{snapshot.isFetching ? "Reconnecting…" : "Try again"}</button>
          </div>
        ) : snapshot.isLoading ? (
          <div aria-label="Loading creator coins" role="status" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="card h-[244px] animate-pulse bg-card-2" />)}
          </div>
        ) : sorted.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{sorted.slice(0, 6).map((coin) => <TokenCard key={coin.token} t={coin} />)}</div>
        ) : (
          <DiscoveryEmpty title="The first creator coin starts with you" description="No Tiksplit creator coins have been found on Solana mainnet. Choose a TikTok handle to launch the first one." />
        )}
        <Link href="/explore" className="mt-4 inline-flex items-center gap-2 text-[13px] font-semibold text-neon sm:hidden">Explore creator coins <ArrowIcon size={16} /></Link>
        <p aria-live="polite" className="mt-3 text-[11px] text-ink-3">{!ready ? "Discovery is awaiting mainnet setup." : snapshot.isError ? "Connection interrupted. No activity totals are displayed." : "On-chain discovery · refreshed every 10 seconds"}</p>
      </section>

      <section className="border-t border-line pt-10">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div><p className="eyebrow mb-2">From the feed to your wallet</p><h2 className="display text-[28px] sm:text-[34px]">Creator fees. A clear path.</h2></div>
          <Link href="/how" className="inline-flex items-center gap-2 text-[13px] font-medium text-neon">How it works <ArrowIcon size={16} /></Link>
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            { step: "01", title: "Launch for a creator", text: "Choose a TikTok handle and launch a coin on pump.fun. The creator fee allocation is set on chain.", Icon: ExploreIcon },
            { step: "02", title: "Fees find their owner", text: "Trading activity can generate creator fees. The creator’s allocation accrues in escrow, even before they verify.", Icon: ClaimIcon },
            { step: "03", title: "Verify. Claim. Create.", text: "The creator verifies TikTok account ownership, links a Solana wallet and claims available fees in SOL.", Icon: WalletIcon },
          ].map(({ step, title, text, Icon }) => (
            <div key={step} className="border-t border-line-2 pt-5">
              <div className="mb-5 flex items-center justify-between"><span className="num text-[12px] text-ink-3">{step}</span><Icon size={22} className="text-lime" /></div>
              <h3 className="display text-[19px]">{title}</h3>
              <p className="mt-2.5 text-[14px] leading-[1.75] text-ink-2">{text}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-2xl text-[12px] leading-relaxed text-ink-3">Earnings depend on actual trading activity and are not guaranteed. Holding a coin does not grant ownership of a TikTok account or its content.</p>
      </section>

      <section className="creator-callout flex flex-col gap-6 p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
        <div><p className="eyebrow mb-2">Made something people love?</p><h2 className="display text-[26px] sm:text-[32px]">Your creativity. Your share.</h2><p className="mt-2 text-[14px] text-ink-2">Find coins that name your TikTok account and check your creator fees.</p></div>
        <Link href="/claim" className="btn-primary shrink-0 self-start px-5 py-3 md:self-auto">Find my earnings <ArrowIcon size={17} /></Link>
      </section>
    </div>
  );
}

function DiscoveryEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="card discovery-empty relative flex min-h-[250px] flex-col items-center justify-center overflow-hidden px-6 py-10 text-center">
      <div className="mb-5 grid h-14 w-14 place-items-center rounded-xl border border-line-2 bg-paper"><LogoMark size={34} /></div>
      <h3 className="display text-[21px]">{title}</h3>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-2">{description}</p>
      <Link href="/create" className="mt-5 inline-flex items-center gap-2 text-[13px] font-semibold text-neon">Build your launch <ArrowIcon size={16} /></Link>
    </div>
  );
}

/** A conceptual fee path, with no token, profile, balance or activity represented as live data. */
function FeeFlow() {
  return (
    <div className="fee-flow relative overflow-hidden rounded-2xl border border-line-2 bg-card p-5 sm:p-7">
      <div className="flex items-center justify-between gap-3"><span className="eyebrow">Illustrated fee flow</span><span className="num text-[10px] text-ink-3">ATTENTION → SOL</span></div>
      <div className="creator-stage relative my-6 flex min-h-[210px] items-center justify-center overflow-hidden rounded-xl bg-paper">
        <div aria-hidden className="stage-orbit stage-orbit-outer" /><div aria-hidden className="stage-orbit stage-orbit-inner" />
        <div aria-hidden className="stage-line" />
        <div className="relative z-10 flex items-center gap-5 sm:gap-7">
          <div className="stage-logo grid h-[92px] w-[92px] place-items-center rounded-[22px] border border-line-2 bg-card sm:h-[110px] sm:w-[110px]"><LogoMark size={66} /></div>
          <div><span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3">TikTok creators</span><p className="display mt-2 text-[27px] leading-[1.12] sm:text-[33px]">Create culture.<br />Receive a share.</p></div>
        </div>
        <span className="absolute bottom-3 left-4 h-1 w-10 bg-lime" aria-hidden /><span className="absolute right-4 top-3 h-1 w-6 bg-[var(--coral)]" aria-hidden />
      </div>
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-card-2"><ExploreIcon size={19} className="text-ink-2" /></div><div className="min-w-0"><div className="text-[14px] font-semibold">pump.fun trading</div><div className="text-[12px] text-ink-3">Actual trades generate creator fees</div></div><span className="ml-auto num text-[11px] text-ink-3">01</span></div>
      <div className="flow-connector" aria-hidden />
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[var(--cyan-line)] bg-lime-soft"><ClaimIcon size={19} className="text-lime" /></div><div className="min-w-0"><div className="text-[14px] font-semibold">Creator escrow</div><div className="text-[12px] text-ink-3">Accrues before account verification</div></div><span className="ml-auto num text-[11px] text-lime">02</span></div>
      <div className="flow-connector" aria-hidden />
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-card-2"><WalletIcon size={19} className="text-[var(--coral)]" /></div><div className="min-w-0"><div className="text-[14px] font-semibold">The creator’s SOL wallet</div><div className="text-[12px] text-ink-3">Verify TikTok ownership to claim</div></div><span className="ml-auto num text-[11px] text-ink-3">03</span></div>
    </div>
  );
}
