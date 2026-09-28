"use client";

import Link from "next/link";
import { formatEther } from "viem";
import { ClaimArt, TokenSticker } from "@/components/art";
import { ArrowIcon } from "@/components/icons";
import { CountUp } from "@/components/motion";
import { XAvatar } from "@/components/XAvatar";
import { coinImage } from "@/lib/coin-ui";
import { compact, formatEth, shortAddress, timeAgo } from "@/lib/format";
import { useXProfiles, type Payout } from "@/lib/hooks";
import { explorerLink, type Network } from "@/lib/networks";
import type { Coin } from "@/lib/types";

/** A bento card: a label at the foot and an "Open" link, like the reference's panels. */
export function Panel({
  label,
  href,
  className = "",
  children,
}: {
  label: string;
  href?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`card relative flex flex-col overflow-hidden ${className}`}>
      <div className="relative min-h-0 flex-1">{children}</div>
      <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px]">
        <span className="font-medium text-ink-2">{label}</span>
        {href ? (
          <Link href={href} className="group/open inline-flex items-center gap-1 font-medium text-ink-2 transition hover:text-ink">
            Open <ArrowIcon size={14} className="transition-transform group-hover/open:translate-x-0.5" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** Coin covers, big and photographic when the coin has an image, its sticker when it doesn't. */
export function CoinStrip({ coins, loading }: { coins: Coin[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex gap-3 overflow-hidden p-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[228px] w-[168px] shrink-0 animate-pulse rounded-2xl bg-card-2" />
        ))}
      </div>
    );
  }
  if (!coins.length) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="flex -space-x-3">
          {["a", "b", "c"].map((s, i) => (
            <TokenSticker key={s} seed={`empty-${s}`} size={56} className={i === 1 ? "-translate-y-2" : ""} />
          ))}
        </div>
        <p className="text-[15px] font-semibold">No coins on this network yet.</p>
        <Link href="/create" className="btn-primary px-4 py-2 text-[13px]">
          Launch the first one
        </Link>
      </div>
    );
  }
  return (
    <div className="no-scrollbar flex snap-x gap-3 overflow-x-auto p-4">
      {coins.map((t) => (
        <CoinCover key={t.token} t={t} />
      ))}
    </div>
  );
}

function CoinCover({ t }: { t: Coin }) {
  const img = coinImage(t);
  return (
    <Link
      href={`/token/${t.token}`}
      className="group relative h-[228px] w-[168px] shrink-0 snap-start overflow-hidden rounded-2xl border border-line bg-card-2 transition duration-300 hover:-translate-y-1 hover:border-line-2"
    >
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_35%,var(--card-3),var(--card-2))]">
          <TokenSticker seed={t.token} size={112} className="transition duration-500 group-hover:-rotate-6 group-hover:scale-105" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent" aria-hidden />
      <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur">{timeAgo(t.createdAt)}</span>
      <div className="absolute inset-x-0 bottom-0 space-y-1.5 p-3 text-white">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/55 py-0.5 pl-0.5 pr-2 backdrop-blur">
          <XAvatar handle={t.handles[0]} size={18} photo={false} className="!ring-0" />
          <span className="truncate text-[11px] font-semibold">@{t.handles[0]}</span>
          {t.handles.length > 1 ? <span className="text-[10px] text-white/70">+{t.handles.length - 1}</span> : null}
        </span>
        <div className="truncate text-[13px] font-semibold">
          {t.name} <span className="font-mono text-[10px] text-white/60">{t.symbol}</span>
        </div>
        <div className="flex items-baseline gap-2 font-mono text-[11px]">
          <span className="font-semibold">{compact(t.marketCap)} Ξ</span>
          <span className="text-white/55">MC</span>
          <span className="ml-auto font-semibold text-[#9dffb8]">{formatEth(t.feesSplit, 3)}</span>
          <span className="text-white/55">split</span>
        </div>
      </div>
    </Link>
  );
}

/** The latest payouts: an X account claiming its share, with the wallet it went to. */
export function PayoutFeed({ n, payouts, loading }: { n: Network; payouts: Payout[]; loading: boolean }) {
  const handles = payouts.map((p) => p.handle).filter((h): h is string => Boolean(h));
  const profiles = useXProfiles(Array.from(new Set(handles)));
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-[64px] animate-pulse rounded-2xl bg-card-2" />
        ))}
      </div>
    );
  }
  if (!payouts.length) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 p-6 text-center">
        <ClaimArt className="h-[96px] w-auto" />
        <p className="text-[15px] font-semibold">No payouts yet.</p>
        <p className="max-w-[260px] text-[13px] text-ink-2">When an X account claims its share of a coin&apos;s fees, it shows up here.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2 p-4">
      {payouts.slice(0, 4).map((p) => {
        const prof = p.handle ? profiles.data?.[p.handle] : undefined;
        return (
          <li key={`${p.txHash}-${p.xId}`}>
            <a
              href={explorerLink(n, "tx", p.txHash)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-2xl border border-line bg-card-2 px-4 py-3 transition hover:border-line-2"
            >
              <div className="min-w-0 flex-1">
                <div className="num text-[20px] font-semibold leading-tight">{formatEth(p.amount, 4)} Ξ</div>
                <div className="truncate text-[12.5px] text-ink-2">
                  claimed by <span className="font-semibold text-ink">{p.handle ? `@${p.handle}` : `account #${p.xId}`}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {p.handle ? (
                  <XAvatar handle={p.handle} image={prof?.image} photo={Boolean(prof && prof.id === p.xId.toString())} size={30} />
                ) : (
                  <TokenSticker seed={`x:${p.xId}`} size={30} className="rounded-full" />
                )}
                <span className="text-ink-3" aria-hidden>
                  ⇄
                </span>
                <TokenSticker seed={`wallet:${p.to}`} size={30} className="rounded-full" />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-[11px] text-ink-3">{p.timestamp ? timeAgo(p.timestamp) : ""}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** One big number: everything split to X accounts so far, and what's behind it. */
export function SplitTotal({ split, coins, volume24h }: { split?: bigint; coins?: bigint; volume24h?: bigint }) {
  return (
    <div className="flex h-full flex-col justify-between gap-6 p-5">
      <div>
        <div className="eyebrow">Split to X accounts</div>
        <div className="num mt-2 text-[40px] font-semibold leading-none tracking-tight">
          <CountUp value={split !== undefined ? Number(formatEther(split)) : undefined} format={(v) => `${v.toFixed(4)} Ξ`} />
        </div>
        <p className="mt-2 text-[13px] text-ink-2">Every creator fee since launch, on the curve and in the pools.</p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-card-2 px-3 py-2.5">
          <dt className="eyebrow">Coins</dt>
          <dd className="num mt-1 text-[18px] font-semibold">
            <CountUp value={coins !== undefined ? Number(coins) : undefined} format={(v) => compact(Math.round(v))} />
          </dd>
        </div>
        <div className="rounded-2xl bg-card-2 px-3 py-2.5">
          <dt className="eyebrow">24h volume</dt>
          <dd className="num mt-1 text-[18px] font-semibold">
            <CountUp value={volume24h !== undefined ? Number(formatEther(volume24h)) : undefined} format={(v) => `${compact(v, 3)} Ξ`} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** The X accounts coins pay the most, with their real profile photos. */
export function TopEarners({ earners }: { earners: { handle: string; xId: bigint; earned: bigint; coins: number }[] }) {
  const profiles = useXProfiles(earners.map((e) => e.handle));
  if (!earners.length) {
    return (
      <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-[15px] font-semibold">Nobody is earning yet.</p>
        <p className="max-w-[240px] text-[13px] text-ink-2">Launch a coin for your favourite accounts and they start earning from its first trade.</p>
      </div>
    );
  }
  const [top, ...rest] = earners;
  const tp = profiles.data?.[top.handle];
  const photo = (h: string, id: bigint) => {
    const p = profiles.data?.[h];
    return { image: p?.image, ok: Boolean(p && p.id === id.toString()) };
  };
  return (
    <div className="space-y-3 p-5">
      <div className="eyebrow">Paying out</div>
      <a
        href={`https://x.com/${top.handle}`}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 rounded-2xl border border-line bg-card-2 p-3 transition hover:border-line-2"
      >
        <XAvatar handle={top.handle} image={photo(top.handle, top.xId).image} photo={photo(top.handle, top.xId).ok} size={44} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{tp?.name || `@${top.handle}`}</div>
          <div className="truncate font-mono text-[12px] text-ink-3">@{top.handle}</div>
        </div>
      </a>
      <div className="num text-[30px] font-semibold leading-none">{formatEth(top.earned, 4)} Ξ</div>
      <div className="text-[12.5px] text-ink-2">
        earned from {top.coins} coin{top.coins === 1 ? "" : "s"}
      </div>
      {rest.length ? (
        <ul className="space-y-1.5 border-t border-line pt-3">
          {rest.slice(0, 3).map((e) => (
            <li key={e.xId.toString()} className="flex items-center gap-2 text-[13px]">
              <XAvatar handle={e.handle} image={photo(e.handle, e.xId).image} photo={photo(e.handle, e.xId).ok} size={22} />
              <span className="truncate">@{e.handle}</span>
              <span className="num ml-auto text-ink-2">{formatEth(e.earned, 4)} Ξ</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Where a fee goes, with the live contracts: the reference's "detection" panel, for pons. */
export function FeePath({ n, platformPct }: { n: Network; platformPct: number }) {
  const rows: [string, string][] = [
    ["1%", "pons fee on every trade"],
    ["30%", "of it to pons"],
    ["70%", "to the coin's creator fee → SplitEarn"],
    [`${100 - platformPct}%`, "of that to the X accounts"],
    [`${platformPct}%`, "of that to SplitEarn"],
    ["0-10%", "creator tax, 100% to the accounts"],
  ];
  const contracts: [string, string | undefined][] = [
    [n.ponsIsCopy ? "pons factory (copy)" : "pons factory", n.ponsFactory],
    ["launcher", n.launcher],
    ["fee vault", n.feeVault],
  ];
  return (
    <div className="p-5 font-mono text-[12px]">
      <table className="w-full">
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={b}>
              <td className="w-16 py-1 pr-3 text-ink-3">{a}</td>
              <td className="py-1 text-ink">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="eyebrow mt-4">Contracts</div>
      <ul className="mt-1.5 space-y-1">
        {contracts.map(([label, a]) => (
          <li key={label} className="flex justify-between gap-2">
            <span className="text-ink-3">{label}</span>
            {a ? (
              <a href={explorerLink(n, "address", a)} target="_blank" rel="noreferrer" className="text-ink-2 underline-offset-2 hover:text-ink hover:underline">
                {shortAddress(a)}
              </a>
            ) : (
              <span className="text-ink-3">not deployed</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
