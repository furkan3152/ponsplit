import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Reveal } from "@/components/motion";
import { FeeExample, FeeTable, LaunchFee } from "./LiveTerms";

export const metadata: Metadata = {
  title: "Docs",
  description: "Tiksplit on Solana mainnet: pump.fun launches, TikTok creator fee shares, escrow, verification and claims.",
};

const SECTIONS = [
  { id: "overview", title: "Overview" },
  { id: "start", title: "Getting started" },
  { id: "launch", title: "Launching a coin" },
  { id: "trade", title: "Trading" },
  { id: "fees", title: "Fees" },
  { id: "claim", title: "Getting paid" },
  { id: "safety", title: "Trust and safety" },
] as const;

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-8">
      <Reveal>
        <div className="num text-[11px] uppercase tracking-[0.16em] text-ink-3">{String(n).padStart(2, "0")}</div>
        <h2 className="display mt-2 text-[30px] leading-tight sm:text-[38px]">{title}</h2>
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
  return <div className="rounded-2xl border border-line-2 bg-card-2 px-4 py-3 text-[14px] leading-relaxed text-ink-2">{children}</div>;
}

const b = (s: string) => <strong className="font-semibold text-ink">{s}</strong>;

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-6xl pt-4">
      <header className="max-w-2xl">
        <div className="eyebrow">The details</div>
        <h1 className="display mt-3 text-[44px] leading-[0.95] sm:text-[60px]">Tiksplit docs</h1>
        <p className="mt-5 text-[17px] leading-relaxed text-ink-2">
          A pump.fun coin can share its creator fees with a TikTok creator. Here is how the launch, the split and wallet verification fit together.
        </p>
      </header>
      <div className="mt-10 grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-14">
        <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
          <div className="eyebrow">On this page</div>
          <ul className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {SECTIONS.map((section, i) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-2 transition hover:border-line-2 hover:text-ink lg:w-full lg:rounded-xl lg:border-transparent lg:px-2.5">
                  <span className="num text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 max-w-3xl space-y-12">
          <Section id="overview" n={1} title="One creator, shared creator fees">
            <p>
              Tiksplit builds coin launches on {b("pump.fun on Solana mainnet")}. The coin trades through pump.fun&apos;s bonding curve and, after graduation,
              its pool. Its creator fees are divided between the platform treasury, an optional launcher wallet and an escrow account for the chosen TikTok creator.
            </p>
            <p>
              The split uses {b("pump.fun’s native fee sharing")}. TikTok recipients use Tiksplit&apos;s configured escrow program because pump.fun does not
              provide a native TikTok sign-in or TikTok claim account. Claim verification and escrow are separate from pump.fun&apos;s trading programs.
            </p>
            <Note>Tiksplit is independent and is not affiliated with, endorsed by or operated by TikTok or pump.fun.</Note>
          </Section>
          <Section id="start" n={2} title="Getting started">
            <Steps items={[
              <>Connect a Solana wallet such as Phantom, Solflare or Backpack. On a phone, use your wallet&apos;s in-app browser.</>,
              <>Keep SOL available for your launch or trade, Solana network fees and account rent.</>,
              <>Read the fee breakdown and verify all recipients before signing. Mainnet transactions spend real SOL.</>,
            ]} />
            <Note>Mainnet use requires a deployed escrow program, an independent security audit and configured TikTok verification. If the required setup is unavailable, launch and verification actions remain disabled.</Note>
          </Section>
          <Section id="launch" n={3} title="Launching a coin">
            <Steps items={[
              <>Open {b("Launch")} and enter the coin&apos;s name, ticker, image and any description or links.</>,
              <>Choose {b("one TikTok handle")} to receive this coin&apos;s creator remainder. Check its spelling before signing.</>,
              <>Review the platform share, select a {b("launcher share from 0 to 10%")}, and confirm that the remainder goes to the chosen creator.</>,
              <>Choose an optional first buy. Review the launch fee (<LaunchFee />), account rent and network fees in your wallet.</>,
              <>Sign the launch transactions and wait for the app to confirm that the fee-sharing configuration is finalized.</>,
            ]} />
            <Note>
              {b("The finalized split is permanent.")} After finalization, the launcher and Tiksplit cannot change the recipients or their shares.
              If only part of a launch lands, finish its configuration before treating it as a completed Tiksplit launch.
            </Note>
            <p>Adding a handle does not verify its owner or imply that the creator endorses the coin. Check the exact spelling; a TikTok handle is not a permanent account identifier.</p>
          </Section>
          <Section id="trade" n={4} title="Trading on pump.fun">
            <p>
              Buy and sell on the coin page or on pump.fun. Quotes come from the current bonding curve or pool. Review the amount, fees and slippage before
              signing; market conditions can change while a transaction is submitted.
            </p>
            <p>Graduation moves trading to pump.fun&apos;s pool. The coin&apos;s finalized creator-fee allocation stays in place, while pump.fun&apos;s applicable trading fees can change with the market and stage.</p>
          </Section>
          <Section id="fees" n={5} title="Where creator fees go">
            <FeeTable />
            <FeeExample />
            <p>
              pump.fun initially accrues creator fees in its vault. Distribution sends the allocated portions to the configured shareholders; it does not
              happen as a separate wallet payout on every trade. The creator portion remains in its escrow account until a valid wallet claim.
            </p>
            <p>The launch fee is separate from trading fees. Transactions, account creation, distribution and claims can also require SOL for network fees and rent.</p>
          </Section>
          <Section id="claim" n={6} title="Verify your TikTok, bind your wallet">
            <Steps items={[
              <>Open {b("Claim")} and enter the TikTok handle used in the coin&apos;s split.</>,
              <>Sign in through TikTok OAuth, then connect the wallet you want to bind to the verified handle.</>,
              <>Sign the verification challenge. The configured verifier checks your TikTok account and wallet signature before authorizing the binding.</>,
              <>Review and sign the on-chain binding transaction. Once it succeeds, claim the available escrow balance using that wallet.</>,
            ]} />
            <Note>{b("The first successful wallet binding is immutable.")} Choose carefully: changing wallets or losing access to the bound wallet can prevent you from claiming that handle&apos;s escrow.</Note>
            <p>
              Before a binding exists, verification depends on who controls the handle at the time of verification. Renaming a TikTok account can make its
              old handle available to someone else. The configured verifier is trusted to check handle ownership correctly; OAuth alone does not make an
              escrow claim trustless. The verifier authorizes the first binding; it cannot withdraw escrow funds. Claims require the bound wallet to sign.
            </p>
            <p>The verifier is trusted before the first binding: a compromised verifier could authorize an incorrect wallet. If the deployed escrow program can be upgraded, its upgrade authority is also trusted to preserve its rules.</p>
            <p>Distributing a coin&apos;s pending fees and claiming an escrow balance are separate transactions. No creator income or token value is guaranteed.</p>
          </Section>
          <Section id="safety" n={7} title="Trust and safety">
            <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
              <li>Anyone can add a TikTok handle. Its presence is not consent, sponsorship or endorsement.</li>
              <li>The split becomes immutable only after finalization; verify the completed on-chain configuration.</li>
              <li>Claims depend on the escrow program and its configured verifier. Mainnet use requires program deployment, an independent security audit and correct production configuration.</li>
              <li>Handle renames and reassignment matter before the first binding. The bound wallet cannot be replaced after a successful binding.</li>
              <li>Coins are speculative and can lose all their value. Only trade what you can afford to lose.</li>
            </ul>
            <div className="pt-2"><Link href="/how" className="btn-secondary px-4 py-2 text-[14px]">Read the quick guide →</Link></div>
          </Section>
        </div>
      </div>
    </div>
  );
}
