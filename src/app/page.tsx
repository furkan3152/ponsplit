"use client";

import Link from "next/link";
import { useMemo } from "react";
import { HowItWorks } from "@/components/HowItWorks";
import { TokenCard } from "@/components/TokenCard";
import { CornerConfetti, HeadingDoodle, HeroDoodles } from "@/components/art/Doodles";
import { SplitMachine, type MachineAccount } from "@/components/art/SplitMachine";
import { CoinStrip, FeePath, Panel, PayoutFeed, SplitTotal, TopEarners } from "@/components/home/Bento";
import { ArrowIcon } from "@/components/icons";
import { Reveal } from "@/components/motion";
import { useActivity, useCoins, useDescriptions, useGlobalStats, useLaunchTerms, useNow, usePayouts, useTopEarners, useXProfiles } from "@/lib/hooks";
import { useNetwork } from "@/lib/network-context";
import { isLive } from "@/lib/networks";
import { sortCoins } from "@/lib/sort-coins";

/**
 * Before any coin has earned anything, the hero shows how a split looks with real, well-known
 * X accounts (their real names and photos), clearly marked as an example.
 */
const EXAMPLE: { handle: string; pct: number }[] = [
  { handle: "jack", pct: 40 },
  { handle: "VitalikButerin", pct: 25 },
  { handle: "naval", pct: 15 },
  { handle: "RobinhoodApp", pct: 10 },
  { handle: "x", pct: 10 },
];

export default function Home() {
  const n = useNetwork();
  const { data: coins, isLoading } = useCoins();
  const activity = useActivity();
  const stats = useGlobalStats();
  const payouts = usePayouts();
  const earners = useTopEarners(4);
  const terms = useLaunchTerms();
  useNow(15_000);

  const trending = useMemo(() => sortCoins(coins ?? [], "trending", activity.data?.tradesByToken), [coins, activity.data]);
  const volume24h = useMemo(() => {
    if (!isLive(n)) return 0n;
    if (!activity.data) return undefined;
    let v = 0n;
    for (const x of activity.data.volumeByToken.values()) v += x;
    return v;
  }, [activity.data, n]);

  // The split diagram is always the same example set of well-known accounts (the owner's call): no
  // coin is promoted on the home page. Their real names and photos, clearly labelled as an example.
  const profiles = useXProfiles(EXAMPLE.map((e) => e.handle));
  const machine: MachineAccount[] = EXAMPLE.map((e) => ({ ...e, image: profiles.data?.[e.handle]?.image }));

  const descriptions = useDescriptions(useMemo(() => trending.slice(0, 6).map((t) => t.token), [trending]));
  const platformPct = (terms.data?.platformShareBps ?? 2000) / 100;

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="relative pt-6 text-center md:pt-12">
        <div aria-hidden className="bg-grid pointer-events-none absolute -inset-x-4 -top-10 -z-10 h-[520px] sm:-inset-x-6" />
        <HeroDoodles />
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" aria-hidden />
            {isLive(n) ? (n.isTestnet ? "Testnet" : "Live") : "Coming soon"} on {n.chain.name}
          </span>
        </Reveal>
        <h1 className="display mx-auto mt-6 max-w-[900px] text-[46px] leading-[0.95] sm:text-[76px]">
          <Reveal as="span" className="block" delay={60}>
            Route coin fees
          </Reveal>
          <Reveal as="span" className="block" delay={140}>
            to <span className="accent text-neon">X</span> accounts
          </Reveal>
        </h1>
        <Reveal delay={240}>
          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-ink-2">
            Launch a coin on{" "}
            <span className="inline-flex translate-y-[-1px] items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-0.5 align-middle text-[14px] font-semibold text-ink">
              <span className="h-2 w-2 rounded-full bg-up" aria-hidden />
              pons
            </span>{" "}
            and every trade&apos;s creator fee is split between up to ten X accounts. They prove the account is theirs and claim in ETH.
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
      </section>

      {/* Bento */}
      {/* min-w-0: a loading coin strip must not widen the page on phones */}
      <section className="grid gap-4 lg:grid-cols-12 [&>*]:min-w-0">
        <Reveal className="lg:col-span-7">
          <Panel label="Explore" href="/explore" className="h-full">
            <CoinStrip coins={trending.slice(0, 8)} loading={isLoading && isLive(n)} />
          </Panel>
        </Reveal>
        <Reveal className="lg:col-span-5" delay={80}>
          <Panel label="Payouts" href="/claim" className="h-full">
            <PayoutFeed n={n} payouts={payouts.data?.latest ?? []} loading={payouts.isLoading && isLive(n)} />
          </Panel>
        </Reveal>
        <Reveal className="lg:col-span-4" delay={60}>
          <Panel label="Fees" className="h-full">
            <SplitTotal split={stats.feesSplit} coins={stats.coins} volume24h={volume24h} />
          </Panel>
        </Reveal>
        <Reveal className="lg:col-span-4" delay={120}>
          <Panel label="Top accounts" href="/explore" className="h-full">
            <TopEarners earners={earners} />
          </Panel>
        </Reveal>
        <Reveal className="lg:col-span-4" delay={180}>
          <Panel label="Under the hood" href="/how" className="h-full">
            <FeePath n={n} platformPct={platformPct} />
          </Panel>
        </Reveal>
      </section>

      {/* The split, live */}
      <section className="card relative grid items-center gap-6 overflow-hidden p-6 md:grid-cols-[1fr_1.2fr] md:p-10">
        <CornerConfetti className="hidden sm:block" />
        <div>
          <div className="eyebrow">Example split</div>
          <h2 className="display mt-2 text-[36px] leading-[1.02] sm:text-[44px]">One coin, many accounts</h2>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-2">
            This is how a split looks: pick any X accounts, set their shares, and each trade&apos;s creator fee flows to them. These
            accounts are only an example; no coin pays them unless someone launches one for them.
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
                <TokenCard t={t} description={descriptions?.get(t.token.toLowerCase())} />
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
