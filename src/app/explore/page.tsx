"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";
import { EmptyState } from "@/components/EmptyState";
import { KingCard } from "@/components/KingCard";
import { TokenCard } from "@/components/TokenCard";
import { Reveal } from "@/components/motion";
import { useActivity, useCoins, useDescriptions, useNow } from "@/lib/hooks";
import { sortCoins, SORTS, type Sort } from "@/lib/sort-coins";

export default function ExplorePage() {
  return (
    <Suspense>
      <Explore />
    </Suspense>
  );
}

/** Every coin on the network: sort, search (?q= from the top bar), and the coin closest to graduating. */
function Explore() {
  const params = useSearchParams();
  const [limit, setLimit] = useState(60);
  const coins = useCoins();
  const activity = useActivity();
  // This boundary hydrates after the rest of the page, and the shared snapshot can be back by then:
  // render what the server did (loading) until hydrated, so the two match.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const tokens = hydrated ? coins.data : undefined;
  const isLoading = !hydrated || coins.isLoading;
  const error = hydrated ? coins.error : null;
  const [query, setQuery] = useState(params.get("q") ?? "");
  useEffect(() => setQuery(params.get("q") ?? ""), [params]);
  const [sort, setSort] = useState<Sort>("trending");
  useNow(15_000);

  const trades24h = hydrated ? activity.data?.tradesByToken : undefined;
  const king = useMemo(() => {
    const bonding = (tokens ?? []).filter((t) => t.phase === "curve" && t.raised > 0n);
    return bonding.sort((a, b) => b.progress - a.progress)[0];
  }, [tokens]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^[@$]/, "");
    const filtered = (tokens ?? []).filter(
      (t) => !q || t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q) || t.token.toLowerCase() === q || t.handles.some((h) => h.includes(q))
    );
    return sortCoins(filtered, sort, trades24h);
  }, [tokens, query, sort, trades24h]);
  const shown = list.slice(0, limit);
  const hasMore = list.length > limit;
  const addressQuery = isAddress(query.trim()) ? query.trim() : null;
  const described = useMemo(() => [...shown.map((t) => t.token), ...(king ? [king.token] : [])], [shown, king]);
  const descriptions = useDescriptions(described);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="eyebrow">The board</div>
          <h1 className="display mt-1 text-[44px] leading-none">Explore</h1>
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
          placeholder="Filter: coin, $ticker, @account"
          aria-label="Filter coins"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {king && !query ? (
        <Reveal as="section">
          <KingCard key={king.token} t={king} description={descriptions?.get(king.token.toLowerCase())} />
        </Reveal>
      ) : null}

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
                <TokenCard t={t} description={descriptions?.get(t.token.toLowerCase())} />
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
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}
