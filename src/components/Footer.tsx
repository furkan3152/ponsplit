import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./art/Logo";
import { ArrowIcon } from "./icons";

export function Footer() {
  return (
    <footer className="editorial-footer mt-16">
      <div className="mx-auto max-w-[1240px] px-4 pb-24 pt-7 sm:px-6 lg:pb-8">
        <div className="mb-7 flex items-center justify-between"><Wordmark size={26} textClassName="text-[29px]" /><span className="edition-label">Independent / Solana</span></div>
        <div className="flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between"><div className="footer-creator-word" aria-hidden>Keep<br /><span className="outline-type">creating.</span></div><div className="flex max-w-[360px] flex-wrap items-center gap-x-5 gap-y-4 pb-1 text-[12px] text-ink-2"><Link href="/how" className="hover:text-ink">How it works</Link><Link href="/docs" className="hover:text-ink">Docs</Link><Link href="/create" className="hover:text-ink">Launch</Link><Link href="/claim" className="hover:text-ink">Creator earnings</Link><a href="https://solscan.io" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">Solana explorer <ArrowIcon size={12} className="arrow-diagonal" /></a><ThemeToggle compact /></div></div>
        <div className="mt-6 flex gap-5 text-[12px] text-ink-2"><Link href="/privacy" className="hover:text-ink">Privacy policy</Link><Link href="/terms" className="hover:text-ink">Terms of use</Link><a href="https://github.com/furkan3152" target="_blank" rel="noreferrer" className="hover:text-ink">Operator / contact</a></div>
        <div className="mt-7 flex items-start justify-between gap-5 border-t border-line pt-5"><p className="max-w-[710px] text-[10px] leading-[1.8] text-ink-3">Tiksplit is independent and is not affiliated with TikTok or pump.fun. Creator earnings depend on actual trading activity and are not guaranteed. Coins are speculative; trading can result in loss.</p><div className="mt-1 flex shrink-0 gap-1" aria-hidden><span className="h-2 w-2 bg-lime" /><span className="h-2 w-2 bg-ink" /><span className="h-2 w-2 bg-[var(--coral)]" /></div></div>
      </div>
    </footer>
  );
}
