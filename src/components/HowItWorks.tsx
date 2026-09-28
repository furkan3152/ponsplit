import { StepLaunch, StepSplit, StepTrade } from "./art";
import { Reveal } from "./motion";

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
        <Reveal key={title} delay={i * 120} className="card card-hover group relative flex flex-col items-start overflow-hidden p-6">
          <span
            aria-hidden
            className="display pointer-events-none absolute right-4 top-3 select-none text-[88px] leading-none text-transparent"
            style={{ WebkitTextStroke: "1px var(--line-2)" }}
          >
            0{i + 1}
          </span>
          <Art className="h-28 w-28 transition duration-500 group-hover:-rotate-3 group-hover:scale-105" />
          <div className="eyebrow mt-5">Step {i + 1}</div>
          <h3 className="display mt-2 text-[26px] leading-tight">{title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{body}</p>
        </Reveal>
      ))}
    </div>
  );
}
