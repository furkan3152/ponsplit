"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatEther, isAddress } from "viem";
import { EmptyState } from "@/components/EmptyState";
import { HowItWorks } from "@/components/HowItWorks";
import { KingCard } from "@/components/KingCard";
import { TokenCard } from "@/components/TokenCard";
import { SplitMachine } from "@/components/art";
import { CountUp, Reveal } from "@/components/motion";
import { activeChain } from "@/lib/chains";
import { compact } from "@/lib/format";
import { useAllTokens, useGlobalStats, useNow } from "@/lib/hooks";
import { describe } from "@/lib/market";
import type { TokenView } from "@/lib/types";

const SORTS = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "mcap", label: "Market cap" },
  { key: "graduated", label: "Graduated" },
] as const;
type Sort = (typeof SORTS)[number]["key"];

function sortTokens(list: readonly TokenView[], sort: Sort): TokenView[] {
  const arr = [...list];
  switch (sort) {
    case "trending":
      return arr.sort((a, b) => Number(b.lastTradeAt) - Number(a.lastTradeAt));
    case "new":
      return arr.sort((a, b) => Number(b.market.createdAt) - Number(a.market.createdAt));
    case "mcap":
      return arr.sort((a, b) => describe(b).marketCap - describe(a).marketCap);
    case "graduated":
      return arr.filter((t) => t.market.graduated).sort((a, b) => describe(b).marketCap - describe(a).marketCap);
  }
}

export default function Home() {
  const [limit, setLimit] = useState(60);
  const { data: tokens, isLoading, error } = useAllTokens();
  const stats = useGlobalStats();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("trending");
  useNow(15_000);

  const king = useMemo(() => {
    const bonding = (tokens ?? []).filter((t) => !t.market.graduated && t.tradeCount > 0n);
    return bonding.sort((a, b) => describe(b).progress - describe(a).progress)[0];
  }, [tokens]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^[@$]/, "");
    const filtered = (tokens ?? []).filter(
      (t) => !q || t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q) || t.token.toLowerCase() === q || t.handles.some((h) => h.includes(q))
    );
    return sortTokens(filtered, sort);
  }, [tokens, query, sort]);
  const shown = list.slice(0, limit);
  const hasMore = list.length > limit;
  const addressQuery = isAddress(query.trim()) ? query.trim() : null;

  return (
    <div className="space-y-20">
      <section className="relative grid items-center gap-10 pt-2 md:grid-cols-[1.08fr_1fr] md:pt-10">
        <div aria-hidden className="bg-grid pointer-events-none absolute -inset-x-4 -top-10 -z-10 h-[560px] sm:-inset-x-6" />
        <div>
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" aria-hidden />
              Live on {activeChain.name}
            </span>
          </Reveal>
          <h1 className="display mt-6 text-[54px] leading-[0.9] sm:text-[86px]">
            <Reveal as="span" className="block" delay={60}>
              One coin.
            </Reveal>
            <Reveal as="span" className="block" delay={140}>
              Many X accounts.
            </Reveal>
            <Reveal as="span" className="block" delay={220}>
              Fees,{" "}
              <span className="accent text-neon relative inline-block pr-2">
                split.
                <svg aria-hidden viewBox="0 0 200 24" preserveAspectRatio="none" className="absolute -bottom-1 left-0 h-[0.28em] w-full overflow-visible">
                  <path
                    d="M3 16C40 5 78 21 116 10s62-4 81 3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={5}
                    strokeLinecap="round"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1}
                    className="animate-draw"
                    style={{ animationDelay: "900ms" }}
                  />
                </svg>
              </span>
            </Reveal>
          </h1>
          <Reveal delay={300}>
            <p className="mt-7 max-w-md text-[17px] leading-relaxed text-ink-2">
              Launch a coin and every trade pays the X accounts you choose, on the curve and after it graduates. They sign in with X and claim whenever they like.
            </p>
          </Reveal>
          <Reveal delay={380} className="mt-8 flex flex-wrap gap-3">
            <Link href="/create" className="btn-neon group/cta px-6 py-3.5 text-[16px]">
              Launch a coin
              <span aria-hidden className="transition-transform duration-300 group-hover/cta:translate-x-1">
                →
              </span>
            </Link>
            <Link href="/claim" className="btn-secondary px-6 py-3.5 text-[16px]">
              Claim my fees
            </Link>
          </Reveal>
          <Reveal delay={460}>
            <dl className="mt-10 grid max-w-md grid-cols-3 divide-x divide-[var(--line)] overflow-hidden rounded-2xl border border-line bg-card">
              <HeroStat label="Coins">
                <CountUp value={stats.coins !== undefined ? Number(stats.coins) : undefined} format={(n) => compact(Math.round(n))} />
              </HeroStat>
              <HeroStat label="Trades">
                <CountUp value={stats.trades !== undefined ? Number(stats.trades) : undefined} format={(n) => compact(Math.round(n))} />
              </HeroStat>
              <HeroStat label="Fees split">
                <CountUp value={stats.feesSplit !== undefined ? Number(formatEther(stats.feesSplit)) : undefined} format={(n) => `${n.toFixed(3)} Ξ`} />
              </HeroStat>
            </dl>
          </Reveal>
        </div>
        <Reveal delay={200}>
          <SplitMachine className="mx-auto w-full max-w-[560px]" />
        </Reveal>
      </section>

      {king ? (
        <Reveal as="section">
          <KingCard key={king.token} t={king} />
        </Reveal>
      ) : null}

      <section className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div>
            <div className="eyebrow">The board</div>
            <h2 className="display mt-1 text-[40px] leading-none">Explore</h2>
          </div>
          <div className="segmented no-scrollbar max-w-full overflow-x-auto sm:ml-6">
            {SORTS.map((s) => (
              <button key={s.key} data-active={sort === s.key} onClick={() => setSort(s.key)} className="whitespace-nowrap">
                {s.label}
              </button>
            ))}
          </div>
          <input
            className="input !rounded-full !py-2.5 sm:ml-auto sm:max-w-[280px]"
            placeholder="Search coin, $ticker, @account"
            aria-label="Search coins"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {error && !tokens ? (
          <div className="card p-6 text-[14px] text-down-ink">Could not load coins: {error.message.split("\n")[0]}</div>
        ) : isLoading ? (
          <Grid>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="card h-[190px] animate-pulse" />
            ))}
          </Grid>
        ) : list.length === 0 ? (
          <EmptyState title={tokens?.length ? (sort === "graduated" && !query ? "No coin has graduated yet." : "Nothing matches that.") : "No coins yet."}>
            {addressQuery ? (
              <Link href={`/token/${addressQuery}`} className="font-medium text-ink underline">
                Open {addressQuery.slice(0, 6)}…{addressQuery.slice(-4)}
              </Link>
            ) : (
              <Link href="/create" className="font-medium text-ink underline">
                {tokens?.length ? "Launch a coin" : "Launch the first one"}
              </Link>
            )}
          </EmptyState>
        ) : (
          <>
            <Grid>
              {shown.map((t, i) => (
                <Reveal key={t.token} delay={Math.min(i, 8) * 50}>
                  <TokenCard t={t} />
                </Reveal>
              ))}
            </Grid>
            {hasMore ? (
              <div className="text-center">
                <button className="btn-secondary" onClick={() => setLimit((l) => l + 60)}>
                  Show more
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="eyebrow">Three steps</div>
            <h2 className="display mt-1 text-[40px] leading-none">How it works</h2>
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

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function HeroStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-3.5 sm:px-4">
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-1.5 truncate text-[16px] font-semibold tracking-tight sm:text-[20px]">{children}</dd>
    </div>
  );
}
