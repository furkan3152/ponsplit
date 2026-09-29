"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { formatEther } from "viem";
import { useReadContract } from "wagmi";
import { feeVaultAbi } from "@/lib/abi";
import { formatEth, pct } from "@/lib/format";
import { xProfileUrlById } from "@/lib/handles";
import { useHandleChecks } from "@/lib/hooks";
import { useNetwork } from "@/lib/network-context";
import { BPS, PONS_FEE_BPS, PONS_PROTOCOL_SHARE_BPS, toRecipients } from "@/lib/pons";
import type { Coin } from "@/lib/types";
import { CountUp, useInView } from "./motion";
import { XAvatar } from "./XAvatar";

/** The account colors, in order, as on the home page. Accounts past the fifth reuse them, striped. */
const ACCOUNT_COLORS = ["var(--sky)", "var(--pink)", "var(--sun)", "var(--lilac)", "var(--orange)"];
const STRIPES = "repeating-linear-gradient(135deg, transparent 0 3px, rgba(11, 11, 13, 0.3) 3px 5px)";
const colorOf = (i: number) => ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];
const swatch = (i: number): CSSProperties => ({ backgroundColor: colorOf(i), backgroundImage: i >= ACCOUNT_COLORS.length ? STRIPES : undefined });

/** formatEth for a plain number, for the in-between values of a count-up. */
function ethText(n: number, digits = 4) {
  if (n <= 0) return "0";
  if (n < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}`;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Of every trade's volume, the part (in %) that reaches the X accounts: the creator's share of pons's fee plus the creator tax, less SplitEarn's cut. */
export function accountsPct(creatorTaxBps: number, platformBps: number, feeBps = PONS_FEE_BPS) {
  const creator = (feeBps * (10_000 - PONS_PROTOCOL_SHARE_BPS)) / 10_000 + creatorTaxBps;
  return (creator * (10_000 - platformBps)) / 10_000 / 100;
}

/** Who gets this coin's creator fees, how much of each payout, and what they've earned from it. */
export function SplitCard({ t }: { t: Coin }) {
  const n = useNetwork();
  const { data } = useReadContract({
    address: n.feeVault,
    abi: feeVaultAbi,
    chainId: n.chain.id,
    functionName: "earningsOf",
    args: [t.xIds],
    query: { enabled: Boolean(n.feeVault && t.xIds.length), refetchInterval: 10_000 },
  });
  const checks = useHandleChecks(t.handles, t.xIds);
  // Terms were locked in when this coin launched.
  const share = accountsPct(t.creatorTaxBps, t.platformBps);
  const pending = toRecipients(t.feesPending, t.platformBps);
  const [barRef, barIn] = useInView<HTMLDivElement>();
  const shares = t.recipients.map((r) => r.bps / 100);
  const count = shares.length;

  return (
    <section className="card relative isolate overflow-hidden p-4 sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 -z-10 h-52 w-52 rounded-full bg-sky opacity-[0.07] blur-3xl" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow">
            {count} X {count === 1 ? "account" : "accounts"}
          </div>
          <h2 className="display mt-1 text-[28px] leading-none">
            Fee <span className="accent text-neon pr-1">split</span>
          </h2>
        </div>
        <div className="shrink-0 text-right">
          <div className="num text-[20px] font-semibold leading-none text-up-ink">
            <CountUp value={Number(formatEther(t.feesSplit))} format={(v) => ethText(v, 4)} />
          </div>
          <div className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" />
            ETH split
          </div>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        {`${share.toLocaleString("en-US", { maximumFractionDigits: 2 })}% of every trade goes to these accounts`}
        {t.creatorTaxBps ? ` (including the ${t.creatorTaxBps / 100}% creator tax)` : ""}, locked in at launch.
        {pending > 0n ? ` ${formatEth(pending, 5)} ETH more is on its way.` : ""}{" "}
        <Link href="/claim" className="font-medium text-ink underline-offset-2 hover:underline">
          Claim with X →
        </Link>
      </p>

      {/* Each trade's fee drops in at the top and streams into every account's share of the bar. */}
      <Streams shares={shares} />
      <div ref={barRef} className="flex h-4 gap-[3px] overflow-hidden rounded-full bg-card-3 p-[3px]">
        {shares.map((s, i) => (
          <span
            key={i}
            className="h-full min-w-[3px] rounded-full transition-[width] duration-700 ease-out"
            style={{ ...swatch(i), width: barIn ? `calc(${s}% - ${((3 * (count - 1)) / count).toFixed(2)}px)` : "0px", transitionDelay: `${200 + i * 90}ms` }}
          />
        ))}
      </div>

      <ul className="mt-3 divide-y divide-line">
        {t.handles.map((h, i) => {
          const bps = t.recipients[i]?.bps ?? 0;
          const fromToken = (t.accountsEarned * BigInt(bps)) / BPS;
          const check = checks[i];
          return (
            <li key={`${h}:${i}`} className="flex items-center gap-3 py-3 last:pb-0">
              {/* The outer ring is the account's color in the bar (the avatar's own 2px ring sits
                  inside it). Only show a photo once the username is confirmed to still be this account's. */}
              <span className="shrink-0 rounded-full p-1" style={swatch(i)}>
                <XAvatar handle={h} image={check.image} photo={check.status === "current"} size={32} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <a
                    href={xProfileUrlById(t.xIds[i])}
                    target="_blank"
                    rel="noreferrer"
                    title={`Username at launch. Fees go to X account #${t.xIds[i].toString()}, even if it is renamed.`}
                    className="truncate text-[14px] font-semibold hover:underline"
                  >
                    @{h}
                  </a>
                  {check.status === "moved" ? (
                    <span className="chip shrink-0 !text-[11px]">renamed since launch</span>
                  ) : check.status === "missing" ? (
                    <span className="chip shrink-0 !text-[11px]">not found on X right now</span>
                  ) : null}
                </div>
                <div className="num mt-0.5 text-[11px] leading-snug text-ink-2">{formatEth(fromToken, 5)} ETH from this coin</div>
                {data ? <div className="num text-[11px] leading-snug text-ink-3">{formatEth(data[0][i], 5)} ETH unclaimed overall</div> : null}
              </div>
              <span className="num shrink-0 rounded-full px-2 py-1 text-[12px] font-bold leading-none text-[var(--lime-ink)]" style={{ backgroundColor: colorOf(i) }}>
                {pct(bps)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 border-t border-dashed border-line-2 pt-3 text-[11px] leading-relaxed text-ink-3">
        Usernames as of launch. Fees follow each account&apos;s permanent X id, so a rename never moves them. SplitEarn keeps {pct(t.platformBps)} of each payout.
      </p>
    </section>
  );
}

/**
 * The live accent over the bar: one stream per account, fanning out from a single drop to the
 * middle of the account's share, with dashes flowing down it. Drawn at the measured width so the
 * strokes stay crisp; still for visitors who ask for less motion (CSS animations are off then).
 */
function Streams({ shares }: { shares: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setW(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 38;
  const x0 = w / 2;
  let acc = 0;
  const ends = shares.map((s) => {
    const mid = acc + s / 2;
    acc += s;
    return 3 + ((w - 6) * mid) / 100;
  });
  return (
    <div ref={ref} aria-hidden className="mt-4 h-[38px]">
      {w > 0 ? (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block">
          {ends.map((x, i) => {
            const d = `M${x0.toFixed(1)} 8C${x0.toFixed(1)} 24 ${x.toFixed(1)} 20 ${x.toFixed(1)} ${H}`;
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={colorOf(i)} strokeOpacity={0.3} strokeWidth={2} />
                <path
                  d={d}
                  fill="none"
                  stroke={colorOf(i)}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeDasharray="3 9"
                  className="animate-flow"
                  style={{ animationDuration: `${1.3 + (i % 5) * 0.2}s` }}
                />
              </g>
            );
          })}
          <circle cx={x0} cy={7} r={5.5} fill="var(--lime)" stroke="var(--outline)" strokeWidth={1.6} />
        </svg>
      ) : null}
    </div>
  );
}
