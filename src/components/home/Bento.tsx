"use client";

import Link from "next/link";
import { ArrowIcon } from "@/components/icons";
import { CountUp } from "@/components/motion";
import { CreatorAvatar } from "@/components/CreatorAvatar";
import { StateIcon } from "@/components/StateIcon";
import { TokenAvatar } from "@/components/TokenAvatar";
import { coinImage } from "@/lib/coin-ui";
import { compact, formatSol, timeAgo } from "@/lib/format";
import type { Coin, Earner } from "@/lib/types";

export function Panel({ label, href, className = "", children }: { label: string; href?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`card relative flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-[13px]">
        <span className="truncate font-semibold text-ink">{label}</span>
        {href ? <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-ink-2 transition hover:text-ink">View <ArrowIcon size={14} /></Link> : null}
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function CoinStrip({ coins, loading }: { coins: Coin[]; loading: boolean }) {
  if (loading) return <div className="flex gap-3 overflow-hidden p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[228px] w-[168px] shrink-0 animate-pulse rounded-2xl bg-card-2" />)}</div>;
  if (!coins.length) return <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 p-6 text-center"><StateIcon className="h-20 w-20" /><p className="text-[15px] font-semibold">No creator coins listed yet.</p><Link href="/create" className="btn-primary px-4 py-2 text-[13px]">Launch a creator coin</Link></div>;
  return <div className="no-scrollbar flex snap-x gap-3 overflow-x-auto p-4">{coins.map((t) => <CoinCover key={t.token} t={t} />)}</div>;
}

function CoinCover({ t }: { t: Coin }) {
  const img = coinImage(t);
  return (
    <Link href={`/token/${t.token}`} className="group relative h-[228px] w-[168px] shrink-0 snap-start overflow-hidden rounded-2xl border border-line bg-card-2 transition duration-300 hover:-translate-y-1 hover:border-line-2">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />
      ) : <div className="absolute inset-0 grid place-items-center"><TokenAvatar seed={t.token} size={112} /></div>}
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent" aria-hidden />
      {t.createdAt ? <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur">{timeAgo(t.createdAt)}</span> : null}
      <div className="absolute inset-x-0 bottom-0 space-y-1.5 p-3 text-white">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/55 py-0.5 pl-0.5 pr-2 backdrop-blur"><CreatorAvatar handle={t.recipients[0]?.handle} size={18} className="!ring-0" /><span className="truncate text-[11px] font-semibold">@{t.recipients[0]?.handle}</span>{t.recipients.length > 1 ? <span className="text-[10px] text-white/70">+{t.recipients.length - 1}</span> : null}</span>
        <div className="truncate text-[13px] font-semibold">{t.name} <span className="font-mono text-[10px] text-white/60">${t.symbol}</span></div>
        <div className="flex items-baseline gap-2 font-mono text-[11px]"><span className="font-semibold">{compact(t.marketCap)} SOL</span><span className="text-white/55">MC</span><span className="ml-auto font-semibold text-up-ink">{t.graduated ? "pool" : `${Math.floor(t.progress)}%`}</span></div>
      </div>
    </Link>
  );
}

export function Leaderboard({ coins, loading }: { coins: Coin[]; loading: boolean }) {
  if (loading) return <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-[64px] animate-pulse rounded-2xl bg-card-2" />)}</div>;
  if (!coins.length) return <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 p-6 text-center"><StateIcon kind="launch" className="h-20 w-20" /><p className="text-[15px] font-semibold">Nothing graduating yet.</p><p className="max-w-[260px] text-[13px] text-ink-2">Coins that fill their bonding curve move to pump.fun&apos;s pool.</p></div>;
  return <ul className="space-y-2 p-4">{coins.slice(0, 4).map((t) => <li key={t.token}><Link href={`/token/${t.token}`} className="flex items-center gap-3 rounded-2xl border border-line bg-card-2 px-4 py-3 transition hover:border-line-2"><div className="min-w-0 flex-1"><div className="truncate text-[15px] font-semibold">{t.name} <span className="font-mono text-[11px] text-ink-3">${t.symbol}</span></div><div className="truncate text-[12.5px] text-ink-2">supports {t.recipients.map((r) => `@${r.handle}`).join(", ")}</div></div><span className={`num shrink-0 text-[15px] font-semibold ${t.graduated ? "text-up-ink" : ""}`}>{t.graduated ? "✓" : `${Math.floor(t.progress)}%`}</span></Link></li>)}</ul>;
}

export function EarnedTotal({ earners, coins }: { earners?: Earner[]; coins?: number }) {
  const earned = earners?.reduce((sum, e) => sum + e.claimable + e.claimed, 0n);
  return (
    <div className="flex h-full flex-col justify-between gap-6 p-5">
      <div><div className="eyebrow">Creator escrow earnings</div><div className="num mt-2 text-[40px] font-semibold leading-none tracking-tight"><CountUp value={earned !== undefined ? Number(earned) / 1e9 : undefined} format={(v) => `${v.toFixed(3)} SOL`} /></div><p className="mt-2 text-[13px] text-ink-2">Claimed SOL plus the current claimable balances of listed creator escrows, read from Solana. Undistributed pump.fun vault fees are shown on each coin.</p></div>
      <dl className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-card-2 px-3 py-2.5"><dt className="eyebrow">Coins</dt><dd className="num mt-1 text-[18px] font-semibold"><CountUp value={coins} format={(v) => compact(Math.round(v))} /></dd></div><div className="rounded-2xl bg-card-2 px-3 py-2.5"><dt className="eyebrow">Creators</dt><dd className="num mt-1 text-[18px] font-semibold"><CountUp value={earners?.length} format={(v) => compact(Math.round(v))} /></dd></div></dl>
    </div>
  );
}

export function TopEarners({ earners }: { earners: Earner[] }) {
  if (!earners.length) return <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center"><p className="text-[15px] font-semibold">No creator balances listed yet.</p><p className="max-w-[240px] text-[13px] text-ink-2">Creators appear here when their on-chain escrows are available.</p></div>;
  const [top, ...rest] = earners;
  return (
    <div className="space-y-3 p-5">
      <div className="eyebrow">Creator spotlight</div>
      <Link href={`/creator/${encodeURIComponent(top.handle)}`} className="flex items-center gap-3 rounded-2xl border border-line bg-card-2 p-3 transition hover:border-line-2"><CreatorAvatar handle={top.handle} size={44} /><div className="min-w-0"><div className="truncate text-[15px] font-semibold">@{top.handle}</div><div className="text-[12px] text-ink-3">{top.verified ? "Wallet bound" : "Awaiting verification"}</div></div></Link>
      <div className="num text-[30px] font-semibold leading-none">{formatSol(top.claimable + top.claimed, 4)} SOL</div>
      <div className="text-[12.5px] text-ink-2">claimed + claimable · {top.coins} creator coin{top.coins === 1 ? "" : "s"}</div>
      {rest.length ? <ul className="space-y-1.5 border-t border-line pt-3">{rest.slice(0, 3).map((e) => <li key={e.handle}><Link href={`/creator/${encodeURIComponent(e.handle)}`} className="flex items-center gap-2 text-[13px] hover:underline"><CreatorAvatar handle={e.handle} size={22} /><span className="truncate">@{e.handle}</span><span className="num ml-auto text-ink-2">{formatSol(e.claimable + e.claimed, 4)} SOL</span></Link></li>)}</ul> : null}
    </div>
  );
}

export function FeePath({ platformPct }: { platformPct: number }) {
  const rows = [["Trade", "pump.fun applies its protocol and creator fees"], ["Creators", "creator fee minus platform and optional launcher shares"], ["Launcher", "0–10% of the creator fee, chosen at launch"], ["Platform", `${platformPct}% of the creator fee to Tiksplit`], ["Claim", "TikTok verification + wallet signing"], ["Fixed", "pump.fun split finalized at launch"]];
  return <dl className="space-y-3 p-5 text-[12px]">{rows.map(([label, text]) => <div key={label} className="flex gap-3"><dt className="w-16 shrink-0 font-semibold text-ink-3">{label}</dt><dd className="text-ink">{text}</dd></div>)}</dl>;
}
