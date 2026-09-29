import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { HeadingDoodle } from "@/components/art/Doodles";
import { FollowX } from "@/components/home/Official";
import { Reveal } from "@/components/motion";
import { NETWORKS } from "@/lib/networks";
import { FeeExample, FeeTable, LaunchFee } from "./LiveTerms";

export const metadata: Metadata = {
  title: "Docs",
  description: "How SplitEarn works on Robinhood Chain: launching a coin on pons, trading, where every fee goes, and how X accounts get paid.",
};

const SECTIONS = [
  { id: "overview", title: "Overview" },
  { id: "start", title: "Getting started" },
  { id: "launch", title: "Launching a coin" },
  { id: "trade", title: "Trading" },
  { id: "fees", title: "Fees" },
  { id: "claim", title: "Getting paid" },
  { id: "safety", title: "Safety" },
] as const;

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-8">
      <Reveal>
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">{String(n).padStart(2, "0")}</div>
        <h2 className="display mt-2 text-[30px] leading-[1] sm:text-[38px]">{title}</h2>
        <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-ink-2">{children}</div>
      </Reveal>
    </section>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-lime text-[12px] font-bold text-[var(--lime-ink)]">{i + 1}</span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line-2 bg-card-2 px-4 py-3 text-[14px] leading-relaxed text-ink-2">{children}</div>;
}

const b = (s: string) => <strong className="font-semibold text-ink">{s}</strong>;

export default function DocsPage() {
  const chainId = NETWORKS.mainnet.chain.id;
  return (
    <div className="mx-auto max-w-6xl pt-4">
      <header className="max-w-2xl">
        <div className="eyebrow">Docs</div>
        <h1 className="display mt-2 flex items-center gap-2 text-[44px] leading-[0.95] sm:text-[60px]">
          SplitEarn docs <HeadingDoodle kind="coin" className="h-10 w-10" />
        </h1>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-2">
          Everything about launching a coin whose trading fees pay X accounts: how it works on pons, what it costs, where every fee goes and how the
          accounts get paid.
        </p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-14">
        {/* table of contents */}
        <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
          <div className="eyebrow">On this page</div>
          <ul className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-2 transition hover:border-line-2 hover:text-ink lg:w-full lg:rounded-xl lg:border-transparent lg:px-2.5"
                >
                  <span className="num text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-6 hidden lg:block">
            <FollowX />
          </div>
        </nav>

        <div className="min-w-0 max-w-3xl space-y-12">
          <Section id="overview" n={1} title="Overview">
            <p>
              SplitEarn launches coins on {b("pons")}, the launchpad on Robinhood Chain, with one difference: the coin&apos;s creator fees don&apos;t go
              to a single wallet. They are split between up to {b("ten X (Twitter) accounts")}, by shares chosen at launch, on every buy and sell,
              before and after the coin graduates.
            </p>
            <p>
              The coins are ordinary pons coins: pons mints them, runs their bonding curve and moves them into a Uniswap v4 pool. SplitEarn only decides
              who receives the creator fees, and pays them out to the accounts when they claim.
            </p>
            <Note>SplitEarn is an independent app built on pons&apos;s public contracts. It is not affiliated with, endorsed by or operated by pons.</Note>
          </Section>

          <Section id="start" n={2} title="Getting started">
            <Steps
              items={[
                <>
                  Use a wallet that can add a custom network, such as MetaMask or Rabby (on a phone, open the site in the wallet app&apos;s browser).
                </>,
                <>
                  Tap {b("Connect")}. SplitEarn runs on {b(`Robinhood Chain mainnet (chain id ${chainId})`)}; your wallet is asked to add and switch to it.
                </>,
                <>Have some ETH on Robinhood Chain for trades, launch fees and gas. Everything on SplitEarn is paid in ETH.</>,
              ]}
            />
          </Section>

          <Section id="launch" n={3} title="Launching a coin">
            <Steps
              items={[
                <>Open {b("Launch")} and give the coin a name and a ticker, plus an image, a description and links if you like.</>,
                <>
                  Add up to {b("ten X accounts")} and set each one&apos;s share; the shares add up to 100%. Any public account works, and it doesn&apos;t
                  need to sign up or do anything to start earning.
                </>,
                <>
                  Choose an optional {b("creator tax")} from 0 to 10%: an extra cut of every trade that goes entirely to the X accounts. Most coins use
                  0%.
                </>,
                <>
                  Optionally make a {b("first buy")}: it happens in the same transaction as the launch, before anyone else can trade, and it is exempt
                  from the opening anti-sniping tax.
                </>,
                <>
                  Confirm in your wallet. You pay pons&apos;s launch fee (<LaunchFee />), your first buy if any, and gas.
                </>,
              ]}
            />
            <Note>
              {b("The split is permanent.")} Nobody can change a coin&apos;s accounts, their shares or its creator tax after launch, not even the
              creator or SplitEarn. Accounts are stored by their permanent X user id, so a renamed account keeps its earnings.
            </Note>
          </Section>

          <Section id="trade" n={4} title="Trading">
            <p>
              Every coin starts on pons&apos;s {b("bonding curve")}: a supply of 1 billion, with the price rising as people buy. Buy and sell right on
              the coin page; the price you see is quoted from the curve itself, and your slippage setting (2% by default) protects the trade.
            </p>
            <p>
              For the first seconds after a launch, pons charges an {b("anti-sniping tax")} on buys that falls to zero quickly; it joins the coin&apos;s
              fees. The creator&apos;s first buy is exempt.
            </p>
            <p>
              When the curve has raised {b("4.2 ETH")}, the coin {b("graduates")}: the curve closes and its ETH plus the reserved coins seed a Uniswap
              v4 pool whose liquidity is locked. Anyone can open the pool from the coin page, and trading continues there, on the same page, with
              the same fees going to the same accounts.
            </p>
          </Section>

          <Section id="fees" n={5} title="Fees">
            <p>Every buy and sell pays pons&apos;s 1% fee. Here is where each part goes, read live from the contracts:</p>
            <FeeTable />
            <FeeExample />
            <p>
              SplitEarn&apos;s share is fixed for each coin at launch. There are no other fees: SplitEarn takes nothing from the accounts&apos; balances
              and nothing when they claim.
            </p>
          </Section>

          <Section id="claim" n={6} title="Getting paid">
            <p>
              Fees collect in SplitEarn&apos;s vault under each account&apos;s permanent X user id. The owner of the account claims them to any wallet,
              whenever they like; there is no deadline.
            </p>
            <Steps
              items={[
                <>Open {b("Claim")}, connect the wallet that should receive the ETH and type the X username.</>,
                <>
                  Post the exact one-line text the page gives you from that X account. It names your wallet in full and carries a one-time code, which
                  proves the account is yours.
                </>,
                <>Paste the post&apos;s link and claim. The latest fees are collected and everything is sent to your wallet in one transaction.</>,
              ]}
            />
            <p>Where offered, you can sign in with X instead of posting.</p>
            <Note>
              After a coin graduates, part of its pool fees is released by pons in batches, so a small amount can show as {b("being released")} for a
              while before it can be claimed. It is never lost.
            </Note>
          </Section>

          <Section id="safety" n={7} title="Safety">
            <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
              <li>
                Only the owner of an X account can claim its fees: a claim needs a post from that account naming the destination wallet. Replies,
                quotes and reposts don&apos;t count. {b("Never post a proof text someone else sends you")}: it would name their wallet.
              </li>
              <li>A coin&apos;s fees can&apos;t be redirected: the split is fixed at launch and no one, SplitEarn included, can change it.</li>
              <li>
                The only official SplitEarn token is the one shown on the home page and posted by @SplitEarn on X. Anything else is not us.
              </li>
              <li>Coins can lose all their value. Trade only what you can afford to lose; this is experimental software on a live network.</li>
            </ul>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <FollowX />
              <Link href="/how" className="btn-secondary px-4 py-2 text-[14px]">
                More questions →
              </Link>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
