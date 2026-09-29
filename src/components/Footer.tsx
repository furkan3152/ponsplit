"use client";

import Link from "next/link";
import { useNetwork } from "@/lib/network-context";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./art";
import { FollowX } from "./home/Official";

export function Footer() {
  const n = useNetwork();
  return (
    <footer className="relative mt-8 overflow-hidden border-t border-line">
      <div className="mx-auto max-w-6xl px-4 pb-28 pt-12 sm:px-6 md:pb-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-sm space-y-3">
            <Wordmark size={30} />
            <p className="text-[14px] leading-relaxed text-ink-2">
              One coin, many X accounts. Coins launch on pons and every trade&apos;s creator fee is split between the accounts a coin names, on the curve and after
              it graduates.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <FollowX />
            <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[12px] font-medium text-ink-2">
              <span className={`h-1.5 w-1.5 rounded-full ${n.isTestnet ? "bg-sun" : "animate-pulse-dot bg-lime"}`} aria-hidden />
              {n.chain.name}
            </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[14px] text-ink-2">
            <Link href="/how" className="transition hover:text-ink">
              How it works
            </Link>
            <Link href="/docs" className="transition hover:text-ink">
              Docs
            </Link>
            <Link href="/create" className="transition hover:text-ink">
              Launch
            </Link>
            <Link href="/claim" className="transition hover:text-ink">
              Claim
            </Link>
            {n.faucet ? (
              <a href={n.faucet} target="_blank" rel="noreferrer" className="transition hover:text-ink">
                Testnet faucet ↗
              </a>
            ) : null}
            <a href={n.explorer} target="_blank" rel="noreferrer" className="transition hover:text-ink">
              Explorer ↗
            </a>
            <ThemeToggle />
          </div>
        </div>
        <div className="mt-8 space-y-2 text-[12px] leading-relaxed text-ink-3">
          <p>
            SplitEarn is an independent app built on pons (
            <a href="https://ponsfamily.com" target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-ink-2 hover:underline">
              ponsfamily.com
            </a>
            ). It is not affiliated with, endorsed by or operated by pons.
            {n.ponsIsCopy ? " On testnet, coins launch on SplitEarn's own copy of pons's open-source contracts." : ""}
          </p>
          <p>Experimental software on a {n.isTestnet ? "test network; coins and test ETH have no value" : "live network; trade at your own risk"}.</p>
        </div>
        {/* Filled, fading into the page. An outline would show where the variable font's glyph
            contours overlap (the stem inside the P, the bar of the t). */}
        <div
          aria-hidden
          className="display pointer-events-none mt-4 select-none whitespace-nowrap bg-clip-text text-[21vw] leading-[0.84] text-transparent sm:text-[168px]"
          style={{ backgroundImage: "linear-gradient(to bottom, var(--line-2) 10%, transparent 92%)" }}
        >
          SplitEarn
        </div>
      </div>
    </footer>
  );
}
