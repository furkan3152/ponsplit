import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { HowItWorks } from "@/components/HowItWorks";
import { StepLaunch } from "@/components/art";
import { Avatar, C, type FaceKind, type Hair } from "@/components/art/parts";
import { Reveal } from "@/components/motion";
import { activeChain } from "@/lib/chains";
import { FAUCET_URL } from "@/lib/config";

export const metadata: Metadata = { title: "How it works" };

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Where do the fees come from?",
    a: "Every buy and sell pays a 1% fee. 80% of it is split between the coin's X accounts by the shares set at launch; 20% goes to the protocol. The split never changes after launch.",
  },
  {
    q: "What happens when the curve sells out?",
    a: "The coin graduates: the ETH it raised and the remaining 20.7% of supply seed its PonSwap pool. That liquidity is locked forever and trading continues right on the coin page, still paying the same accounts.",
  },
  {
    q: "How do X accounts get paid?",
    a: "Fees are held by the FeeVault contract under each account's permanent X user id, so renaming an account never loses its earnings. On the Claim page the owner proves the account is theirs by posting a one-time code (or signing in with X), then sends everything to any wallet.",
  },
  {
    q: "Can someone claim fees for an account they don't own?",
    a: "A claim needs a signature that is only issued after that account itself posts one exact sentence naming the destination wallet in full, plus a one-time code (or signs in with X). Replies, quotes and reposts never count, and a code that only appears inside some other post is ignored. Copying someone’s post gets you nothing: it names their wallet, not yours. Never post a proof text someone else sends you.",
  },
  {
    q: "Do the X accounts need to do anything to be added?",
    a: "No. Any public X account can be added. Their earnings wait in the vault until they choose to claim.",
  },
  {
    q: "Which network is this?",
    a: (
      <>
        {activeChain.name} (chain id {activeChain.id}).{" "}
        {activeChain.testnet ? (
          <>
            Test ETH is free from the{" "}
            <a className="underline" href={FAUCET_URL} target="_blank" rel="noreferrer">
              faucet
            </a>
            ; tokens here have no value.
          </>
        ) : null}
      </>
    ),
  },
];

const CHAPTERS = [
  { id: "steps", n: "01", title: "Three steps" },
  { id: "fees", n: "02", title: "Where the fee goes" },
  { id: "faq", n: "03", title: "Questions" },
] as const;

type Account = { handle: string; share: number; color: string; hair: Hair; hairColor: string; face: FaceKind };

/** The example coin pays the same five accounts as the split machine on the home page. */
const ACCOUNTS: Account[] = [
  { handle: "ada", share: 40, color: C.sky, hair: 0, hairColor: C.sun, face: "happy" },
  { handle: "kofi", share: 25, color: C.pink, hair: 3, hairColor: C.lilac, face: "joy" },
  { handle: "mei", share: 15, color: C.sun, hair: 1, hairColor: C.green, face: "happy" },
  { handle: "noor", share: 10, color: C.lilac, hair: 2, hairColor: C.orange, face: "joy" },
  { handle: "sol", share: 10, color: C.orange, hair: 4, hairColor: C.sky, face: "happy" },
];

// The same numbers the FAQ states: 1% of every trade, 80% of that to the accounts, 20% to the protocol.
const TRADE_ETH = 1;
const FEE_PCT = 1;
const ACCOUNTS_PCT = 80;
const eth = (n: number) => `${n.toFixed(4)} ETH`;

/*
 * The fee diagram builds itself once it scrolls into view (the <Reveal> around it gets `is-in`).
 * Parts are only hidden while JavaScript runs, so nothing stays invisible without it, and reduced
 * motion drops the staggered delays so everything appears at once.
 */
const FADE = "transition-opacity duration-500 ease-out motion-reduce:!delay-0 [.js_&]:opacity-0 [.js_.is-in_&]:opacity-100";
const WIPE =
  "transition-[clip-path] duration-700 ease-out motion-reduce:!delay-0 [.js_&]:[clip-path:inset(0_100%_0_0)] [.js_.is-in_&]:[clip-path:inset(0)]";
const RISE =
  "transition duration-500 ease-out motion-reduce:!delay-0 [.js_&]:translate-y-2 [.js_&]:opacity-0 [.js_.is-in_&]:translate-y-0 [.js_.is-in_&]:opacity-100";

/** One exclusive accordion; the answer's height animates where the browser can (::details-content). */
const ACCORDION =
  "group [interpolate-size:allow-keywords] [&::details-content]:h-0 [&::details-content]:overflow-hidden [&::details-content]:transition-[height,content-visibility] [&::details-content]:duration-500 [&::details-content]:ease-[cubic-bezier(0.2,0.8,0.2,1)] [&::details-content]:[transition-behavior:allow-discrete] [&[open]::details-content]:h-auto motion-reduce:[&::details-content]:transition-none";

export default function HowPage() {
  return (
    <div className="space-y-20 sm:space-y-28">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative">
        <div aria-hidden className="bg-grid pointer-events-none absolute -inset-x-4 -top-10 -z-10 h-[480px] sm:-inset-x-6" />
        <div className="grid gap-10 pt-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-end md:gap-14 md:pt-10">
          <div>
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" aria-hidden />
                The guide · 3 min read
              </span>
            </Reveal>
            <Reveal as="h1" delay={60} className="display mt-6 text-[52px] leading-[0.9] sm:text-[84px]">
              How PonSplit <span className="accent text-neon pr-2">works.</span>
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-ink-2 sm:text-[18px]">
                One coin, many X accounts, fees split automatically. Here is the whole thing in three steps.
              </p>
            </Reveal>
          </div>
          <Reveal delay={220}>
            <nav aria-label="On this page" className="card overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
                <span className="eyebrow">In this guide</span>
                <span className="font-mono text-[11px] text-ink-3">{CHAPTERS.length} parts</span>
              </div>
              <ol className="divide-y divide-[var(--line)]">
                {CHAPTERS.map((c) => (
                  <li key={c.id}>
                    <a href={`#${c.id}`} className="group flex items-center gap-4 px-5 py-4 transition-colors duration-200 hover:bg-card-2">
                      <span className="num text-[12px] text-ink-3 transition-colors group-hover:text-ink">{c.n}</span>
                      <span className="flex-1 text-[16px] font-semibold">{c.title}</span>
                      <span aria-hidden className="text-ink-3 transition duration-300 group-hover:translate-y-0.5 group-hover:text-ink">
                        ↓
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </Reveal>
        </div>
      </section>

      {/* ── 01 · The three steps ─────────────────────────────────────────── */}
      <section id="steps" className="scroll-mt-24 space-y-8">
        <ChapterHead n="01" kicker="Three steps" title="From launch to payout" />
        <HowItWorks />
      </section>

      {/* ── 02 · Where the fee goes ──────────────────────────────────────── */}
      <section id="fees" className="scroll-mt-24 space-y-8">
        <ChapterHead n="02" kicker="The money" title="Where the fee goes">
          Every buy and every sell pays a 1% fee, on the bonding curve and in the PonSwap pool after graduation. Here is one trade&apos;s fee, followed all the way down.
        </ChapterHead>
        <FeeFlow />
      </section>

      {/* ── 03 · Questions ───────────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-24">
        <div className="grid gap-8 border-t border-line pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)] lg:gap-14">
          <Reveal className="lg:sticky lg:top-24 lg:self-start">
            <Kicker n="03">Questions</Kicker>
            <h2 className="display mt-3 text-[36px] leading-[0.95] sm:text-[48px]">Good questions</h2>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-ink-2">The short answers to what people ask first. Tap one to open it.</p>
          </Reveal>
          <div className="card divide-y divide-[var(--line)] overflow-hidden">
            {FAQ.map((f, i) => (
              <Reveal key={f.q} delay={i * 60}>
                <details name="faq" className={ACCORDION}>
                  <summary className="flex min-h-[64px] cursor-pointer list-none items-center gap-4 px-5 py-4 transition-colors duration-200 hover:bg-card-2 focus-visible:bg-card-2 focus-visible:outline-none sm:px-6 [&::-webkit-details-marker]:hidden">
                    <span className="num w-6 shrink-0 text-[12px] text-ink-3 transition-colors group-open:text-ink">{String(i + 1).padStart(2, "0")}</span>
                    <span className="flex-1 text-[16px] font-semibold leading-snug sm:text-[17px]">{f.q}</span>
                    <span
                      aria-hidden
                      className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-2 text-ink-2 transition duration-300 ease-out group-open:rotate-[135deg] group-open:border-transparent group-open:bg-lime group-open:text-[var(--lime-ink)]"
                    >
                      <span className="absolute h-[1.5px] w-3 rounded-full bg-current" />
                      <span className="absolute h-3 w-[1.5px] rounded-full bg-current" />
                    </span>
                  </summary>
                  <div className="px-5 pb-6 text-[15px] leading-relaxed text-ink-2 group-open:animate-slide-up sm:pl-[4.25rem] sm:pr-16 [&_a]:font-medium [&_a]:text-ink [&_a]:decoration-[var(--lime)] [&_a]:decoration-2 [&_a]:underline-offset-4">
                    {f.a}
                  </div>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Your turn ────────────────────────────────────────────────────── */}
      <Reveal as="section" className="card ring-glow relative rounded-[28px] px-6 py-10 sm:px-12 sm:py-14">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
          <div className="bg-grid absolute inset-0 opacity-80" />
          <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-lime opacity-[0.14] blur-3xl" />
        </div>
        <div className="flex items-center justify-between gap-8">
          <div className="max-w-xl">
            <div className="eyebrow">Your turn</div>
            <h2 className="display mt-3 text-[36px] leading-[0.95] sm:text-[56px]">Name it. Add the accounts. Launch.</h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-2 sm:text-[16px]">
              Every trade after that pays the X accounts you picked, on the curve and after it graduates.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/create" className="btn-neon group/cta px-6 py-3.5 text-[16px]">
                Launch a coin
                <span aria-hidden className="transition-transform duration-300 group-hover/cta:translate-x-1">
                  →
                </span>
              </Link>
              <Link href="/claim" className="btn-secondary px-6 py-3.5 text-[16px]">
                Claim my fees
              </Link>
            </div>
          </div>
          <StepLaunch className="hidden h-44 w-44 shrink-0 animate-float sm:block lg:h-52 lg:w-52" />
        </div>
      </Reveal>
    </div>
  );
}

function Kicker({ n, children }: { n: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="num grid h-7 min-w-[28px] place-items-center rounded-full border border-line-2 px-2 text-[11px] text-ink">{n}</span>
      <span className="eyebrow">{children}</span>
    </div>
  );
}

function ChapterHead({ n, kicker, title, children }: { n: string; kicker: string; title: string; children?: ReactNode }) {
  return (
    <Reveal as="header" className="flex flex-col gap-4 border-t border-line pt-8 md:flex-row md:items-end md:justify-between md:gap-12">
      <div>
        <Kicker n={n}>{kicker}</Kicker>
        <h2 className="display mt-3 text-[36px] leading-[0.95] sm:text-[48px]">{title}</h2>
      </div>
      {children ? <p className="max-w-md text-[15px] leading-relaxed text-ink-2">{children}</p> : null}
    </Reveal>
  );
}

/**
 * Where one trade's fee goes, zooming in twice: 1 square in 100 is the fee, the fee splits 80/20
 * between the X accounts and the protocol, and the accounts' 80% splits by their shares. The
 * receipt beside it runs the same numbers for a 1 ETH trade.
 */
function FeeFlow() {
  const fee = (TRADE_ETH * FEE_PCT) / 100;
  const toAccounts = (fee * ACCOUNTS_PCT) / 100;
  const toProtocol = fee - toAccounts;
  return (
    <Reveal as="figure" className="card relative isolate overflow-hidden rounded-[28px] p-5 sm:p-8">
      <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-60" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-10">
        <div className="min-w-0">
          <RowHead label="Every trade" note="1 square = 1%" />
          <div aria-hidden className="grid grid-cols-[repeat(25,minmax(0,1fr))] gap-[3px]">
            {Array.from({ length: 99 }, (_, i) => (
              <span key={i} className={`aspect-square rounded-[3px] bg-card-3 ${FADE}`} style={{ transitionDelay: `${i * 4}ms` }} />
            ))}
            <span className={`aspect-square animate-pulse-dot rounded-[3px] border border-outline bg-lime ${FADE}`} style={{ transitionDelay: "440ms" }} />
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3 font-mono text-[11px]">
            <span className="text-ink-3">99% · the trade itself</span>
            <span className="text-ink-2">
              <span className="text-neon font-semibold">1%</span> · the fee
            </span>
          </div>

          <Wedge id="how-wedge-fee" from={[96.7, 100]} delay={520} />

          <RowHead label="The 1% fee" />
          <div className={`flex h-12 overflow-hidden rounded-2xl border border-line ${WIPE}`} style={{ transitionDelay: "640ms" }}>
            <div className="relative flex w-4/5 min-w-0 items-center gap-2 overflow-hidden bg-lime px-3.5 text-[var(--lime-ink)]">
              <span className="num text-[16px] font-bold">{ACCOUNTS_PCT}%</span>
              <span className="truncate text-[12px] font-semibold">X accounts</span>
              <span
                aria-hidden
                className="absolute inset-0 animate-shimmer bg-[length:200%_100%]"
                style={{ backgroundImage: "linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.5) 50%, transparent 70%)" }}
              />
            </div>
            <div className="flex w-1/5 items-center justify-center border-l border-line bg-card-3 bg-[repeating-linear-gradient(135deg,transparent_0_5px,var(--line-2)_5px_6px)]">
              <span className="num text-[13px] font-semibold text-ink-2">{100 - ACCOUNTS_PCT}%</span>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3 font-mono text-[11px] text-ink-3">
            <span>to the X accounts</span>
            <span>to the protocol</span>
          </div>

          <Wedge id="how-wedge-accounts" from={[0, ACCOUNTS_PCT]} delay={1000} />

          <RowHead label="The accounts' 80%" note="example shares" />
          <div className={`flex h-11 gap-[3px] overflow-hidden rounded-2xl ${WIPE}`} style={{ transitionDelay: "1120ms" }}>
            {ACCOUNTS.map((a) => (
              <div key={a.handle} className="grid min-w-0 place-items-center" style={{ flex: `${a.share} 1 0%`, backgroundColor: a.color }}>
                <span className="num text-[11px] font-bold text-[var(--lime-ink)] sm:text-[12px]">{a.share}%</span>
              </div>
            ))}
          </div>
          <div aria-hidden className="mt-2 flex gap-[3px]">
            {ACCOUNTS.map((a, i) => (
              <div key={a.handle} className={`flex min-w-0 justify-center ${RISE}`} style={{ flex: `${a.share} 1 0%`, transitionDelay: `${1320 + i * 70}ms` }}>
                <AccountFace a={a} className="h-7 w-7 sm:h-8 sm:w-8" />
              </div>
            ))}
          </div>
        </div>

        <Receipt fee={fee} toAccounts={toAccounts} toProtocol={toProtocol} />
      </div>
      <figcaption className="mt-7 border-t border-line pt-4 text-[13px] leading-relaxed text-ink-3">
        Shares are set at launch and never change. Fees wait in the FeeVault under each account&apos;s permanent X user id until its owner claims them to any wallet.
      </figcaption>
    </Reveal>
  );
}

function RowHead({ label, note }: { label: string; note?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <span className="eyebrow text-ink-2">{label}</span>
      {note ? <span className="font-mono text-[11px] text-ink-3">{note}</span> : null}
    </div>
  );
}

/** The zoom between two rows: the top edge spans the part being zoomed into (x in %), the bottom spans the full width. */
function Wedge({ id, from: [a, b], delay }: { id: string; from: [number, number]; delay: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={`my-1.5 block h-10 w-full overflow-visible text-lime sm:h-12 [[data-theme=light]_&]:text-up ${FADE}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <polygon points={`${a},0 ${b},0 100,100 0,100`} fill={`url(#${id})`} />
      {[`M${a} 0L0 100`, `M${b} 0L100 100`].map((d) => (
        <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 8" vectorEffect="non-scaling-stroke" className="animate-flow" />
      ))}
    </svg>
  );
}

function AccountFace({ a, className }: { a: Account; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <Avatar cx={23} cy={26} r={15} color={a.color} hair={a.hair} hairColor={a.hairColor} sw={2.2} face={a.face} shadow={2} />
    </svg>
  );
}

/** The same split as a till receipt, for a 1 ETH trade. */
function Receipt({ fee, toAccounts, toProtocol }: { fee: number; toAccounts: number; toProtocol: number }) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-line bg-card-2 font-mono text-[12px]">
      <div className="flex items-center justify-between gap-3 border-b border-dashed border-line-2 px-4 py-3">
        <span className="eyebrow">Receipt</span>
        <span className="text-ink-3">a {TRADE_ETH} ETH trade</span>
      </div>
      <div className="flex-1 space-y-2.5 px-4 py-4">
        <ReceiptLine label="Trade" value={eth(TRADE_ETH)} delay={200} />
        <ReceiptLine label={`Fee (${FEE_PCT}%)`} value={eth(fee)} delay={270} strong />
        <div className="space-y-2.5 border-l border-line-2 pl-3">
          <ReceiptLine label={`Protocol (${100 - ACCOUNTS_PCT}%)`} value={eth(toProtocol)} delay={340} />
          <ReceiptLine label={`X accounts (${ACCOUNTS_PCT}%)`} value={eth(toAccounts)} delay={410} strong />
          <div className="space-y-2 border-l border-line-2 pl-3">
            {ACCOUNTS.map((a, i) => (
              <ReceiptLine
                key={a.handle}
                delay={480 + i * 70}
                value={eth((toAccounts * a.share) / 100)}
                label={
                  <>
                    <AccountFace a={a} className="h-5 w-5 shrink-0" />
                    <span className="truncate text-ink">@{a.handle}</span>
                    <span className="shrink-0 text-ink-3">{a.share}%</span>
                  </>
                }
              />
            ))}
          </div>
        </div>
      </div>
      <div className={`border-t border-dashed border-line-2 px-4 py-4 ${RISE}`} style={{ transitionDelay: "860ms" }}>
        <div className="eyebrow">To the X accounts</div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="display text-[34px] leading-none text-ink">{(FEE_PCT * ACCOUNTS_PCT) / 100}%</span>
          <span className="font-sans text-[14px] font-medium text-ink-2">of every trade</span>
        </div>
        <p className="mt-2 text-ink-3">Paid on every trade, before and after graduating.</p>
      </div>
    </div>
  );
}

function ReceiptLine({ label, value, delay, strong = false }: { label: ReactNode; value: string; delay: number; strong?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${RISE}`} style={{ transitionDelay: `${delay}ms` }}>
      <span className={`flex min-w-0 items-center gap-1.5 ${strong ? "font-semibold text-ink" : "text-ink-2"}`}>{label}</span>
      <span aria-hidden className="min-w-[12px] flex-1 translate-y-[3px] border-b border-dotted border-line-2" />
      <span className={`shrink-0 tabular-nums ${strong ? "font-semibold text-ink" : "text-ink-2"}`}>{value}</span>
    </div>
  );
}
