"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { Progress } from "@/components/Progress";
import { TokenAvatar } from "@/components/TokenAvatar";
import { XAvatarStack } from "@/components/XAvatar";
import { EmptyArt, StepLaunch, TokenSticker } from "@/components/art";
import { CountUp, Flash, Reveal } from "@/components/motion";
import { splitTokenAbi } from "@/lib/abi";
import { activeChain } from "@/lib/chains";
import { compact, formatEth, formatTokens, shortAddress } from "@/lib/format";
import { useAllTokens } from "@/lib/hooks";
import { describe } from "@/lib/market";
import type { TokenView } from "@/lib/types";

type Holding = { t: TokenView; bal: bigint; value: number; meta: ReturnType<typeof describe>["meta"]; progress: number };

/** `grid-cols-1` on phones (not an implicit auto column), so a long coin name can't widen the page. */
const CARD_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

export default function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  if (!isConnected || !address) return <ConnectPrompt onConnect={openConnectModal} />;
  // Keyed by wallet: switching accounts starts fresh instead of briefly showing the previous one's coins.
  return <Portfolio key={address} address={address} />;
}

function ConnectPrompt({ onConnect }: { onConnect?: () => void }) {
  return (
    <div className="relative mx-auto max-w-xl pt-4 sm:pt-10">
      <div aria-hidden className="bg-grid pointer-events-none absolute -inset-x-4 -top-8 -z-10 h-[440px] sm:-inset-x-6" />
      <Reveal>
        <div className="card relative isolate overflow-hidden rounded-[28px] px-6 pb-10 pt-12 text-center sm:px-12">
          <div aria-hidden className="absolute left-1/2 top-4 -z-10 h-52 w-52 -translate-x-1/2 rounded-full bg-lime opacity-[0.12] blur-3xl" />
          {/* Coins waiting in the corners while the sleepy one naps until a wallet is connected. */}
          <div aria-hidden className="absolute left-6 top-8 -rotate-12 opacity-80 sm:left-10">
            <TokenSticker seed="portfolio:left" size={40} className="animate-float" />
          </div>
          <div aria-hidden className="absolute right-6 top-14 rotate-12 opacity-80 sm:right-10">
            <TokenSticker seed="portfolio:right" size={34} className="animate-float [animation-delay:-2.5s]" />
          </div>
          <EmptyArt className="mx-auto h-28 w-36 animate-float" />
          <div className="eyebrow mt-6">Portfolio</div>
          <h1 className="display mt-2 text-[34px] leading-[0.95] sm:text-[44px]">Connect to see your coins</h1>
          <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-ink-2">
            Your holdings at their current price, plus every coin you launched, read straight from {activeChain.name}.
          </p>
          <button className="btn-neon mt-8 px-6 py-3.5 text-[16px]" onClick={onConnect}>
            Connect wallet
          </button>
        </div>
      </Reveal>
    </div>
  );
}

function Portfolio({ address }: { address: `0x${string}` }) {
  const { data: newestFirst, error: tokensError } = useAllTokens();
  // Oldest first, so a new coin is appended and every earlier index keeps pointing at the same
  // coin; that is what lets the previous balances stay on screen while the next read runs.
  const tokens = useMemo(() => (newestFirst ? [...newestFirst].reverse() : undefined), [newestFirst]);

  // One Multicall3 request for every balance.
  const { data: balances } = useReadContracts({
    contracts: (tokens ?? []).map((t) => ({
      address: t.token,
      abi: splitTokenAbi,
      chainId: activeChain.id,
      functionName: "balanceOf" as const,
      args: [address] as const,
    })),
    query: { enabled: Boolean(tokens?.length), refetchInterval: 15_000, placeholderData: (prev) => prev },
  });

  // Don't show zeros for data we don't have yet: unknown is "–", not "0" (this also covers a read
  // that is paused while offline).
  const unavailable = Boolean(tokensError) && !tokens;
  const loading = (!tokens && !unavailable) || (Boolean(tokens?.length) && balances === undefined);
  // A failed read is unknown, not zero: it is left out and the page says so.
  const failed = (balances ?? []).filter((b) => b.status === "failure").length;
  const holdings: Holding[] = (tokens ?? [])
    .map((t, i) => {
      const r = balances?.[i];
      const bal = r?.status === "success" ? (r.result as bigint) : 0n;
      const d = describe(t);
      return { t, bal, value: Number(formatUnits(bal, 18)) * d.price, meta: d.meta, progress: d.progress };
    })
    .filter((h) => h.bal > 0n)
    .sort((a, b) => b.value - a.value);
  const created = (newestFirst ?? []).filter((t) => t.market.creator.toLowerCase() === address.toLowerCase());
  const total = holdings.reduce((a, h) => a + h.value, 0);
  const known = !loading && !unavailable;
  const launchedTrades = created.reduce((a, t) => a + t.tradeCount, 0n);
  const launchedSplit = created.reduce((a, t) => a + t.creatorFees, 0n);

  return (
    <div className="space-y-14 pt-2 sm:space-y-20 sm:pt-4">
      <div className="relative space-y-7">
        <div aria-hidden className="bg-grid pointer-events-none absolute -inset-x-4 -top-8 -z-10 h-[480px] sm:-inset-x-6" />
        <div>
          <Reveal>
            <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full bg-lime" />
              <span className="truncate">
                Wallet · <span className="normal-case">{shortAddress(address)}</span>
              </span>
            </span>
          </Reveal>
          <Reveal as="h1" delay={60} className="display mt-5 text-[44px] leading-[0.92] sm:text-[64px]">
            Portfolio
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-4 max-w-md text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">Every coin in this wallet at its current price, and the coins it launched.</p>
          </Reveal>
        </div>

        {unavailable ? (
          <Notice>Couldn&apos;t load coins from {activeChain.name} right now. Retrying…</Notice>
        ) : failed ? (
          <Notice>{failed === 1 ? "One balance" : `${failed} balances`} couldn&apos;t be loaded right now, so totals may be low. Retrying…</Notice>
        ) : null}

        <Reveal delay={180}>
          <Totals
            total={total}
            known={known}
            unavailable={unavailable}
            held={known ? holdings.length : undefined}
            launched={newestFirst ? created.length : undefined}
            top={known ? holdings.slice(0, 3) : undefined}
          />
        </Reveal>
      </div>

      <section className="space-y-5">
        <SectionHead eyebrow="What you hold" title="Holdings">
          {known && holdings.length ? (
            <span className="chip num">
              {holdings.length} {holdings.length === 1 ? "coin" : "coins"}
            </span>
          ) : null}
        </SectionHead>
        {!known ? (
          unavailable ? (
            <Unavailable />
          ) : (
            <SkeletonGrid />
          )
        ) : holdings.length === 0 ? (
          <Reveal>
            <EmptyHoldings />
          </Reveal>
        ) : (
          <div className={CARD_GRID}>
            {holdings.map((h, i) => (
              <Reveal key={h.t.token} delay={Math.min(i, 8) * 60}>
                <HoldingCard h={h} share={total > 0 ? (h.value / total) * 100 : undefined} />
              </Reveal>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-5">
        <SectionHead eyebrow="Your launches" title="Launched by you">
          {newestFirst && created.length ? (
            <span className="font-mono text-[12px] text-ink-3">
              {launchedTrades.toString()} trades · <span className="text-up-ink">{formatEth(launchedSplit, 4)} Ξ</span> split to X
            </span>
          ) : null}
        </SectionHead>
        {!newestFirst ? (
          unavailable ? (
            <Unavailable />
          ) : (
            <SkeletonGrid />
          )
        ) : created.length === 0 ? (
          <Reveal>
            <EmptyLaunched />
          </Reveal>
        ) : (
          <div className={CARD_GRID}>
            {created.map((t, i) => (
              <Reveal key={t.token} delay={Math.min(i, 8) * 60}>
                <LaunchedCard t={t} />
              </Reveal>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** The page's hero card: total value counting up, the wallet's top coins fanned out beside it. */
function Totals({
  total,
  known,
  unavailable,
  held,
  launched,
  top,
}: {
  total: number;
  known: boolean;
  unavailable: boolean;
  held: number | undefined;
  launched: number | undefined;
  top: Holding[] | undefined;
}) {
  return (
    <section aria-label="Totals" className="card ring-glow relative rounded-[28px] p-5 sm:p-7">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
        <div className="bg-grid absolute inset-0 opacity-80" />
        <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-lime opacity-[0.13] blur-3xl" />
      </div>
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="eyebrow">Holdings value</div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <CountUp
              value={known ? total : undefined}
              format={(n) => compact(n, 4)}
              className="num text-neon min-w-0 break-all text-[48px] font-semibold leading-none tracking-[-0.04em] sm:text-[68px]"
            />
            {known ? <span className="font-mono text-[18px] font-medium text-ink-2 sm:text-[22px]">Ξ</span> : null}
          </div>
          <p className="mt-3 font-mono text-[12px] text-ink-3">
            {known ? `At current prices on ${activeChain.name}` : unavailable ? "Unavailable right now." : "Reading balances…"}
          </p>
        </div>
        <CoinFan top={top} />
      </div>
      <dl className="mt-7 grid grid-cols-2 divide-x divide-[var(--line)] overflow-hidden rounded-2xl border border-line bg-card sm:max-w-sm">
        <TotalStat label="Coins held" value={held} />
        <TotalStat label="Coins launched" value={launched} />
      </dl>
    </section>
  );
}

function TotalStat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <dt className="eyebrow truncate">{label}</dt>
      <dd className="num mt-1.5 text-[20px] font-semibold tracking-tight">
        <CountUp value={value} />
      </dd>
    </div>
  );
}

const FAN = ["-rotate-[9deg] translate-y-1.5", "rotate-[2deg] -translate-y-1", "rotate-[10deg] translate-y-2"];

/** The top three holdings, fanned like a hand of cards (dashed slots while loading or empty). */
function CoinFan({ top }: { top: Holding[] | undefined }) {
  return (
    <div aria-hidden className="hidden shrink-0 items-center pr-1 sm:flex">
      {top && top.length > 0
        ? top.map((h, i) => (
            <TokenAvatar
              key={h.t.token}
              src={h.meta.image}
              seed={h.t.token}
              size={76}
              className={`${i ? "-ml-7" : ""} rounded-[21px] shadow-lift ring-4 ring-card ${FAN[i]}`}
            />
          ))
        : FAN.map((tilt, i) => (
            <span
              key={i}
              className={`${i ? "-ml-7" : ""} block h-[76px] w-[76px] rounded-[21px] border-2 border-dashed border-line-2 bg-card ${tilt} ${top === undefined ? "animate-pulse" : ""}`}
            />
          ))}
    </div>
  );
}

function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <Reveal className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="display mt-1 text-[30px] leading-none sm:text-[36px]">{title}</h2>
      </div>
      {children}
    </Reveal>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[22px] border border-line bg-down-soft px-4 py-3.5 sm:px-5">
      <span aria-hidden className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-down" />
      <p className="text-[14px] font-medium leading-relaxed text-down-ink">{children}</p>
    </div>
  );
}

function Unavailable() {
  return <p className="card p-5 text-[14px] text-ink-2">Unavailable right now.</p>;
}

function SkeletonGrid() {
  return (
    <div className={CARD_GRID} role="status">
      <span className="sr-only">Loading…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden className="card h-[168px] animate-pulse" />
      ))}
    </div>
  );
}

/** A coin you hold, drawn like the home page's coin cards; the neon edge at the bottom is its share of the portfolio. */
function HoldingCard({ h, share }: { h: Holding; share: number | undefined }) {
  const { t, bal, value, meta, progress } = h;
  const graduated = t.market.graduated;
  return (
    <Link href={`/token/${t.token}`} className="card card-hover group relative flex h-full flex-col gap-4 overflow-hidden p-4">
      <div className="flex items-center gap-3.5">
        <TokenAvatar src={meta.image} seed={t.token} size={56} className="transition duration-500 group-hover:-rotate-3 group-hover:scale-105" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[16px] font-semibold">{t.name}</span>
            <span className="shrink-0 font-mono text-[12px] text-ink-2">${t.symbol}</span>
          </div>
          <div className="num mt-1 truncate text-[12px] text-ink-2">
            {formatTokens(bal)} ${t.symbol}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="num text-[17px] font-semibold leading-tight">
            <Flash value={value} className="px-0.5">
              {compact(value, 5)} Ξ
            </Flash>
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Value</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Progress value={progress} graduated={graduated} size="sm" />
        </div>
        <span className={`num text-[11px] font-semibold ${graduated ? "text-up-ink" : "text-ink-2"}`}>{graduated ? "PonSwap" : `${progress.toFixed(0)}%`}</span>
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-line pt-2.5 font-mono text-[11px] text-ink-3">
        <span>share of portfolio</span>
        <span className="text-ink-2">{share === undefined ? "–" : `${share >= 10 ? share.toFixed(0) : share.toFixed(1)}%`}</span>
      </div>
      {share ? (
        <span aria-hidden className="absolute bottom-0 left-0 h-[3px] rounded-r-full bg-lime shadow-[0_0_12px_var(--glow)]" style={{ width: `${Math.max(2, share)}%` }} />
      ) : null}
    </Link>
  );
}

/** A coin you launched, like the home page's coin cards, with its trades and what it has split so far. */
function LaunchedCard({ t }: { t: TokenView }) {
  const { marketCap, progress, meta } = describe(t);
  const graduated = t.market.graduated;
  return (
    <Link href={`/token/${t.token}`} className="card card-hover group relative flex h-full flex-col gap-3 overflow-hidden p-4">
      <div className="flex gap-3.5">
        <TokenAvatar src={meta.image} seed={t.token} size={56} className="transition duration-500 group-hover:-rotate-3 group-hover:scale-105" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[16px] font-semibold">{t.name}</span>
            <span className="shrink-0 font-mono text-[12px] text-ink-2">${t.symbol}</span>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-ink-3">
            {graduated ? "Graduated" : `${progress.toFixed(1)}% bonded`} · {t.tradeCount.toString()} trades
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <XAvatarStack handles={t.handles} size={20} max={3} />
        <span className="ml-auto font-mono text-[11px] text-ink-3">
          mcap <span className="text-[13px] font-semibold text-ink">{compact(marketCap)} Ξ</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Progress value={progress} graduated={graduated} size="sm" />
        </div>
        <span className={`num text-[11px] font-semibold ${graduated ? "text-up-ink" : "text-ink-2"}`}>{graduated ? "PonSwap" : `${progress.toFixed(0)}%`}</span>
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-line pt-2.5 font-mono text-[11px] text-ink-3">
        <span>split to X</span>
        <Flash value={t.creatorFees} className="px-0.5 text-up-ink">
          {formatEth(t.creatorFees, 4)} Ξ
        </Flash>
      </div>
    </Link>
  );
}

function EmptyHoldings() {
  return (
    <div className="card relative isolate flex flex-col items-center overflow-hidden px-6 py-12 text-center sm:py-14">
      <div aria-hidden className="bg-grid absolute inset-0 -z-10" />
      <div aria-hidden className="absolute left-1/2 top-6 -z-10 h-44 w-44 -translate-x-1/2 rounded-full bg-lime opacity-10 blur-3xl" />
      <EmptyArt className="h-24 w-32 animate-float" />
      <div className="display mt-5 text-[26px] leading-tight">No coins yet.</div>
      <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-ink-2">Coins you buy show up here, valued at their current price.</p>
      <Link href="/" className="btn-neon group/cta mt-6 px-5 py-3">
        Explore
        <span aria-hidden className="transition-transform duration-300 group-hover/cta:translate-x-1">
          →
        </span>
      </Link>
    </div>
  );
}

function EmptyLaunched() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-[22px] border border-dashed border-line-2 p-5 sm:flex-row sm:items-center sm:p-6">
      <StepLaunch className="h-16 w-16 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-semibold">Nothing yet.</div>
        <p className="mt-0.5 text-[14px] leading-relaxed text-ink-2">Launch a coin and every trade pays the X accounts you pick.</p>
      </div>
      <Link href="/create" className="btn-secondary">
        Launch a coin
      </Link>
    </div>
  );
}
