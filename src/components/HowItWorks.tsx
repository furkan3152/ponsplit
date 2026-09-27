import { StepLaunch, StepSplit, StepTrade } from "./art";

const STEPS = [
  {
    Art: StepLaunch,
    title: "Launch in one tap",
    body: "Name your coin, add up to ten X accounts and choose how the fees are shared. No code, no liquidity to provide.",
  },
  {
    Art: StepTrade,
    title: "Trade on the curve",
    body: "Everyone buys and sells on a bonding curve. When it sells out, the coin graduates to PonSwap with liquidity locked forever.",
  },
  {
    Art: StepSplit,
    title: "Fees split, forever",
    body: "Every trade, before and after graduating, pays the X accounts. Owners sign in with X and claim to any wallet.",
  },
];

export function HowItWorks() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {STEPS.map(({ Art, title, body }, i) => (
        <div key={title} className="card flex flex-col items-start p-6">
          <Art className="h-28 w-28" />
          <div className="mt-4 text-[12px] font-semibold uppercase tracking-wider text-ink-3">Step {i + 1}</div>
          <h3 className="mt-1 font-display text-[21px] font-semibold tracking-tight">{title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{body}</p>
        </div>
      ))}
    </div>
  );
}
