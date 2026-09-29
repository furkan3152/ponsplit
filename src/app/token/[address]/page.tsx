"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { getAddress, isAddress } from "viem";
import { useAccount } from "wagmi";
import { GraduatedArt, NotFoundArt, StepLaunch } from "@/components/art";
import { Flash, Reveal, celebrate } from "@/components/motion";
import { PriceChart } from "@/components/PriceChart";
import { Progress } from "@/components/Progress";
import { SplitCard, accountsPct } from "@/components/SplitCard";
import { TokenAvatar } from "@/components/TokenAvatar";
import { TradePanel } from "@/components/TradePanel";
import { TradesTable } from "@/components/TradesTable";
import { coinImage } from "@/lib/coin-ui";
import { compact, formatEth, formatPrice, formatTokens, progressText, shortAddress, timeAgo } from "@/lib/format";
import { isOfficial } from "@/lib/brand";
import { useCoin, useCoinElsewhere, useCoinTrades, useHandleChecks, useNow, useTokenInfo } from "@/lib/hooks";
import { safeUrl } from "@/lib/metadata";
import { useNetwork, useSwitchNetwork } from "@/lib/network-context";
import { NETWORKS, explorerLink, isHidden, onNetwork, type NetworkId } from "@/lib/networks";
import { TOTAL_SUPPLY, toRecipients } from "@/lib/pons";
import type { Coin, Trade } from "@/lib/types";

export default function TokenPage({ params }: { params: { address: string } }) {
  const n = useNetwork();
  const parsed = isAddress(params.address) ? getAddress(params.address) : undefined;
  // A hidden coin (src/deployment.json) isn't read at all; the page says it isn't listed.
  const hidden = Boolean(parsed && isHidden(n, parsed));
  const token = hidden ? undefined : parsed;
  const { data: t, isLoading, isError, refetch, isPlaceholderData } = useCoin(token);
  const elsewhere = useCoinElsewhere(token, t === null);
  const trades = useCoinTrades(t);
  const info = useTokenInfo(t ? t.token : undefined);
  const { address } = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  // The create page lands here with ?launched=1. Remember that once, then drop it from the URL,
  // so a reload or a copied link never shows the creator's banner to anyone else.
  const searchParams = useSearchParams();
  const [fromLaunch] = useState(() => searchParams.get("launched") === "1");
  useEffect(() => {
    if (fromLaunch) router.replace(pathname, { scroll: false });
  }, [fromLaunch, pathname, router]);
  const launched = fromLaunch && Boolean(t && address && t.creator.toLowerCase() === address.toLowerCase());
  const celebrated = useRef(false);
  useEffect(() => {
    if (launched && !celebrated.current) {
      celebrated.current = true;
      void celebrate();
    }
  }, [launched]);
  useNow(15_000);
  useGraduationCelebration(t?.token, t?.phase);

  if (hidden) return <Missing text="This coin isn't listed on SplitEarn." />;
  if (!token) return <Missing text="That is not a valid coin address." />;
  if (isLoading) return <PageSkeleton />;
  // A failed read is a network problem, not proof the coin doesn't exist.
  if (t === undefined && isError) return <Missing text="Couldn't load this coin right now. Retrying…" />;
  if (!t) {
    if (elsewhere.data) return <OnOtherNetwork id={elsewhere.data} />;
    if (elsewhere.isLoading) return <PageSkeleton />;
    return <Missing text={`This coin wasn't launched on SplitEarn ${n.isTestnet ? "testnet" : "mainnet"}.`} />;
  }

  const socials = info.data?.socials;
  const links = [
    socials?.website && { label: "Website", href: safeUrl(socials.website) },
    socials?.telegram && { label: "Telegram", href: safeUrl(socials.telegram) },
    socials?.twitter && { label: "X", href: safeUrl(socials.twitter) },
    socials?.discord && { label: "Discord", href: safeUrl(socials.discord) },
    socials?.farcaster && { label: "Farcaster", href: safeUrl(socials.farcaster) },
  ].filter((l): l is { label: string; href: string } => Boolean(l && l.href));
  const description = info.data?.description?.trim();
  const onPool = t.phase === "pool";
  const graduated = t.graduated;
  const mine = Boolean(address && t.creator.toLowerCase() === address.toLowerCase());
  const pending = toRecipients(t.feesPending, t.platformBps);

  return (
    <div className="space-y-6 pt-1 sm:space-y-8">
      {launched ? <LaunchBanner t={t} /> : null}

      <header className="relative">
        <div aria-hidden className="bg-grid pointer-events-none absolute -inset-x-4 -top-6 -z-10 h-[320px] sm:-inset-x-6 sm:h-[380px]" />
        <div aria-hidden className="pointer-events-none absolute -top-6 right-0 -z-10 h-64 w-64 rounded-full bg-lime opacity-[0.07] blur-3xl sm:h-80 sm:w-80" />

        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full ${onPool ? "bg-up" : "bg-lime"}`} />
            <span className="truncate">
              {onPool ? "Uniswap v4 pool" : t.phase === "curve" ? "pons bonding curve" : t.phase === "graduating" ? "Graduating" : "Rescued"}
              {n.isTestnet ? " · testnet" : ""}
            </span>
          </span>
          <ShareButton t={t} />
        </div>

        <div className="mt-5 flex items-start gap-4 sm:mt-7 sm:gap-6">
          <div className="relative shrink-0">
            <span aria-hidden className="absolute -inset-1.5 rounded-[26px] border border-dashed border-line-2 sm:-inset-2 sm:rounded-[42px]" />
            <TokenAvatar src={coinImage(t)} seed={t.token} size={72} className="relative sm:hidden" />
            <TokenAvatar src={coinImage(t)} seed={t.token} size={120} className="relative hidden sm:block" />
          </div>
          <div className="min-w-0 flex-1 sm:pt-1">
            <h1 className="display text-[40px] leading-[0.92] [overflow-wrap:anywhere] sm:text-[64px]">{t.name}</h1>
            {/* x-clip: the stamp starts at 1.8x scale, which must not widen the page next to a long ticker. */}
            <div className="mt-3 flex flex-wrap items-center gap-2 overflow-x-clip sm:mt-4">
              <span className="num inline-flex items-center rounded-full border border-line-2 bg-card px-2.5 py-1 text-[12px] font-semibold text-ink">${t.symbol}</span>
              {isOfficial(t.token) ? (
                <span className="chip border-lime bg-lime font-semibold text-[var(--lime-ink)]">✓ Official SplitEarn token</span>
              ) : null}
              {t.creatorTaxBps ? <span className="chip num">{t.creatorTaxBps / 100}% creator tax</span> : null}
              {graduated ? (
                <span
                  className="inline-flex animate-stamp items-center gap-1.5 rounded-lg border-2 border-up bg-up-soft px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-up-ink"
                  style={{ animationDelay: "250ms", animationFillMode: "both" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                  Graduated
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-1.5 gap-y-2 font-mono text-[11.5px] text-ink-2 sm:gap-x-2">
          <CopyAddress value={token} />
          <span className="px-1">
            by{" "}
            <a className="text-ink underline-offset-2 hover:underline" href={explorerLink(n, "address", t.creator)} target="_blank" rel="noreferrer">
              {mine ? "you" : shortAddress(t.creator)}
            </a>
          </span>
          <span aria-hidden className="text-ink-3">
            /
          </span>
          <span className="px-1">{timeAgo(t.createdAt)} ago</span>
          {/* On mainnet the coin is a pons coin, listed on pons's own launchpad too. */}
          {n.ponsIsCopy ? null : (
            <a
              href={`https://ponsfamily.com/launchpad/${token}`}
              target="_blank"
              rel="noreferrer"
              className="relative inline-flex min-h-[32px] items-center rounded-full border border-line px-2.5 font-sans text-[12.5px] font-medium text-ink transition after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] hover:border-line-2 hover:bg-card-2 sm:px-3"
            >
              View on pons ↗
            </a>
          )}
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer nofollow"
              className="relative inline-flex min-h-[32px] items-center rounded-full border border-line px-2.5 font-sans text-[12.5px] font-medium text-ink transition after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] hover:border-line-2 hover:bg-card-2 sm:px-3"
            >
              {l.label} ↗
            </a>
          ))}
        </div>
      </header>

      {t.feesMoved ? (
        <p className="card px-4 py-3.5 text-[13px] leading-relaxed text-ink-2">
          pons now sends this coin&apos;s creator fees to <span className="num text-ink">{shortAddress(t.feeRecipient)}</span> instead of its SplitEarn split, so new
          fees no longer reach the X accounts below. What they already earned stays theirs to claim.
        </p>
      ) : null}

      <Reveal delay={60}>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[22px] border border-line bg-line shadow-card lg:grid-cols-4">
          <Tile label="Price" foot={<Sparkline trades={trades.trades} />}>
            <Flash value={t.price}>{`${formatPrice(t.price)} Ξ`}</Flash>
          </Tile>
          <Tile label="Market cap" foot={<Foot>{compact(TOTAL_SUPPLY)} supply</Foot>}>
            <Flash value={t.marketCap}>{`${compact(t.marketCap)} Ξ`}</Flash>
          </Tile>
          <Tile
            label={graduated ? "Graduated at" : "Raised on curve"}
            foot={
              graduated ? (
                <Foot>
                  <LockIcon /> liquidity locked by pons
                </Foot>
              ) : (
                <div className="flex w-full items-center gap-2">
                  <div className="flex-1">
                    <Progress value={t.progress} size="sm" />
                  </div>
                  <span className="num text-[11px] font-semibold text-ink-2">{progressText(t.progress)}%</span>
                </div>
              )
            }
          >
            <Flash value={graduated ? t.threshold : t.raised}>{`${formatEth(graduated ? t.threshold : t.raised, 3)} Ξ`}</Flash>
          </Tile>
          <Tile
            label="Paid to X accounts"
            foot={
              <Foot>
                {pending > 0n ? `+${formatEth(pending, 4)} on the way · ` : ""}
                {accountsPct(t.creatorTaxBps, t.platformBps).toLocaleString("en-US", { maximumFractionDigits: 2 })}% of each trade
              </Foot>
            }
          >
            {/* Paid means in the vault already; what the coin still holds is the "on the way" line. */}
            <Flash value={t.feesSplit} className="text-up-ink">{`${formatEth(t.feesSplit, 4)} Ξ`}</Flash>
          </Tile>
        </dl>
      </Reveal>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_372px] lg:gap-6">
        <div className="min-w-0 space-y-5 lg:space-y-6">
          {trades.error && !trades.trades ? (
            <p className="card flex items-center gap-2.5 px-4 py-3.5 text-[14px] font-medium text-down-ink">
              <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-down" />
              Couldn&apos;t load this coin&apos;s trades right now. Retrying…
            </p>
          ) : null}
          <Reveal delay={120}>
            <PriceChart trades={trades.trades} loading={!trades.trades} partial={trades.hasOlder} symbol={t.symbol} />
          </Reveal>
          <Reveal delay={60}>
            <TradesTable
              trades={trades.trades}
              symbol={t.symbol}
              me={address}
              hasOlder={trades.hasOlder}
              loadOlder={trades.loadOlder}
              loadingOlder={trades.loadingOlder}
            />
          </Reveal>
          {description ? (
            <Reveal delay={60}>
              <About text={description} />
            </Reveal>
          ) : null}
        </div>

        <aside className="order-first min-w-0 space-y-5 lg:sticky lg:top-20 lg:order-none lg:space-y-6 lg:self-start">
          <TradePanel coin={t} live={!isPlaceholderData} onTraded={() => refetch()} />
          <Reveal delay={120}>{graduated ? <GraduatedCard t={t} /> : <CurveCard t={t} />}</Reveal>
          <Reveal delay={180}>
            <SplitCard t={t} />
          </Reveal>
        </aside>
      </div>
    </div>
  );
}

/** The coin exists on the other network: say so and offer to switch there. */
function OnOtherNetwork({ id }: { id: NetworkId }) {
  const switchTo = useSwitchNetwork();
  const other = NETWORKS[id];
  return (
    <div className="card relative isolate mx-auto mt-6 flex max-w-lg flex-col items-center gap-4 overflow-hidden px-6 py-14 text-center">
      <div aria-hidden className="bg-grid absolute inset-0 -z-10" />
      <NotFoundArt className="h-36 w-48 animate-float" />
      <div className="eyebrow">Coin page</div>
      <p className="display max-w-sm text-[26px] leading-[1.05]">This coin is on {other.label.toLowerCase()}.</p>
      <button className="btn-neon mt-1" onClick={() => switchTo(id)}>
        Switch to {other.label.toLowerCase()}
      </button>
    </div>
  );
}

/** Confetti when a coin graduates while its page is open (not when opening an already graduated coin). */
function useGraduationCelebration(token: string | undefined, phase: Coin["phase"] | undefined) {
  const prev = useRef<{ token?: string; phase?: Coin["phase"] }>({});
  useEffect(() => {
    const p = prev.current;
    if (token && p.token === token && p.phase === "curve" && phase && phase !== "curve") void celebrate();
    prev.current = { token, phase };
  }, [token, phase]);
}

/** The creator's first look at their live coin: a neon ticket with the share button. */
function LaunchBanner({ t }: { t: Coin }) {
  return (
    <div className="relative isolate animate-pop overflow-hidden rounded-[26px] bg-lime text-[var(--lime-ink)] shadow-[0_24px_60px_-30px_var(--glow)] [[data-theme=light]_&]:border-2 [[data-theme=light]_&]:border-outline [[data-theme=light]_&]:shadow-sticker">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]"
        style={{ backgroundImage: "repeating-linear-gradient(-45deg, var(--lime-ink) 0 2px, transparent 2px 14px)" }}
      />
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5 sm:px-6">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[var(--lime-ink)] sm:h-[76px] sm:w-[76px]">
          <StepLaunch className="h-14 w-14 animate-float sm:h-16 sm:w-16" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">Launch confirmed</div>
          <p className="display mt-1 text-[30px] leading-[0.95] [overflow-wrap:anywhere] sm:text-[38px]">${t.symbol} is live.</p>
          <p className="mt-1.5 text-[14px] font-medium opacity-80">Share it: every trade pays your X accounts.</p>
        </div>
        <ShareButton t={t} tone="ink" className="self-start sm:self-center" />
      </div>
    </div>
  );
}

/** One cell of the stats strip: label, live number, and a small detail underneath. */
function Tile({ label, children, foot }: { label: string; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col bg-card px-3.5 pb-3.5 pt-4 sm:px-5">
      <dt className="eyebrow truncate tracking-[0.08em] sm:tracking-[0.14em]">{label}</dt>
      <dd className="num mt-2 truncate text-[19px] font-semibold leading-tight tracking-tight sm:text-[26px]">{children}</dd>
      {foot ? <dd className="mt-auto flex min-h-[28px] items-end pt-2.5">{foot}</dd> : null}
    </div>
  );
}

function Foot({ children }: { children: React.ReactNode }) {
  return <span className="block min-w-0 truncate font-mono text-[11px] text-ink-3">{children}</span>;
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="inline-block shrink-0 align-[-1px]">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** The last few dozen trade prices as a tiny line, green if the price rose over them, red if it fell. */
function Sparkline({ trades }: { trades: readonly Trade[] | undefined }) {
  const prices = (trades ?? []).filter((r) => r.price > 0).slice(-48).map((r) => r.price);
  if (prices.length < 2) return <Foot>{!trades ? "…" : trades.length ? "1 trade so far" : "waiting for trades"}</Foot>;
  const W = 100;
  const H = 26;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const y = (p: number) => (hi === lo ? H / 2 : H - 2 - ((p - lo) / (hi - lo)) * (H - 4));
  const d = prices.map((p, i) => `${i ? "L" : "M"}${((i / (prices.length - 1)) * W).toFixed(2)} ${y(p).toFixed(2)}`).join("");
  const color = prices[prices.length - 1] >= prices[0] ? "var(--green)" : "var(--red)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      <path d={`${d}L${W} ${H}L0 ${H}Z`} fill={color} opacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Where the coin sits on its bonding curve, and how much is left before it graduates. */
function CurveCard({ t }: { t: Coin }) {
  // The curve's shape: the share of the supply it sells before only the pool's reserve is left.
  const supply = BigInt(TOTAL_SUPPLY) * 10n ** 18n;
  const r = t.reservedTokens > 0n && t.reservedTokens < supply ? 1 - Number((t.reservedTokens * 10_000n) / supply) / 10_000 : 0.714;
  const left = t.threshold > t.raised ? t.threshold - t.raised : 0n;
  return (
    <section className="card relative isolate overflow-hidden p-5">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 -z-10 h-52 w-52 rounded-full bg-lime opacity-[0.08] blur-3xl" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Road to Uniswap</div>
          <h2 className="display mt-1 text-[26px] leading-none">Bonding curve</h2>
        </div>
        <span className="num text-neon text-[24px] font-bold leading-none">{progressText(t.progress, 1)}%</span>
      </div>
      <CurveSketch progress={t.progress} ratio={r > 0.05 && r < 0.98 ? r : 0.714} />
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        {formatTokens(t.sellable)} {t.symbol} left on the curve, about {formatEth(left, 3)} ETH more to raise. Then pons graduates it into a Uniswap v4 pool
        with locked liquidity, and it keeps trading here.
      </p>
    </section>
  );
}

/** A little drawing of the price curve (log scale), filled up to where the coin is now. */
function CurveSketch({ progress, ratio }: { progress: number; ratio: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const W = 300;
  const H = 104;
  const L = 6;
  const R = 292;
  const B = 94;
  const T = 30;
  const f = (s: number) => Math.log(1 - ratio * s) / Math.log(1 - ratio);
  const at = (s: number): [number, number] => [L + (R - L) * s, B - (B - T) * f(s)];
  const p = Math.min(1, Math.max(0, progress / 100));
  const path = (from: number, to: number) => {
    const n = Math.max(2, Math.ceil(64 * (to - from)));
    const pts = Array.from({ length: n + 1 }, (_, k) => at(from + ((to - from) * k) / n));
    return `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}`;
  };
  const [px, py] = at(p);
  const [ex, ey] = at(1);
  return (
    <div className="mt-4" role="progressbar" aria-label="Bonding curve progress" aria-valuenow={Math.floor(progress)} aria-valuemin={0} aria-valuemax={100}>
      {/* The dot is positioned in % of this box, so it holds only the drawing. */}
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={`${id}fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--lime)" stopOpacity="0.42" />
              <stop offset="1" stopColor="var(--lime)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => (
            <path key={g} d={`M${L + (R - L) * g} ${T - 6}V${B}`} stroke="var(--line)" strokeDasharray="1 4" />
          ))}
          <path d={`M${L} ${B}H${R}`} stroke="var(--line-2)" />
          <path d={path(p, 1)} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="3 5" strokeLinecap="round" />
          {p > 0 ? <path d={`${path(0, p)}L${px.toFixed(1)} ${B}L${L} ${B}Z`} fill={`url(#${id}fill)`} /> : null}
          {p > 0 ? <path d={path(0, p)} fill="none" stroke="var(--green)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" /> : null}
          {/* the finish line: a flag where the curve sells out */}
          <path d={`M${ex} ${ey}V${ey - 22}`} stroke="var(--ink-2)" strokeWidth={1.6} strokeLinecap="round" />
          <path d={`M${ex} ${ey - 22}L${ex - 15} ${ey - 17}L${ex} ${ey - 12}Z`} fill="var(--lime)" stroke="var(--outline)" strokeWidth={1.4} strokeLinejoin="round" />
        </svg>
        <span
          aria-hidden
          className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 animate-pulse-dot rounded-full border-2 border-[var(--outline)] bg-lime"
          style={{ left: `${(px / W) * 100}%`, top: `${(py / H) * 100}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        <span>Launch</span>
        <span>PonSwap</span>
      </div>
    </div>
  );
}

/** A graduated coin's certificate: a slowly turning seal and where it trades now. */
function GraduatedCard({ t }: { t: Coin }) {
  const n = useNetwork();
  return (
    <section className="card ring-glow relative p-5">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
        <div className="bg-grid absolute inset-0" />
        <div className="absolute -right-12 -top-16 h-52 w-52 rounded-full bg-up opacity-[0.16] blur-3xl" />
        <div className="absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-lime opacity-[0.12] blur-3xl" />
      </div>
      <div className="flex items-center gap-4">
        <Seal />
        <div className="min-w-0">
          <div className="eyebrow !text-up-ink">Graduated</div>
          <h2 className="display mt-1.5 text-[26px] leading-[0.98]">{t.phase === "pool" ? "Trading on Uniswap v4" : t.phase === "graduating" ? "Opening its pool" : "Rescued by pons"}</h2>
        </div>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
        The curve raised {formatEth(t.threshold, 2)} ETH and sold out. pons put that ETH and {formatTokens(t.reservedTokens)} {t.symbol} into a Uniswap v4 pool whose
        liquidity is locked. Its creator fees keep flowing to the X accounts.
      </p>
      <a
        href={explorerLink(n, "address", t.token)}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-line-2 bg-card px-3 py-1.5 font-mono text-[11px] font-medium text-ink transition hover:bg-card-2"
      >
        <LockIcon />
        Liquidity locked by pons ↗
      </a>
    </section>
  );
}

function Seal() {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <div className="relative h-[92px] w-[92px] shrink-0">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <path id={`${id}ring`} d="M50 50m-40 0a40 40 0 1 1 80 0a40 40 0 1 1 -80 0" />
        </defs>
        <circle cx="50" cy="50" r="48" fill="var(--card)" stroke="var(--line-2)" strokeDasharray="1.5 4" />
        <g className="origin-center animate-spin-slow">
          <text className="fill-[var(--ink-2)] font-mono" fontSize="7.4" fontWeight={600}>
            {/* textLength is the ring's circumference, so the words meet seamlessly (the no-break space keeps the last gap). */}
            <textPath href={`#${id}ring`} textLength={251.3} lengthAdjust="spacing">
              {"SOLD OUT · LIQUIDITY LOCKED · PONSWAP · "}
            </textPath>
          </text>
        </g>
      </svg>
      <GraduatedArt className="absolute inset-[17%] h-[66%] w-[66%] animate-float" />
    </div>
  );
}

function About({ text }: { text: string }) {
  return (
    <section className="card relative isolate overflow-hidden p-5 sm:p-6">
      <span
        aria-hidden
        className="pointer-events-none absolute right-6 top-2 -z-10 select-none font-serif text-[120px] italic leading-[0.8] text-transparent"
        style={{ WebkitTextStroke: "1px var(--line-2)" }}
      >
        &ldquo;
      </span>
      <div className="eyebrow">From the creator</div>
      <h2 className="display mt-1 text-[26px] leading-none">About</h2>
      <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink-2">{text}</p>
    </section>
  );
}

/** Opens an X post with the coin, its fee split and a link that unfurls into the coin's card. */
function ShareButton({
  t,
  tone = "default",
  className = "",
}: {
  t: Pick<Coin, "name" | "symbol" | "handles" | "xIds" | "token">;
  /** "ink": the dark pill used on the neon launch banner. */
  tone?: "default" | "ink";
  className?: string;
}) {
  const n = useNetwork();
  const checks = useHandleChecks(t.handles, t.xIds);
  function share() {
    // @-mention only usernames confirmed to still belong to the fee recipient; a renamed account's
    // old name may now be someone else's, so it is written without the @.
    const who = checks.map((c) => (c.status === "current" ? `@${c.handle}` : c.handle)).join(" ");
    const text = `${t.name} ($${t.symbol}) on SplitEarn${n.isTestnet ? " testnet" : ""}: every trade pays ${who}`;
    // The link opens the coin on its own network, whatever the reader was browsing.
    const url = `${location.origin}${onNetwork(`/token/${t.token}`, n.id)}`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener,noreferrer");
  }
  const look =
    tone === "ink"
      ? "btn min-h-[44px] bg-[var(--lime-ink)] px-5 text-[14px] text-lime hover:-translate-y-px"
      : "btn-secondary min-h-[40px] px-4 py-2 text-[13px]";
  return (
    <button className={`${look} ${className}`} onClick={share}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" />
      </svg>
      Share
    </button>
  );
}

function CopyAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      title="Copy the coin address"
      className="num relative after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] inline-flex min-h-[32px] items-center rounded-full border border-line bg-card px-3 text-[11.5px] text-ink-2 transition hover:border-line-2 hover:text-ink"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? "copied ✓" : `${shortAddress(value)} ⧉`}
    </button>
  );
}

/** The page's outline while the coin loads, so nothing jumps when it arrives. */
function PageSkeleton() {
  return (
    <div className="space-y-6 pt-1 sm:space-y-8" aria-busy="true">
      <div className="h-8 w-44 animate-pulse rounded-full bg-card-2" />
      <div className="flex items-center gap-4 sm:gap-6">
        <div className="h-[72px] w-[72px] shrink-0 animate-pulse rounded-[20px] bg-card-2 sm:h-[120px] sm:w-[120px] sm:rounded-[34px]" />
        <div className="flex-1 space-y-3">
          <div className="h-10 w-3/4 max-w-md animate-pulse rounded-xl bg-card-2 sm:h-14" />
          <div className="h-6 w-24 animate-pulse rounded-full bg-card-2" />
        </div>
      </div>
      <div className="card h-[118px] animate-pulse" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_372px] lg:gap-6">
        <div className="card h-[460px] animate-pulse" />
        <div className="card order-first h-[420px] animate-pulse lg:order-none" />
      </div>
    </div>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <div className="card relative isolate mx-auto mt-6 flex max-w-lg flex-col items-center gap-4 overflow-hidden px-6 py-14 text-center">
      <div aria-hidden className="bg-grid absolute inset-0 -z-10" />
      <NotFoundArt className="h-36 w-48 animate-float" />
      <div className="eyebrow">Coin page</div>
      <p className="display max-w-sm text-[26px] leading-[1.05]">{text}</p>
      <Link href="/" className="btn-secondary mt-1">
        Back to explore
      </Link>
    </div>
  );
}
