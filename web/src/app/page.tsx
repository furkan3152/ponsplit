"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TokenCard } from "@/components/TokenCard";
import { formatEth } from "@/lib/format";
import { useTokens } from "@/lib/hooks";

type Filter = "all" | "bonding" | "graduated";

export default function Home() {
  const { data: tokens, isLoading, error } = useTokens();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, "");
    return (tokens ?? []).filter((t) => {
      if (filter === "bonding" && t.curve.graduated) return false;
      if (filter === "graduated" && !t.curve.graduated) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.symbol.toLowerCase().includes(q) ||
        t.token.toLowerCase() === q ||
        t.handles.some((h) => h.includes(q))
      );
    });
  }, [tokens, query, filter]);

  const totalFees = (tokens ?? []).reduce((a, t) => a + t.creatorFees, 0n);

  return (
    <div className="space-y-10">
      <section className="pt-8 text-center sm:pt-14">
        <p className="mb-4 inline-block rounded-full border border-lime/30 bg-lime/10 px-3 py-1 font-mono text-xs text-lime">
          built on Robinhood Chain
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          One coin. Many X accounts. <span className="text-lime">Fees split automatically.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-mute">
          Launch a token on a bonding curve and route its creator fees to any set of X accounts. Owners sign in with X and
          claim to their wallet whenever they want.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/create" className="btn-primary px-6">
            Launch a token
          </Link>
          <Link href="/claim" className="btn-ghost px-6">
            Claim my fees
          </Link>
        </div>
        <div className="mx-auto mt-10 grid max-w-lg grid-cols-2 gap-3">
          <Stat label="Tokens launched" value={tokens ? tokens.length.toString() : "–"} />
          <Stat label="Fees split" value={tokens ? `${formatEth(totalFees, 3)} ETH` : "–"} />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            className="input sm:max-w-xs"
            placeholder="Search name, ticker or @handle"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex gap-1 rounded-xl border border-ink-700 bg-ink-900 p-1">
            {(["all", "bonding", "graduated"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-sm capitalize ${filter === f ? "bg-ink-700 text-white" : "text-mute hover:text-white"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p className="card p-6 text-sm text-red-300">Could not load tokens: {error.message.split("\n")[0]}</p>
        ) : isLoading ? (
          <Grid>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="card h-52 animate-pulse" />
            ))}
          </Grid>
        ) : list.length === 0 ? (
          <div className="card p-10 text-center text-mute">
            {tokens?.length ? "No tokens match." : "No tokens yet."}{" "}
            <Link href="/create" className="text-lime hover:underline">
              Launch the first one
            </Link>
          </div>
        ) : (
          <Grid>
            {list.map((t) => (
              <TokenCard key={t.token} t={t} />
            ))}
          </Grid>
        )}
      </section>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="font-mono text-lg">{value}</div>
      <div className="text-xs text-mute">{label}</div>
    </div>
  );
}
