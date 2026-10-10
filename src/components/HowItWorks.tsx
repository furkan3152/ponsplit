import { Reveal } from "./motion";

const STEPS = [
  {
    title: "Choose your creator",
    body: "Name your pump.fun coin and choose one TikTok handle. Review the platform share and an optional launcher share of up to 10%.",
  },
  {
    title: "Launch on Solana",
    body: "Your wallet creates the coin on pump.fun mainnet and finalizes its native creator-fee split. Trading follows pump.fun's curve and pool; the finalized split cannot be edited.",
  },
  {
    title: "Verify, then claim",
    body: "The creator share goes to a Tiksplit escrow account. Its owner signs in with TikTok and bind their signing wallet through the configured verifier. The first successful wallet binding is permanent.",
  },
];

function StepIcon({ step }: { step: number }) {
  return (
    <svg viewBox="0 0 80 80" className="h-20 w-20 text-neon" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2">
      {step === 0 ? <>
        <rect x="9" y="11" width="62" height="58" rx="13" opacity="0.3" />
        <circle cx="29" cy="30" r="7" />
        <path d="M17 53c0-13 24-13 24 0M49 29h12M49 40h12M49 51h8" strokeLinecap="round" />
      </> : step === 1 ? <>
        <path d="M40 10 67 25v30L40 70 13 55V25Z" opacity="0.4" />
        <path d="m26 44 14-17 14 17M40 27v30" strokeLinecap="round" strokeLinejoin="round" />
      </> : <>
        <circle cx="40" cy="17" r="8" />
        <path d="M40 25v17M19 52V42h42v10" />
        <rect x="10" y="52" width="18" height="18" rx="5" />
        <rect x="52" y="52" width="18" height="18" rx="5" />
        <path d="m34 41 4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
      </>}
    </svg>
  );
}

export function HowItWorks() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {STEPS.map(({ title, body }, i) => (
        <Reveal key={title} delay={i * 100} className="card card-hover relative flex flex-col items-start overflow-hidden p-6">
          <span aria-hidden className="num absolute right-5 top-5 text-[12px] text-ink-3">0{i + 1}</span>
          <StepIcon step={i} />
          <div className="eyebrow mt-5">Step {i + 1}</div>
          <h3 className="display mt-2 text-[25px] leading-tight">{title}</h3>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{body}</p>
        </Reveal>
      ))}
    </div>
  );
}
