import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./art/Logo";

export function Footer() {
  return (
    <footer className="mt-14 border-t border-line">
      <div className="mx-auto max-w-[1240px] px-4 pb-24 pt-8 sm:px-6 lg:pb-8">
        <div className="flex flex-col gap-7 sm:flex-row sm:justify-between">
          <div className="max-w-sm"><Wordmark size={28} /><p className="mt-3 text-[13px] leading-relaxed text-ink-2">A home for creator coins. Launch on pump.fun, allocate creator fees and let TikTok creators claim their share in SOL.</p></div>
          <div className="flex flex-wrap items-start gap-x-5 gap-y-3 pt-1 text-[12px] text-ink-2"><Link href="/how" className="hover:text-ink">How it works</Link><Link href="/docs" className="hover:text-ink">Docs</Link><Link href="/create" className="hover:text-ink">Launch</Link><Link href="/claim" className="hover:text-ink">Creator earnings</Link><ThemeToggle compact /></div>
        </div>
        <div className="mt-7 flex flex-col gap-3 border-t border-line pt-5 text-[11px] leading-relaxed text-ink-3 md:flex-row md:justify-between">
          <p className="max-w-xl">Tiksplit is independent and is not affiliated with TikTok or pump.fun. Creator earnings depend on actual trading activity and are not guaranteed. Coins are speculative; trading can result in loss.</p>
          <a href="https://solscan.io" target="_blank" rel="noreferrer" className="shrink-0 hover:text-ink-2">Explore Solana ↗</a>
        </div>
      </div>
    </footer>
  );
}
