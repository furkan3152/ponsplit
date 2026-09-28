import Link from "next/link";
import { activeChain } from "@/lib/chains";
import { FAUCET_URL } from "@/lib/config";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./art";

export function Footer() {
  return (
    <footer className="relative mt-8 overflow-hidden border-t border-line">
      <div className="mx-auto max-w-6xl px-4 pb-28 pt-12 sm:px-6 sm:pb-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-sm space-y-3">
            <Wordmark size={30} />
            <p className="text-[14px] leading-relaxed text-ink-2">
              One coin, many X accounts. Every trade&apos;s fee is split between the accounts a coin names, on the curve and after it graduates.
            </p>
            <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[12px] font-medium text-ink-2">
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" aria-hidden />
              Built on {activeChain.name}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[14px] text-ink-2">
            <Link href="/how" className="transition hover:text-ink">
              How it works
            </Link>
            <Link href="/create" className="transition hover:text-ink">
              Launch
            </Link>
            <Link href="/claim" className="transition hover:text-ink">
              Claim
            </Link>
            {activeChain.testnet ? (
              <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="transition hover:text-ink">
                Testnet faucet ↗
              </a>
            ) : null}
            <a href={activeChain.blockExplorers.default.url} target="_blank" rel="noreferrer" className="transition hover:text-ink">
              Explorer ↗
            </a>
            <ThemeToggle />
          </div>
        </div>
        <p className="mt-8 text-[12px] text-ink-3">
          Experimental software on a {activeChain.testnet ? "test network; tokens have no value" : "live network; trade at your own risk"}.
        </p>
        {/* Filled, fading into the page. An outline would show where the variable font's glyph
            contours overlap (the stem inside the P, the bar of the t). */}
        <div
          aria-hidden
          className="display pointer-events-none mt-4 select-none whitespace-nowrap bg-clip-text text-[21vw] leading-[0.84] text-transparent sm:text-[168px]"
          style={{ backgroundImage: "linear-gradient(to bottom, var(--line-2) 10%, transparent 92%)" }}
        >
          PonSplit
        </div>
      </div>
    </footer>
  );
}
