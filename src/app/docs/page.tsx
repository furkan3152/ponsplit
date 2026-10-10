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
              its pool. New coins allocate 20% of their creator fees to Tiksplit and 80% to the escrow account for the chosen TikTok creator.
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
            <Note>Creator verification uses a public TikTok video code and manual admin review. No TikTok developer app is needed for this flow. Launch and claim actions remain unavailable if their required on-chain setup is missing. The escrow code has not completed an independent security audit.</Note>
          </Section>
          <Section id="launch" n={3} title="Launching a coin">
            <Steps items={[
              <>Open {b("Launch")} and enter the coin&apos;s name, ticker, image and any description or links.</>,
              <>Choose {b("one TikTok handle")} to receive 80% of this coin&apos;s creator fees. Check its spelling before signing.</>,
              <>Review the fixed {b("20% platform / 80% creator")} fee split before signing.</>,
              <>Review the launch fee (<LaunchFee />), account rent and network fees in your wallet. Launch does not buy tokens. After the fee split is confirmed, open the coin page to review a live quote and buy.</>,
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
            <p>Older coins retain their original finalized split, including a historical 10% platform share or launcher reward when present. Their split cannot be migrated to the new 20% / 80% allocation; each coin page shows its actual on-chain shares.</p>
          </Section>
          <Section id="claim" n={6} title="Verify with a video, activate your wallet">
            <Steps items={[
              <>Open {b("Claim")}, enter your TikTok handle and connect the wallet you want to use for creator claims.</>,
              <>Sign an on-chain verification request. It records your handle, wallet and a random 128-bit nonce. Copy the {b("entire proof code")} generated by the app, which binds all three.</>,
              <>Publish a public video from that TikTok account with the full code in its caption or visibly in the video. Keep the full wallet address in the code; an abbreviated code or nonce alone is insufficient.</>,
              <>Submit its original {b("tiktok.com/@handle/video/... URL")} using the same wallet. Its handle must exactly match the request.</>,
              <>Wait for the admin to open the original video and profile, check the handle and complete wallet-bound code, and sign an on-chain approval.</>,
              <>With your approved wallet, review and sign the activation transaction. Once the binding succeeds, use that wallet to claim available escrow SOL.</>,
            ]} />
            <Note>{b("The first successful wallet binding is immutable.")} Choose carefully: changing wallets or losing access to the bound wallet can prevent you from claiming that handle&apos;s escrow.</Note>
            <p>
              Requests expire after {b("48 hours")}. Creating a request needs a small rent deposit plus network fees; the app shows the current RPC quote.
              You can cancel your request to recover its rent. Approval also closes the proof account and returns its rent to the requesting wallet.
              Transaction fees are not refunded. The handle, nonce, wallet, video ID and transaction history remain public on Solana after an account closes.
            </p>
            <p>
              Before a binding exists, verification depends on who controls the handle at the time of verification. Renaming a TikTok account can make its
              old handle available to someone else. The admin is trusted to review the original public video and profile correctly. A screenshot, another
              account&apos;s video or a scraper&apos;s result does not establish ownership. Submission does not guarantee approval or a review time.
            </p>
            <p>A mistaken or dishonest admin approval can authorize an incorrect wallet. The admin role cannot withdraw the creator share: the approved owner must activate the binding and sign claims. If the escrow program can be upgraded, its upgrade authority is also trusted to preserve its rules.</p>
            <p>TikTok Login Kit is an optional future verification route requiring separate app approval and configuration. It is not required for the current manual video flow.</p>
            <p>Distributing a coin&apos;s pending fees and claiming an escrow balance are separate transactions. No creator income or token value is guaranteed.</p>
          </Section>
          <Section id="safety" n={7} title="Trust and safety">
            <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
              <li>Anyone can add a TikTok handle. Its presence is not consent, sponsorship or endorsement.</li>
              <li>The split becomes immutable only after finalization; verify the completed on-chain configuration.</li>
              <li>Claims depend on the escrow program, a correct manual ownership review and your bound wallet. The code has not completed an independent security audit.</li>
              <li>Verification requests and their video codes are public. Closing a request returns its rent but does not erase blockchain history.</li>
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
