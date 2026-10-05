import { StepLaunch, StepSplit, StepTrade } from "./art";
import { Reveal } from "./motion";

const STEPS = [
  {
    Art: StepLaunch,
    title: "Launch on pump.fun",
    body: "Name your coin, add up to nine GitHub developers and choose their shares. It's a normal pump.fun coin: no code, no liquidity to provide.",
  },
  {
    Art: StepTrade,
    title: "Trade, then graduate",
    body: "Everyone trades on pump.fun's bonding curve, here or on pump.fun. When it sells out, pump.fun moves it to its pool and it keeps trading here.",
  },
  {
    Art: StepSplit,
    title: "Fees split, forever",
    body: "The coin's creator fees, on the curve and in the pool, go to the developers' pump.fun GitHub accounts, for good. They sign in with GitHub on pump.fun and claim.",
  },
];

export function HowItWorks() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {STEPS.map(({ Art, title, body }, i) => (
        <Reveal key={title} delay={i * 120} className="card card-hover group relative flex flex-col items-start overflow-hidden p-6">
          <span
            aria-hidden
            className="display pointer-events-none absolute right-4 top-3 select-none text-[88px] leading-none tracking-normal text-transparent"
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
