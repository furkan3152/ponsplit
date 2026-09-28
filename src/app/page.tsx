"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { isAddress } from "viem";
import { EmptyState } from "@/components/EmptyState";
import { HowItWorks } from "@/components/HowItWorks";
import { KingCard } from "@/components/KingCard";
import { TokenCard } from "@/components/TokenCard";
import { HeroArt } from "@/components/art";
import { activeChain } from "@/lib/chains";
import { compact, formatEth } from "@/lib/format";
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
    <div className="space-y-14">
      <section className="grid items-center gap-8 pt-6 md:grid-cols-[1.05fr_1fr] md:pt-12">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-[12px] font-medium text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-up" /> Live on {activeChain.name}
          </span>
          <h1 className="mt-5 font-display text-[44px] font-bold leading-[1.02] tracking-[-0.035em] sm:text-[64px]">
            One coin.
            <br />
            Many X accounts.
            <br />
            <span className="relative inline-block">
              <span className="relative z-10">Fees, split.</span>
              <span className="absolute inset-x-[-4px] bottom-1 z-0 h-[0.38em] -rotate-1 rounded-md bg-lime" aria-hidden />
            </span>
          </h1>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-ink-2">
            Launch a coin and every trade pays the X accounts you choose, on the curve and after it graduates. They sign in with X and claim whenever they like.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/create" className="btn-sticker px-6 py-3 text-[16px]">
              Launch a coin
            </Link>
            <Link href="/claim" className="btn-secondary px-6 py-3 text-[16px]">
              Claim my fees
            </Link>
          </div>
          <dl className="mt-8 flex gap-8">
            <HeroStat label="Coins" value={stats.coins !== undefined ? compact(Number(stats.coins)) : "–"} />
            <HeroStat label="Trades" value={stats.trades !== undefined ? compact(Number(stats.trades)) : "–"} />
            <HeroStat label="Fees split" value={stats.feesSplit !== undefined ? `${formatEth(stats.feesSplit, 3)} Ξ` : "–"} />
          </dl>
        </div>
        <HeroArt className="mx-auto w-full max-w-[560px] animate-float motion-reduce:animate-none" />
      </section>

      {king ? (
        <section>
          <KingCard key={king.token} t={king} />
        </section>
      ) : null}

      <section className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <h2 className="font-display text-[28px] font-bold tracking-tight">Explore</h2>
          <div className="segmented no-scrollbar max-w-full overflow-x-auto sm:ml-4">
            {SORTS.map((s) => (
              <button key={s.key} data-active={sort === s.key} onClick={() => setSort(s.key)} className="whitespace-nowrap">
                {s.label}
              </button>
            ))}
          </div>
          <input
            className="input !rounded-full !py-2 sm:ml-auto sm:max-w-[260px]"
            placeholder="Search coin, $ticker, @account"
            aria-label="Search coins"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {error ? (
          <div className="card p-6 text-[14px] text-down-ink">Could not load coins: {error.message.split("\n")[0]}</div>
        ) : isLoading ? (
          <Grid>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="card h-[150px] animate-pulse" />
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
              {shown.map((t) => (
                <TokenCard key={t.token} t={t} />
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

      <section className="space-y-5">
        <div className="flex items-end justify-between">
          <h2 className="font-display text-[28px] font-bold tracking-tight">How it works</h2>
          <Link href="/how" className="text-[14px] font-medium text-ink-2 hover:text-ink">
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

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] font-medium text-ink-2">{label}</dt>
      <dd className="num text-[22px] font-semibold tracking-tight">{value}</dd>
    </div>
  );
}
