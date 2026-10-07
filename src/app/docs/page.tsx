import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { HeadingDoodle } from "@/components/art/Doodles";
import { FollowX } from "@/components/home/Official";
import { Reveal } from "@/components/motion";
import { MAX_RECIPIENTS } from "@/lib/solana/config";
import { FeeExample, FeeTable, LaunchFee } from "./LiveTerms";

export const metadata: Metadata = {
  title: "Docs",
  description: "How Splitdev works on Solana: launching a pump.fun coin, trading, where every fee goes, and how GitHub developers get paid.",
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
  return (
    <div className="mx-auto max-w-6xl pt-4">
      <header className="max-w-2xl">
        <div className="eyebrow">Docs</div>
        <h1 className="display mt-2 flex items-center gap-2 text-[44px] leading-[0.95] sm:text-[60px]">
          Splitdev docs <HeadingDoodle kind="coin" className="h-10 w-10" />
        </h1>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-2">
          Everything about launching a coin whose trading fees pay GitHub developers: how it works on pump.fun, what it costs, where every fee goes and how
          the developers get paid.
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
              Splitdev launches coins on {b("pump.fun")}, on Solana, with one difference: the coin&apos;s creator fees don&apos;t go to a single wallet. They
              are split between up to {b(`${MAX_RECIPIENTS} GitHub developers`)}, by shares chosen at launch, on every buy and sell, before and after the
              coin graduates.
            </p>
            <p>
              The coins are ordinary pump.fun coins: pump.fun mints them, runs their bonding curve and moves them to its pool. The split is pump.fun&apos;s
              own fee sharing, set once at launch; each developer&apos;s share goes to pump.fun&apos;s fee account for their GitHub account, where they claim it.
            </p>
            <Note>Splitdev is an independent app built on pump.fun&apos;s public programs. It is not affiliated with, endorsed by or operated by pump.fun or GitHub.</Note>
          </Section>

          <Section id="start" n={2} title="Getting started">
            <Steps
              items={[
                <>Use a Solana wallet such as Phantom, Solflare or Backpack (on a phone, open the site in the wallet app&apos;s browser).</>,
                <>Tap {b("Connect")} and pick your wallet.</>,
                <>Have some SOL for trades, the launch and network fees. Everything on Splitdev is paid in SOL.</>,
              ]}
            />
          </Section>

          <Section id="launch" n={3} title="Launching a coin">
            <Steps
              items={[
                <>Open {b("Launch")} and give the coin a name and a ticker, plus a picture, a description and links if you like.</>,
                <>
                  Add up to {b(`${MAX_RECIPIENTS} GitHub usernames`)} and set each one&apos;s share; the shares add up to 100%. Any personal GitHub account works,
                  and the developer doesn&apos;t need to sign up or do anything to start earning.
                </>,
                <>Optionally make a {b("first buy")}: it happens in the same transaction that creates the coin, before anyone else can trade.</>,
                <>
                  Confirm in your wallet (one prompt for all the transactions). You pay Splitdev&apos;s launch fee (<LaunchFee />), your first buy if any, and
                  about 0.04 SOL of network fees and account rent.
                </>,
              ]}
            />
            <Note>
              {b("The split is permanent.")} pump.fun revokes the right to change a coin&apos;s fee sharing once it is set: nobody, not the creator and not
              Splitdev, can move its fees afterwards. Developers are stored by their permanent GitHub id, so a rename keeps their earnings.
            </Note>
          </Section>

          <Section id="trade" n={4} title="Trading">
            <p>
              Every coin starts on pump.fun&apos;s {b("bonding curve")}: a supply of 1 billion, with the price rising as people buy. Buy and sell right on the
              coin page (or on pump.fun); the price you see is quoted from the curve itself, and your slippage setting (2% by default) protects the trade.
            </p>
            <p>
              When the curve&apos;s coins sell out, the coin {b("graduates")}: pump.fun moves it to its pool, and trading continues there, on the same page, with
              the same fees going to the same developers.
            </p>
          </Section>

          <Section id="fees" n={5} title="Fees">
            <p>Every buy and sell pays pump.fun&apos;s fee. Here is where each part goes:</p>
            <FeeTable />
            <FeeExample />
            <p>
              Splitdev&apos;s share is fixed for each coin at launch. Apart from it and the launch fee there are no other fees: Splitdev takes nothing from the
              developers&apos; balances and nothing when they claim.
            </p>
          </Section>

          <Section id="claim" n={6} title="Getting paid">
            <p>
              pump.fun keeps a coin&apos;s creator fees until someone distributes them; anyone can, from the coin page or the Claim page, for the network fee
              only. Each developer&apos;s share then waits in pump.fun&apos;s fee account for their GitHub account. There is no deadline.
            </p>
            <Steps
              items={[
                <>Open {b("Claim")} and type your GitHub username to see what&apos;s waiting.</>,
                <>Optionally distribute your coins&apos; pending fees into your account.</>,
                <>On pump.fun, connect the wallet you want to be paid in, sign in with GitHub and claim.</>,
              ]}
            />
          </Section>

          <Section id="safety" n={7} title="Safety">
            <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
              <li>Only the owner of a GitHub account can claim its fees: pump.fun asks them to sign in with GitHub first.</li>
              <li>A coin&apos;s fees can&apos;t be redirected: the split is fixed at launch and no one, Splitdev included, can change it.</li>
              <li>Anyone can list any GitHub account. Being listed doesn&apos;t mean the developer endorses the coin.</li>
              <li>The only official Splitdev token is the one shown on the home page. Anything else is not us.</li>
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
