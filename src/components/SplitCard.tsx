"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { githubProfileUrl } from "@/lib/github-handles";
import { formatSol, pct } from "@/lib/format";
import { useClaimable } from "@/lib/hooks";
import type { Coin, GithubRecipient } from "@/lib/types";
import { CountUp, useInView } from "./motion";
import { GithubAvatar } from "./GithubAvatar";

/** The account colors, in order, as on the home page. Accounts past the fifth reuse them, striped. */
const ACCOUNT_COLORS = ["var(--sky)", "var(--pink)", "var(--sun)", "var(--lilac)", "var(--orange)"];
const STRIPES = "repeating-linear-gradient(135deg, transparent 0 3px, rgba(11, 11, 13, 0.3) 3px 5px)";
const colorOf = (i: number) => ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];
const swatch = (i: number): CSSProperties => ({ backgroundColor: colorOf(i), backgroundImage: i >= ACCOUNT_COLORS.length ? STRIPES : undefined });

/** formatSol for a plain number, for the in-between values of a count-up. */
function solText(n: number, digits = 4) {
  if (n <= 0) return "0";
  if (n < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}`;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Who gets this coin's creator fees and how much of each, with what's waiting for them. */
export function SplitCard({ t }: { t: Coin }) {
  const [barRef, barIn] = useInView<HTMLDivElement>();
  const accountsBps = 10_000 - t.platformBps;
  // Shares of the accounts' part, for the bar (Splidev's cut is said below).
  const shares = t.recipients.map((r) => (r.shareBps / accountsBps) * 100);
  const count = shares.length;
  const pendingToAccounts = (t.pendingFees * BigInt(accountsBps)) / 10_000n;

  return (
    <section className="card relative isolate overflow-hidden p-4 sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 -z-10 h-52 w-52 rounded-full bg-sky opacity-[0.07] blur-3xl" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow">
            {count} GitHub {count === 1 ? "account" : "accounts"}
          </div>
          <h2 className="display mt-1 text-[28px] leading-none">
            Fee <span className="accent text-neon pr-1">split</span>
          </h2>
        </div>
        <div className="shrink-0 text-right">
          <div className="num text-[20px] font-semibold leading-none text-up-ink">
            <CountUp value={Number(pendingToAccounts) / 1e9} format={(v) => solText(v, 4)} />
          </div>
          <div className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" />
            SOL waiting to split
          </div>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        {pct(accountsBps)} of this coin&apos;s pump.fun creator fee goes to these developers, set for good at launch: nobody, not even the
        creator or Splidev, can change it.{" "}
        <Link href="/claim" className="font-medium text-ink underline-offset-2 hover:underline">
          Claim with GitHub →
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
        {t.recipients.map((r, i) => (
          <RecipientRow key={r.githubId} r={r} i={i} pending={(t.pendingFees * BigInt(r.shareBps)) / 10_000n} accountsBps={accountsBps} />
        ))}
      </ul>
      <p className="mt-4 border-t border-dashed border-line-2 pt-3 text-[11px] leading-relaxed text-ink-3">
        Fees go to each developer&apos;s pump.fun GitHub account, keyed by the permanent GitHub id, so a rename never moves them. Splidev keeps{" "}
        {pct(t.platformBps)} of the creator fee.
      </p>
    </section>
  );
}

function RecipientRow({ r, i, pending, accountsBps }: { r: GithubRecipient; i: number; pending: bigint; accountsBps: number }) {
  const claimable = useClaimable(r.githubId);
  return (
    <li className="flex items-center gap-3 py-3 last:pb-0">
      {/* The outer ring is the account's color in the bar (the avatar's own 2px ring sits inside it). */}
      <span className="shrink-0 rounded-full p-1" style={swatch(i)}>
        <GithubAvatar id={r.githubId} login={r.login} size={32} />
      </span>
      <div className="min-w-0 flex-1">
        <a
          href={r.login ? githubProfileUrl(r.login) : `https://api.github.com/user/${r.githubId}`}
          target="_blank"
          rel="noreferrer"
          title={`GitHub user #${r.githubId}`}
          className="block truncate text-[14px] font-semibold hover:underline"
        >
          @{r.login ?? `#${r.githubId}`}
        </a>
        <div className="num mt-0.5 text-[11px] leading-snug text-ink-2">{formatSol(pending, 5)} SOL from this coin, waiting to split</div>
        {claimable.data ? <div className="num text-[11px] leading-snug text-ink-3">{formatSol(claimable.data.claimable, 5)} SOL to claim on pump.fun</div> : null}
      </div>
      <span className="num shrink-0 rounded-full px-2 py-1 text-[12px] font-bold leading-none text-[var(--lime-ink)]" style={{ backgroundColor: colorOf(i) }}>
        {pct(Math.round((r.shareBps / accountsBps) * 10_000))}
      </span>
    </li>
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
