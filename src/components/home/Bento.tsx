"use client";

import Link from "next/link";
import { ClaimArt, TokenSticker } from "@/components/art";
import { ArrowIcon } from "@/components/icons";
import { CountUp } from "@/components/motion";
import { GithubAvatar } from "@/components/GithubAvatar";
import { coinImage } from "@/lib/coin-ui";
import { githubProfileUrl } from "@/lib/github-handles";
import { compact, formatSol, timeAgo } from "@/lib/format";
import type { Coin, Earner } from "@/lib/types";

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
        <p className="text-[15px] font-semibold">No coins yet.</p>
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
      {t.createdAt ? <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur">{timeAgo(t.createdAt)}</span> : null}
      <div className="absolute inset-x-0 bottom-0 space-y-1.5 p-3 text-white">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/55 py-0.5 pl-0.5 pr-2 backdrop-blur">
          <GithubAvatar id={t.recipients[0]?.githubId} login={t.recipients[0]?.login} size={18} className="!ring-0" />
          <span className="truncate text-[11px] font-semibold">@{t.recipients[0]?.login ?? t.recipients[0]?.githubId}</span>
          {t.recipients.length > 1 ? <span className="text-[10px] text-white/70">+{t.recipients.length - 1}</span> : null}
        </span>
        <div className="truncate text-[13px] font-semibold">
          {t.name} <span className="font-mono text-[10px] text-white/60">{t.symbol}</span>
        </div>
        <div className="flex items-baseline gap-2 font-mono text-[11px]">
          <span className="font-semibold">{compact(t.marketCap)} SOL</span>
          <span className="text-white/55">MC</span>
          <span className="ml-auto font-semibold text-[#9dffb8]">{t.graduated ? "graduated" : `${Math.floor(t.progress)}%`}</span>
        </div>
      </div>
    </Link>
  );
}

/** The coins closest to graduating, with their GitHub developers. */
export function Leaderboard({ coins, loading }: { coins: Coin[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-[64px] animate-pulse rounded-2xl bg-card-2" />
        ))}
      </div>
    );
  }
  if (!coins.length) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 p-6 text-center">
        <ClaimArt className="h-[96px] w-auto" />
        <p className="text-[15px] font-semibold">Nothing graduating yet.</p>
        <p className="max-w-[260px] text-[13px] text-ink-2">Coins that fill their bonding curve move to pump.fun&apos;s pool and show up here.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2 p-4">
      {coins.slice(0, 4).map((t) => (
        <li key={t.token}>
          <Link href={`/token/${t.token}`} className="flex items-center gap-3 rounded-2xl border border-line bg-card-2 px-4 py-3 transition hover:border-line-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">
                {t.name} <span className="font-mono text-[11px] text-ink-3">${t.symbol}</span>
              </div>
              <div className="truncate text-[12.5px] text-ink-2">pays {t.recipients.map((r) => `@${r.login ?? r.githubId}`).join(", ")}</div>
            </div>
            <span className={`num shrink-0 text-[15px] font-semibold ${t.graduated ? "text-up-ink" : ""}`}>{t.graduated ? "✓" : `${Math.floor(t.progress)}%`}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One big number: what the GitHub accounts behind Splidev coins have earned on pump.fun. */
export function EarnedTotal({ earners, coins }: { earners?: Earner[]; coins?: number }) {
  const earned = earners?.reduce((a, e) => a + e.claimable + e.claimed, 0n);
  const devs = earners?.length;
  return (
    <div className="flex h-full flex-col justify-between gap-6 p-5">
      <div>
        <div className="eyebrow">Earned by GitHub devs</div>
        <div className="num mt-2 text-[40px] font-semibold leading-none tracking-tight">
          <CountUp value={earned !== undefined ? Number(earned) / 1e9 : undefined} format={(v) => `${v.toFixed(3)} SOL`} />
        </div>
        <p className="mt-2 text-[13px] text-ink-2">In their pump.fun GitHub accounts: claimed plus waiting, from every coin that pays them.</p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-card-2 px-3 py-2.5">
          <dt className="eyebrow">Coins</dt>
          <dd className="num mt-1 text-[18px] font-semibold">
            <CountUp value={coins} format={(v) => compact(Math.round(v))} />
          </dd>
        </div>
        <div className="rounded-2xl bg-card-2 px-3 py-2.5">
          <dt className="eyebrow">Developers</dt>
          <dd className="num mt-1 text-[18px] font-semibold">
            <CountUp value={devs} format={(v) => compact(Math.round(v))} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** The GitHub accounts Splidev coins pay, by what they have earned on pump.fun. */
export function TopEarners({ earners }: { earners: Earner[] }) {
  if (!earners.length) {
    return (
      <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-[15px] font-semibold">Nobody is earning yet.</p>
        <p className="max-w-[240px] text-[13px] text-ink-2">Launch a coin for the developers you love and they start earning from its first trade.</p>
      </div>
    );
  }
  const [top, ...rest] = earners;
  const name = (e: Earner) => e.login ?? `#${e.githubId}`;
  return (
    <div className="space-y-3 p-5">
      <div className="eyebrow">Paying out</div>
      <a
        href={top.login ? githubProfileUrl(top.login) : undefined}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 rounded-2xl border border-line bg-card-2 p-3 transition hover:border-line-2"
      >
        <GithubAvatar id={top.githubId} login={top.login} size={44} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">@{name(top)}</div>
          <div className="truncate font-mono text-[12px] text-ink-3">GitHub</div>
        </div>
      </a>
      <div className="num text-[30px] font-semibold leading-none">{formatSol(top.claimable + top.claimed, 4)} SOL</div>
      <div className="text-[12.5px] text-ink-2">
        earned on pump.fun · {top.coins} Splidev coin{top.coins === 1 ? "" : "s"}
      </div>
      {rest.length ? (
        <ul className="space-y-1.5 border-t border-line pt-3">
          {rest.slice(0, 3).map((e) => (
            <li key={e.githubId} className="flex items-center gap-2 text-[13px]">
              <GithubAvatar id={e.githubId} login={e.login} size={22} />
              <span className="truncate">@{name(e)}</span>
              <span className="num ml-auto text-ink-2">{formatSol(e.claimable + e.claimed, 4)} SOL</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Where a fee goes: pump.fun's fees, then the creator part's split. */
export function FeePath({ platformPct }: { platformPct: number }) {
  const rows: [string, string][] = [
    ["fee", "pump.fun's fee on every trade"],
    ["part", "of it is the coin's creator fee"],
    [`${100 - platformPct}%`, "of that to the GitHub devs"],
    [`${platformPct}%`, "of that to Splidev"],
    ["∞", "fixed at launch, nobody can change it"],
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
    </div>
  );
}
