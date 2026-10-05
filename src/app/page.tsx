"use client";

import Link from "next/link";
import { useMemo } from "react";
import { HowItWorks } from "@/components/HowItWorks";
import { TokenCard } from "@/components/TokenCard";
import { CornerConfetti, HeadingDoodle, HeroDoodles } from "@/components/art/Doodles";
import { SplitMachine, type MachineAccount } from "@/components/art/SplitMachine";
import { CoinStrip, EarnedTotal, FeePath, Leaderboard, Panel, TopEarners } from "@/components/home/Bento";
import { OfficialToken } from "@/components/home/Official";
import { ArrowIcon } from "@/components/icons";
import { Reveal } from "@/components/motion";
import { useNow, useSnapshot } from "@/lib/hooks";
import { PLATFORM_BPS, isLive } from "@/lib/solana/config";
import { sortCoins } from "@/lib/sort-coins";

/**
 * The hero's split always shows the same example set of well-known GitHub developers (their real
 * names and photos), clearly marked as an example: no coin is promoted on the home page.
 */
const EXAMPLE: { handle: string; pct: number }[] = [
  { handle: "torvalds", pct: 40 },
  { handle: "gaearon", pct: 25 },
  { handle: "sindresorhus", pct: 15 },
  { handle: "yyx990803", pct: 10 },
  { handle: "tj", pct: 10 },
];

export default function Home() {
  const live = isLive();
  const snap = useSnapshot();
  const coins = snap.data?.coins;
  useNow(15_000);

  const trending = useMemo(() => sortCoins(coins ?? [], "trending"), [coins]);
  const graduating = useMemo(() => [...(coins ?? [])].sort((a, b) => Number(b.graduated) - Number(a.graduated) || b.progress - a.progress), [coins]);
  const machine: MachineAccount[] = EXAMPLE.map((e) => ({ ...e, image: `https://github.com/${e.handle}.png?size=100` }));
  const platformPct = PLATFORM_BPS / 100;
  const loading = snap.isLoading && live;

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="relative pt-6 text-center md:pt-12">
        <div aria-hidden className="bg-grid pointer-events-none absolute -inset-x-4 -top-10 -z-10 h-[520px] sm:-inset-x-6" />
        <HeroDoodles />
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" aria-hidden />
            {live ? "Live" : "Coming soon"} on Solana · pump.fun
          </span>
        </Reveal>
        <h1 className="display mx-auto mt-6 max-w-[900px] text-[46px] leading-[0.95] sm:text-[76px]">
          <Reveal as="span" className="block" delay={60}>
            Coins that pay
          </Reveal>
          <Reveal as="span" className="block" delay={140}>
            <span className="accent text-neon">GitHub</span> devs
          </Reveal>
        </h1>
        <Reveal delay={240}>
          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-ink-2">
            Launch a coin on{" "}
            <span className="inline-flex translate-y-[-1px] items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-0.5 align-middle text-[14px] font-semibold text-ink">
              <span className="h-2 w-2 rounded-full bg-up" aria-hidden />
              pump.fun
            </span>{" "}
            and every trade&apos;s creator fee is split, for good, between up to nine GitHub developers. They sign in with GitHub and claim in SOL.
          </p>
        </Reveal>
        <Reveal delay={320} className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/create" className="btn-primary px-6 py-3.5 text-[16px]">
            Launch a coin
          </Link>
          <Link href="/how" className="btn-secondary px-6 py-3.5 text-[16px]">
            How it works
          </Link>
        </Reveal>
        <Reveal delay={400} className="mt-10 px-0 sm:px-4">
          <OfficialToken />
        </Reveal>
      </section>

      {/* Bento */}
      {/* min-w-0: a loading coin strip must not widen the page on phones */}
      <section className="grid gap-4 lg:grid-cols-12 [&>*]:min-w-0">
        <Reveal className="lg:col-span-7">
          <Panel label="Explore" href="/explore" className="h-full">
            <CoinStrip coins={trending.slice(0, 8)} loading={loading} />
          </Panel>
        </Reveal>
        <Reveal className="lg:col-span-5" delay={80}>
          <Panel label="Closest to graduating" href="/explore" className="h-full">
            <Leaderboard coins={graduating} loading={loading} />
          </Panel>
        </Reveal>
        <Reveal className="lg:col-span-4" delay={60}>
          <Panel label="Fees" className="h-full">
            <EarnedTotal earners={snap.data?.earners} coins={coins?.length} />
          </Panel>
        </Reveal>
        <Reveal className="lg:col-span-4" delay={120}>
          <Panel label="Top developers" href="/claim" className="h-full">
            <TopEarners earners={snap.data?.earners ?? []} />
          </Panel>
        </Reveal>
        <Reveal className="lg:col-span-4" delay={180}>
          <Panel label="Under the hood" href="/how" className="h-full">
            <FeePath platformPct={platformPct} />
          </Panel>
        </Reveal>
      </section>

      {/* The split, live */}
      <section className="card relative grid items-center gap-6 overflow-hidden p-6 md:grid-cols-[1fr_1.2fr] md:p-10">
        <CornerConfetti className="hidden sm:block" />
        <div>
          <div className="eyebrow">Example split</div>
          <h2 className="display mt-2 text-[36px] leading-[1.02] sm:text-[44px]">One coin, many devs</h2>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-2">
            This is how a split looks: pick any GitHub developers, set their shares, and each trade&apos;s creator fee flows to them. These
            developers are only an example; no coin pays them unless someone launches one for them.
          </p>
          <Link href="/create" className="btn-secondary group/l mt-6 px-5 py-3 text-[15px]">
            Launch yours
            <ArrowIcon size={16} className="transition-transform group-hover/l:translate-x-0.5" />
          </Link>
        </div>
        <SplitMachine className="mx-auto w-full max-w-[560px]" accounts={machine} caption="EXAMPLE SPLIT" />
      </section>

      {/* Trending */}
      {trending.length ? (
        <section className="space-y-6">
          <div className="flex items-end justify-between">
            <div>
              <div className="eyebrow">Right now</div>
              <h2 className="display mt-1 flex items-center gap-2 text-[36px] leading-none">
                Trending <HeadingDoodle kind="star" />
              </h2>
            </div>
            <Link href="/explore" className="text-[14px] font-medium text-ink-2 transition hover:text-ink">
              See all →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {trending.slice(0, 6).map((t, i) => (
              <Reveal key={t.token} delay={Math.min(i, 6) * 50}>
                <TokenCard t={t} />
              </Reveal>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="eyebrow">Three steps</div>
            <h2 className="display mt-1 flex items-center gap-2 text-[36px] leading-none">
              How it works <HeadingDoodle kind="sparkle" />
            </h2>
          </div>
          <Link href="/how" className="text-[14px] font-medium text-ink-2 transition hover:text-ink">
            Details →
          </Link>
        </div>
        <HowItWorks />
      </section>
    </div>
  );
}
