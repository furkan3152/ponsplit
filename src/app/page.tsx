"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TokenCard } from "@/components/TokenCard";
import { ArrowIcon, ExploreIcon } from "@/components/icons";
import { CreatorReel } from "@/components/art/CreatorReel";
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
    <div className="editorial-home">
      <div className="issue-line"><span className="edition-label">The creator edition</span><span className="flex items-center gap-2 text-[10px] text-ink-3"><span className="h-1.5 w-1.5 bg-lime" aria-hidden />Solana mainnet <span className="px-1 text-ink-3" aria-hidden>/</span> pump.fun</span></div>
      <section className="editorial-hero">
        <div className="hero-copy">
          <p className="hero-kicker"><span aria-hidden className="mr-2 inline-block h-2 w-2 bg-[var(--coral)]" />For the people behind the feed</p>
          <h1 className="editorial hero-headline"><span>Make culture.</span><span>Make a coin.</span><span className="headline-share">Share the fees<span className="text-[var(--coral)]">.</span></span></h1>
          <p className="hero-description">Your favourite TikTok creator brings the ideas. You bring the coin. Their share of pump.fun creator fees collects in escrow while they prove ownership with a video and activate their approved wallet.</p>
          <div className="hero-actions"><Link href="/create" className="btn-primary py-3.5">Launch a creator coin <ArrowIcon size={19} /></Link><Link href="/claim" className="text-link">Claim your earnings <ArrowIcon size={15} className="arrow-diagonal" /></Link></div>
          <p className="hero-footnote"><span className="num mr-2 text-[var(--coral)]" aria-hidden>↳</span>Video proof. Manual review. Approved wallet claims in SOL.</p>
        </div>
        <figure className="hero-art"><CreatorReel className="creator-reel" /><figcaption><span className="edition-label">Create / trade / claim</span><span>Illustration. No live balances.</span></figcaption></figure>
      </section>

      <div className="editorial-tape" aria-hidden><span>Behind every feed</span><LogoMark size={26} /><span>There&apos;s a creator</span><svg viewBox="0 0 52 28" width="42" height="24" fill="none"><path d="M1 14h48M36 2l13 12-13 12" stroke="currentColor" strokeWidth="3" /></svg></div>

      {!ready ? <div className="setup-note"><span className="setup-stamp">In preparation</span><div><span className="font-semibold text-ink">Mainnet launch is in preparation.</span><p className="mt-1 text-ink-2">Creator escrow and on-chain video verification must be configured before launch or claim transactions are enabled.</p></div><Link href="/docs" className="text-link shrink-0">View setup <ArrowIcon size={15} /></Link></div> : null}

      <section className="creator-index">
        <div className="section-topline"><span className="edition-label">01 / The creator index</span><span className="text-[10px] text-ink-3">Real coins. Read from Solana.</span></div>
        <div className="index-heading"><h2 className="editorial">The next<br /><span className="outline-type">big thing.</span></h2><section aria-label="On-chain activity" className="index-stats">{stats.map((stat) => <div key={stat.label}><div className="num text-[25px] leading-none sm:text-[30px]">{hasData ? stat.value ?? 0 : "—"}</div><div className="mt-2 text-[10px] text-ink-3">{stat.label}</div></div>)}</section></div>
        <div className="index-toolbar"><div className="segmented" aria-label="Sort coins"><button type="button" data-active={sort === "trending"} onClick={() => setSort("trending")}>Trending</button><button type="button" data-active={sort === "new"} onClick={() => setSort("new")}>Newest</button></div><Link href="/explore" className="text-link">Explore all <ArrowIcon size={16} /></Link></div>
        {!ready ? <DiscoveryEmpty title="The first frame is still open." description="Creator coins will appear here after the mainnet escrow is configured and the first coin is launched." /> : snapshot.isError ? <div role="alert" className="cut-frame px-6 py-12"><ExploreIcon size={28} className="mb-4 text-[var(--coral)]" /><h3 className="editorial text-[36px]">The connection needs a retake.</h3><p className="mt-3 max-w-md text-[14px] leading-relaxed text-ink-2">Solana data could not be loaded. Coin listings and activity totals are unavailable until the connection recovers.</p><button type="button" className="btn-secondary mt-5 text-[13px]" disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()}>{snapshot.isFetching ? "Reconnecting…" : "Try again"}</button></div> : snapshot.isLoading ? <div aria-label="Loading creator coins" role="status" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="card h-[244px] animate-pulse bg-card-2" />)}</div> : sorted.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{sorted.slice(0, 6).map((coin) => <TokenCard key={coin.token} t={coin} />)}</div> : <DiscoveryEmpty title="A creator. A community. The first coin." description="No Tiksplit creator coins have been found on Solana mainnet. Choose a TikTok handle to launch the first one." />}
        <p aria-live="polite" className="mt-4 font-mono text-[10px] text-ink-3">{!ready ? "Discovery is awaiting mainnet setup." : snapshot.isError ? "Connection interrupted. Activity totals unavailable." : "On-chain discovery / refreshed every 10 seconds"}</p>
      </section>

      <section className="fee-story">
        <div className="fee-story-intro"><span className="edition-label">02 / Follow the fees</span><h2 className="editorial">From the<br />feed to<br /><span className="text-neon">the wallet.</span></h2><p className="text-[14px] leading-relaxed text-ink-2">A clear path for the creator&apos;s share. Nothing is paid out just for having a username.</p><Link href="/how" className="text-link mt-6">The full story <ArrowIcon size={17} /></Link><span className="fee-story-mark" aria-hidden><LogoMark size={92} /></span></div>
        <div className="fee-story-steps">{[{ step: "01", title: "Name your creator", tag: "The launch", text: "Choose a TikTok username and launch a coin on pump.fun. The fee split is set on chain and the creator does not need to verify first." }, { step: "02", title: "Give the fees a home", tag: "The escrow", text: "Actual trading activity can generate creator fees. The creator’s share accrues in escrow while ownership is being verified." }, { step: "03", title: "Post it. Prove it.", tag: "The payout", text: "The creator posts the full verification code in a public TikTok video caption and submits its original URL. After manual admin review, they activate their permanent wallet binding and claim available fees in SOL." }].map(({ step, title, tag, text }) => <div className="fee-story-step" key={step}><span className="editorial step-number">{step}</span><div><span className="edition-label">{tag}</span><h3 className="display mt-2 text-[22px] sm:text-[25px]">{title}</h3><p className="mt-3 text-[14px] leading-[1.8] text-ink-2">{text}</p></div><span className="step-cross" aria-hidden>+</span></div>)}<p className="fee-story-risk">Earnings depend on trading activity and are not guaranteed. A coin does not give its holders ownership of a TikTok account or its content.</p></div>
      </section>

      <section className="creator-invitation"><div><span className="edition-label">03 / For the creator</span><h2 className="editorial">Is that<br /><span className="text-neon">your handle?</span></h2></div><div className="invitation-copy"><p>Find the coins that name your TikTok account. Request your code, post a proof video and submit it for manual review before binding your wallet.</p><Link href="/claim" className="btn-primary mt-6 py-3.5">Find my earnings <ArrowIcon size={19} /></Link></div><svg className="invitation-arrow" viewBox="0 0 100 100" fill="none" aria-hidden><path d="M12 88 85 15M12 15h73v73" stroke="currentColor" strokeWidth="7" /></svg></section>
    </div>
  );
}

function DiscoveryEmpty({ title, description }: { title: string; description: string }) {
  return <div className="discovery-editorial"><div className="empty-reel" aria-hidden><div className="empty-reel-top"><span>9:16</span><ArrowIcon size={12} className="arrow-diagonal" /></div><div className="empty-reel-type editorial">Next<br />up<span>.</span></div><div className="empty-reel-bottom"><span className="empty-reel-bars" /><LogoMark size={30} /></div></div><div className="empty-reel-copy"><span className="edition-label">A space for your community</span><h3 className="display mt-4 text-[25px] leading-tight sm:text-[32px]">{title}</h3><p className="mt-4 max-w-md text-[14px] leading-relaxed text-ink-2">{description}</p><Link href="/create" className="text-link mt-6">Build your launch <ArrowIcon size={17} /></Link></div><span className="empty-registration" aria-hidden>+</span></div>;
}
