import type { Metadata } from "next";
import Link from "next/link";
import { HowItWorks } from "@/components/HowItWorks";
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
    a: "No. A claim needs a signature that is only issued after that exact account posts a one-time code (or signs in with X). The code and the signature are both bound to the destination wallet, so copying someone’s post gets you nothing.",
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

export default function HowPage() {
  return (
    <div className="space-y-12 pt-6">
      <div className="max-w-2xl">
        <h1 className="font-display text-[44px] font-bold leading-tight tracking-[-0.03em]">How PonSplit works</h1>
        <p className="mt-3 text-[17px] text-ink-2">One coin, many X accounts, fees split automatically. Here is the whole thing in three steps.</p>
      </div>
      <HowItWorks />
      <div className="card divide-y divide-[var(--line)]">
        {FAQ.map((f) => (
          <details key={f.q} className="group px-6 py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold">
              {f.q}
              <span className="text-ink-3 transition group-open:rotate-45">+</span>
            </summary>
            <div className="mt-3 text-[15px] leading-relaxed text-ink-2">{f.a}</div>
          </details>
        ))}
      </div>
      <div className="text-center">
        <Link href="/create" className="btn-sticker px-7 py-3 text-[16px]">
          Launch a coin
        </Link>
      </div>
    </div>
  );
}
