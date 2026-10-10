import Link from "next/link";
import { explorerUrl } from "@/lib/coin-ui";
import { formatSol, pct, shortAddress } from "@/lib/format";
import { tikTokProfileUrl } from "@/lib/tiktok-config";
import type { Coin } from "@/lib/types";
import { CreatorAvatar } from "./CreatorAvatar";

const COLORS = ["var(--sky)", "var(--pink)", "var(--sun)", "var(--lilac)", "var(--orange)"];

/** The finalized pump.fun shareholders and their portions of the creator fee. */
export function SplitCard({ t }: { t: Coin }) {
  const creatorBps = 10_000 - t.platformBps - t.launcherBps;
  const pendingToCreators = (t.pendingFees * BigInt(creatorBps)) / 10_000n;
  return (
    <section className="card overflow-hidden p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">{t.recipients.length} TikTok {t.recipients.length === 1 ? "creator" : "creators"}</div>
          <h2 className="display mt-1 text-[28px] leading-none">Creator fee split</h2>
        </div>
        <span className="num shrink-0 text-[18px] font-semibold text-up-ink">{formatSol(pendingToCreators, 4)} SOL</span>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{pct(creatorBps)} of this coin&apos;s creator fees is routed to these creator escrows. The pump.fun split was finalized at launch.</p>
      <div aria-hidden className="mt-4 flex h-2 overflow-hidden rounded-full bg-card-3">
        <span style={{ width: `${t.platformBps / 100}%`, backgroundColor: "var(--lime)" }} />
        {t.launcherBps > 0 ? <span style={{ width: `${t.launcherBps / 100}%`, backgroundColor: "var(--ink-3)" }} /> : null}
        {t.recipients.map((r, i) => <span key={r.handle} style={{ width: `${r.shareBps / 100}%`, backgroundColor: COLORS[i % COLORS.length] }} />)}
      </div>
      <ul className="mt-3 divide-y divide-line">
        {t.recipients.map((r) => (
          <li key={r.handle} className="flex items-center gap-3 py-3">
            <CreatorAvatar handle={r.handle} size={34} />
            <div className="min-w-0 flex-1">
              <a href={tikTokProfileUrl(r.handle)} target="_blank" rel="noreferrer" className="block truncate text-[14px] font-semibold hover:underline">@{r.handle} ↗</a>
              <Link href={`/creator/${encodeURIComponent(r.handle)}`} className="mt-0.5 block text-[11px] text-ink-2 hover:underline">{r.verified ? "Wallet bound" : "Wallet not bound"} · View creator</Link>
              <span className="num block text-[11px] text-ink-3">{formatSol((t.pendingFees * BigInt(r.shareBps)) / 10_000n, 5)} SOL waiting in the pump.fun vault</span>
            </div>
            <span className="num shrink-0 text-[13px] font-semibold">{pct(r.shareBps)}</span>
          </li>
        ))}
      </ul>
      <dl className="space-y-2 border-t border-line pt-3 text-[12px]">
        <div className="flex justify-between gap-3"><dt className="text-ink-2">Tiksplit platform</dt><dd className="num">{pct(t.platformBps)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-ink-2">Launcher · <a href={explorerUrl("account", t.creator)} target="_blank" rel="noreferrer" className="hover:underline">{shortAddress(t.creator)}</a></dt><dd className="num">{pct(t.launcherBps)}</dd></div>
      </dl>
      <p className="mt-4 text-[11px] leading-relaxed text-ink-3">Percentages apply to pump.fun&apos;s creator fee, not the full trade. Claims require TikTok verification and a signing wallet through Tiksplit. A listed handle does not imply endorsement.</p>
      <Link href="/claim" className="btn-secondary mt-4 w-full py-2 text-[13px]">Verify your TikTok and claim →</Link>
    </section>
  );
}
