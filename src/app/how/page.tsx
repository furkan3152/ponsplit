import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { HowItWorks } from "@/components/HowItWorks";
import { Reveal } from "@/components/motion";
import { PLATFORM_BPS } from "@/lib/solana/config";

export const metadata: Metadata = {
  title: "How it works",
  description: "Launch a pump.fun coin that shares creator fees with a TikTok creator, and learn how Tiksplit escrow claims work.",
};

const PLATFORM_PCT = PLATFORM_BPS / 100;
const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Where does the coin live?",
    a: "On pump.fun, on Solana mainnet. The wallet signs pump.fun's launch instructions, and trading follows its bonding curve and pool. Tiksplit adds a creator-fee allocation and escrow for TikTok recipients.",
  },
  {
    q: "How is the creator fee divided?",
    a: `The configured platform share is ${PLATFORM_PCT}%. The launcher can choose 0–10% for their own wallet. The remainder goes to the escrow account for the TikTok creator selected at launch. These are shares of creator fees; pump.fun's protocol fees are separate.`,
  },
  {
    q: "Can anyone change the split?",
    a: "Once pump.fun's fee-sharing configuration is finalized, its recipients and shares cannot be changed. A partially completed launch still needs to be finalized; the app offers launch recovery when applicable.",
  },
  {
    q: "Does pump.fun support TikTok claims?",
    a: "pump.fun has no native TikTok OAuth or TikTok claim account. Tiksplit routes creator shares into accounts of its own configured escrow program. TikTok OAuth and a configured verifier authorize binding the verified handle to a signing Solana wallet. The verifier cannot withdraw escrow funds; claims require the bound wallet to sign.",
  },
  {
    q: "Can I change the wallet after verification?",
    a: "The first successful on-chain handle-to-wallet binding is permanent. Subsequent claims require that bound wallet. Verify the address before signing and keep access to that wallet.",
  },
  {
    q: "What happens if a TikTok handle changes?",
    a: "A handle is not a permanent TikTok account ID. Before the first binding, a renamed or reassigned handle can be verified by its current owner. A successful binding stays with its original wallet. Handle verification relies on the configured verifier checking ownership correctly.",
  },
  {
    q: "Do creators need to approve the launch?",
    a: "A launcher chooses one TikTok handle. Its owner does not need to sign up before launch. Listing a handle does not mean its owner endorses the coin or has verified it.",
  },
  {
    q: "Why are there separate distribute and claim actions?",
    a: "pump.fun accrues creator fees in a vault. Distribution sends them to the configured shareholders, including creator escrow accounts. A verified creator then claims available escrow funds with their bound wallet. Each transaction can require Solana network fees.",
  },
  {
    q: "What is required before mainnet launches and claims?",
    a: "Mainnet use requires deploying the escrow program, completing an independent security audit and configuring its verifier authority. TikTok OAuth credentials and callback settings must also be configured. The verifier is trusted to authorize the correct wallet before its first binding. If the program remains upgradeable, its upgrade authority is also trusted. Launch and verification actions stay disabled when their required setup is missing.",
  },
  {
    q: "Is Tiksplit part of TikTok or pump.fun?",
    a: "No. Tiksplit is an independent app. A creator-fee share does not guarantee income, and coins can lose all their value.",
  },
];

const CHAPTERS = [
  { id: "steps", n: "01", title: "From launch to claim" },
  { id: "fees", n: "02", title: "Follow the creator fees" },
  { id: "faq", n: "03", title: "Your questions" },
] as const;

export default function HowPage() {
  return (
    <div className="space-y-20 sm:space-y-24">
      <section className="relative grid gap-10 pt-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-end md:gap-14 md:pt-10">
        <div>
          <Reveal><span className="rounded-full border border-line bg-card px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-2">Solana mainnet · pump.fun</span></Reveal>
          <Reveal as="h1" delay={60} className="display mt-6 text-[50px] leading-[0.95] sm:text-[76px]">How Tiksplit <span className="text-neon">works.</span></Reveal>
          <Reveal delay={140}><p className="mt-6 max-w-lg text-[17px] leading-relaxed text-ink-2 sm:text-[18px]">Launch a coin around a creator you follow. Share its creator fees, with a permanent split and verified wallet claims.</p></Reveal>
        </div>
        <Reveal delay={200}>
          <nav aria-label="On this page" className="card overflow-hidden">
            <div className="border-b border-line px-5 py-3"><span className="eyebrow">In this guide</span></div>
            <ol className="divide-y divide-line">
              {CHAPTERS.map((chapter) => (
                <li key={chapter.id}><a href={`#${chapter.id}`} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-card-2"><span className="num text-[12px] text-ink-3">{chapter.n}</span><span className="flex-1 text-[15px] font-semibold">{chapter.title}</span><span aria-hidden className="text-ink-3">↓</span></a></li>
              ))}
            </ol>
          </nav>
        </Reveal>
      </section>
      <section id="steps" className="scroll-mt-24 space-y-8">
        <ChapterHead n="01" kicker="The process" title="From launch to claim" />
        <HowItWorks />
      </section>
      <section id="fees" className="scroll-mt-24 space-y-8">
        <ChapterHead n="02" kicker="The split" title="Follow the creator fees">The platform and optional launcher shares come first. The selected creator receives the remaining amount.</ChapterHead>
        <FeeFlow />
      </section>
      <section id="faq" className="scroll-mt-24">
        <div className="grid gap-8 border-t border-line pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)] lg:gap-14">
          <Reveal className="lg:sticky lg:top-24 lg:self-start">
            <Kicker n="03">Your questions</Kicker>
            <h2 className="display mt-3 text-[36px] leading-tight sm:text-[48px]">Know the details.</h2>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-ink-2">Understand the permanent split, the escrow and who verifies a claim.</p>
          </Reveal>
          <div className="card divide-y divide-line overflow-hidden">
            {FAQ.map((item, i) => (
              <details key={item.q} name="faq" className="group">
                <summary className="flex min-h-[64px] cursor-pointer list-none items-center gap-4 px-5 py-4 transition-colors hover:bg-card-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink sm:px-6 [&::-webkit-details-marker]:hidden">
                  <span className="num w-6 shrink-0 text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1 text-[16px] font-semibold leading-snug">{item.q}</span>
                  <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line-2 text-ink-2 transition-transform group-open:rotate-45">+</span>
                </summary>
                <div className="px-5 pb-6 text-[15px] leading-relaxed text-ink-2 sm:pl-[4.25rem] sm:pr-10">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>
      <Reveal as="section" className="card relative rounded-[28px] px-6 py-10 sm:px-12 sm:py-14">
        <div className="max-w-2xl">
          <div className="eyebrow">Take the next step</div>
          <h2 className="display mt-3 text-[36px] leading-tight sm:text-[52px]">A coin. Your creator.</h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-2">Review the exact handle and fee shares before you launch. Mainnet use requires a deployed, independently audited escrow program and configured TikTok verification.</p>
          <div className="mt-7 flex flex-wrap gap-3"><Link href="/create" className="btn-neon px-6 py-3.5 text-[16px]">Launch a coin →</Link><Link href="/claim" className="btn-secondary px-6 py-3.5 text-[16px]">Creator claims</Link><Link href="/docs" className="btn-secondary px-6 py-3.5 text-[16px]">Read the docs</Link></div>
        </div>
      </Reveal>
    </div>
  );
}

function Kicker({ n, children }: { n: string; children: ReactNode }) {
  return <div className="flex items-center gap-3"><span className="num grid h-7 min-w-[28px] place-items-center rounded-full border border-line-2 px-2 text-[11px] text-ink">{n}</span><span className="eyebrow">{children}</span></div>;
}

function ChapterHead({ n, kicker, title, children }: { n: string; kicker: string; title: string; children?: ReactNode }) {
  return (
    <Reveal as="header" className="flex flex-col gap-4 border-t border-line pt-8 md:flex-row md:items-end md:justify-between md:gap-12">
      <div><Kicker n={n}>{kicker}</Kicker><h2 className="display mt-3 text-[36px] leading-tight sm:text-[48px]">{title}</h2></div>
      {children ? <p className="max-w-md text-[15px] leading-relaxed text-ink-2">{children}</p> : null}
    </Reveal>
  );
}

function FeeFlow() {
  const recipients = [
    { label: "Platform treasury", share: `${PLATFORM_PCT}%`, detail: "Configured platform share", color: "var(--lime)" },
    { label: "Launcher wallet", share: "0–10%", detail: "Optional; chosen at launch", color: "var(--sky)" },
    { label: "Creator escrow", share: "The remainder", detail: "Paid to the selected creator", color: "var(--pink)" },
  ];
  return (
    <Reveal as="figure" className="card overflow-hidden rounded-[28px] p-5 sm:p-8">
      <div className="mx-auto max-w-sm rounded-2xl border border-line-2 bg-card-2 p-5 text-center">
        <div className="eyebrow">pump.fun creator vault</div>
        <div className="display mt-2 text-[28px]">Accrued creator fees</div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-3">Separate from pump.fun&apos;s protocol fee</p>
      </div>
      <div aria-hidden className="mx-auto h-8 w-px bg-line-2" />
      <div className="grid gap-3 md:grid-cols-3">
        {recipients.map((recipient) => (
          <div key={recipient.label} className="rounded-2xl border border-line bg-card-2 p-5">
            <div className="flex items-center gap-2 text-[13px] font-semibold"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: recipient.color }} />{recipient.label}</div>
            <div className="display mt-4 text-[30px] leading-tight">{recipient.share}</div>
            <p className="mt-2 text-[13px] text-ink-3">{recipient.detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-line-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="text-[14px] font-semibold">Creator escrow → bound wallet</div><p className="mt-1 text-[13px] text-ink-3">TikTok OAuth + verifier authorization + your wallet signature</p></div>
        <span className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[11px] text-ink-2">First binding is permanent</span>
      </div>
      <figcaption className="mt-5 border-t border-line pt-4 text-[13px] leading-relaxed text-ink-3">Distribution moves accrued fees to the configured recipients. A creator claims available escrow funds with their verified, bound wallet. The split is immutable after finalization; verification relies on the configured verifier.</figcaption>
    </Reveal>
  );
}
