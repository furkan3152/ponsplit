"use client";

import Link from "next/link";
import { useState } from "react";
import { isAddress, getAddress, type Address } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { Progress } from "@/components/Progress";
import { SplitList } from "@/components/SplitList";
import { TokenAvatar } from "@/components/TokenAvatar";
import { TradePanel } from "@/components/TradePanel";
import { launchpadAbi } from "@/lib/abi";
import { activeChain, explorerUrl } from "@/lib/chains";
import { LAUNCHPAD_ADDRESS } from "@/lib/config";
import { curveProgress, errorMessage, formatEth, formatTokens, shortAddress, spotPrice, timeAgo } from "@/lib/format";
import { useFeeBps, useToken } from "@/lib/hooks";

export default function TokenPage({ params }: { params: { address: string } }) {
  const token = isAddress(params.address) ? getAddress(params.address) : undefined;
  const { data: t, isLoading, refetch } = useToken(token);
  const feeBps = useFeeBps();

  if (!token) return <Empty text="That is not a valid token address." />;
  if (isLoading) return <div className="card h-96 animate-pulse" />;
  if (!t || t.curve.creator === "0x0000000000000000000000000000000000000000") {
    return <Empty text="This token was not launched on PonSplit." />;
  }

  const progress = curveProgress(t.curve.realToken, t.curveSupply);
  const price = spotPrice(t.curve.virtualEth, t.curve.virtualToken);
  // After migration the price lives on the DEX (and lpSupply is zeroed), so curve figures would be stale.
  const marketCap = t.curve.migrated ? undefined : price * Number((t.curveSupply + t.curve.lpSupply) / 10n ** 18n);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <section className="card p-5">
          <div className="flex items-start gap-4">
            <TokenAvatar src={t.imageUrl} symbol={t.symbol} size={72} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h1 className="text-2xl font-semibold tracking-tight">{t.name}</h1>
                <span className="font-mono text-mute">${t.symbol}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-white/80">{t.description || "No description."}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-mute">
                <a className="hover:text-lime" href={explorerUrl("token", token)} target="_blank" rel="noreferrer">
                  CA {shortAddress(token)} ↗
                </a>
                <button className="hover:text-lime" onClick={() => navigator.clipboard.writeText(token)}>
                  copy
                </button>
                <a className="hover:text-lime" href={explorerUrl("address", t.curve.creator)} target="_blank" rel="noreferrer">
                  by {shortAddress(t.curve.creator)}
                </a>
                <span>{timeAgo(Number(t.curve.createdAt))}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Price" value={t.curve.migrated ? "on DEX" : `${price.toPrecision(3)} ETH`} />
          <Stat
            label="Market cap"
            value={marketCap === undefined ? "on DEX" : `${marketCap.toLocaleString("en-US", { maximumFractionDigits: 2 })} ETH`}
          />
          <Stat label="In curve" value={`${formatEth(t.curve.realEth, 3)} ETH`} />
          <Stat label="Fees split" value={`${formatEth(t.creatorFees, 4)} ETH`} />
        </section>

        <section className="card space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Bonding curve</h2>
            <span className="font-mono text-sm text-lime">
              {t.curve.graduated ? (t.curve.migrated ? "live on DEX" : "graduated") : `${progress.toFixed(2)}%`}
            </span>
          </div>
          <Progress value={progress} graduated={t.curve.graduated} />
          <p className="text-sm text-mute">
            {t.curve.graduated
              ? t.curve.migrated
                ? "The curve sold out and liquidity was moved to the DEX with the LP tokens burned."
                : "The curve sold out. Anyone can now migrate its liquidity to the DEX."
              : `${formatTokens(t.curve.realToken)} ${t.symbol} left on the curve. When it sells out, ${formatTokens(
                  t.curve.lpSupply
                )} ${t.symbol} and the collected ETH seed a DEX pool.`}
          </p>
          {t.curve.graduated && !t.curve.migrated ? <MigrateButton token={token} onDone={refetch} /> : null}
        </section>

        <section className="card space-y-4 p-5">
          <div>
            <h2 className="font-semibold">Creator fee split</h2>
            <p className="text-sm text-mute">
              {feeBps !== undefined ? `${Number(feeBps) / 100}% of every curve trade is a fee. ` : ""}The creator share goes to these
              X accounts. Owners can{" "}
              <Link href="/claim" className="text-lime hover:underline">
                claim with X
              </Link>
              .
            </p>
          </div>
          <SplitList handles={t.handles} bps={t.bps} />
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        {t.curve.graduated ? (
          <div className="card p-4 text-sm text-mute">
            Curve trading has ended. {t.curve.migrated ? "Trade this token on the DEX." : "Waiting for migration to the DEX."}
          </div>
        ) : (
          <TradePanel token={token} symbol={t.symbol} onTraded={refetch} />
        )}
      </aside>
    </div>
  );
}

function MigrateButton({ token, onDone }: { token: Address; onDone: () => void }) {
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function migrate() {
    if (!LAUNCHPAD_ADDRESS || !publicClient) return;
    setBusy(true);
    setErr(null);
    try {
      const hash = await writeContractAsync({
        address: LAUNCHPAD_ADDRESS,
        abi: launchpadAbi,
        chainId: activeChain.id,
        functionName: "migrate",
        args: [token],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn-primary" disabled={busy} onClick={migrate}>
        {busy ? "Migrating…" : "Migrate to DEX"}
      </button>
      {err ? <p className="mt-2 text-sm text-red-300">{err}</p> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="truncate font-mono text-sm">{value}</div>
      <div className="text-xs text-mute">{label}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="card p-10 text-center text-mute">
      {text}{" "}
      <Link href="/" className="text-lime hover:underline">
        Back to explore
      </Link>
    </div>
  );
}
