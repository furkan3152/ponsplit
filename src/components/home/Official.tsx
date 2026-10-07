"use client";

import Link from "next/link";
import { useState } from "react";
import { LogoMark } from "@/components/art";
import { ArrowIcon, XLogo } from "@/components/icons";
import { TokenAvatar } from "@/components/TokenAvatar";
import { OFFICIAL_TOKEN, X_HANDLE, X_URL, isOfficial } from "@/lib/brand";
import { coinImage, pumpUrl } from "@/lib/coin-ui";
import { useCoins } from "@/lib/hooks";

/** Follow Splitdev on X: a small sticker button (hidden until the account exists). */
export function FollowX({ className = "" }: { className?: string }) {
  if (!X_URL) return null;
  return (
    <a
      href={X_URL}
      target="_blank"
      rel="noreferrer"
      className={`group/x inline-flex shrink-0 items-center gap-2 rounded-full border border-line-2 bg-card px-3.5 py-2 text-[13px] font-semibold text-ink transition hover:border-ink hover:bg-card-2 ${className}`}
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-paper transition-transform duration-300 group-hover/x:-rotate-12">
        <XLogo size={12} />
      </span>
      @{X_HANDLE}
    </a>
  );
}

/**
 * The official Splitdev token on the home page: its mint address (CA) with a copy button once it's
 * launched, "coming soon" until then. A Splitdev coin trades here; any other pump.fun coin on pump.fun.
 */
export function OfficialToken() {
  const { data: coins } = useCoins();
  const coin = coins?.find((c) => isOfficial(c.token));
  const symbol = coin?.symbol;
  const logo = coin ? coinImage(coin) : undefined;
  const onPump = Boolean(OFFICIAL_TOKEN) && coins !== undefined && !coin;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!OFFICIAL_TOKEN) return;
    try {
      await navigator.clipboard.writeText(OFFICIAL_TOKEN);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the address is selectable on the card
    }
  };
  return (
    <section className="card relative mx-auto w-full max-w-2xl overflow-hidden p-4 text-left sm:p-5">
      {/* a lime corner glow, like the stickers' shine */}
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-lime opacity-[0.08] blur-2xl" />
      <div className="flex flex-wrap items-center gap-3">
        {logo && OFFICIAL_TOKEN ? (
          <TokenAvatar src={logo} seed={OFFICIAL_TOKEN} size={44} className="rounded-2xl" />
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-card-2">
            <LogoMark size={34} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Official token</div>
          <div className="display truncate text-[22px] leading-tight">{symbol ? `$${symbol}` : "Splitdev"}</div>
        </div>
        <FollowX />
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-dashed border-line-2 bg-card-2 p-2 pl-2.5">
        <span className="shrink-0 rounded-lg bg-lime px-2 py-1 font-mono text-[11px] font-bold tracking-[0.08em] text-[var(--lime-ink)]">CA</span>
        {OFFICIAL_TOKEN ? (
          <>
            <span className="num min-w-0 flex-1 select-all truncate text-[13px] text-ink sm:text-[14px]" title={OFFICIAL_TOKEN}>
              {OFFICIAL_TOKEN}
            </span>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-xl border border-line-2 bg-card px-3 py-1.5 text-[12px] font-semibold transition hover:border-ink"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[13px] text-ink-2">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full bg-sun" aria-hidden />
            Coming soon
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          The only official address is the one shown here{X_HANDLE ? ` and posted by @${X_HANDLE} on X` : ""}. Anything else is not us.
        </p>
        {onPump && OFFICIAL_TOKEN ? (
          <a href={pumpUrl(OFFICIAL_TOKEN)} target="_blank" rel="noreferrer" className="group/l inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-ink">
            Trade it on pump.fun ↗
          </a>
        ) : coin ? (
          <Link href={`/token/${OFFICIAL_TOKEN}`} className="group/l inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-ink">
            Trade it
            <ArrowIcon size={14} className="transition-transform group-hover/l:translate-x-0.5" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}
