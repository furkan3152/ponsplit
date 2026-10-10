import { Reveal } from "./motion";

const STEPS = [
  {
    title: "Choose your creator",
    body: "Name your pump.fun coin and choose one TikTok handle. Creator fees are fixed at 80% for the creator and 20% for the platform.",
  },
  {
    title: "Let the fees collect",
    body: "Your wallet launches on pump.fun mainnet with a permanent fee split. The creator share accrues in escrow from actual trading activity, even before verification.",
  },
  {
    title: "Post your proof",
    body: "The creator connects their wallet and requests a verification code. They publish the full code in a public video caption on their TikTok account, then submit the original video URL for review.",
  },
  {
    title: "Approve. Bind. Claim.",
    body: "An admin manually checks the account and code. After approval, the creator activates their permanent wallet binding on chain. Only that wallet can claim the available escrow fees in SOL.",
  },
];

function StepIcon({ step }: { step: number }) {
  return (
    <svg viewBox="0 0 80 80" className="h-20 w-20 text-neon" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2">
      {step === 0 ? <>
        <path d="M9 11h51l11 11v47H9Z" opacity="0.3" />
        <circle cx="29" cy="30" r="7" />
        <path d="M17 53c0-13 24-13 24 0M49 29h12M49 40h12M49 51h8" strokeLinecap="round" />
      </> : step === 1 ? <>
        <ellipse cx="40" cy="16" rx="24" ry="7" />
        <path d="M16 16v13c0 4 11 7 24 7s24-3 24-7V16M16 29v13c0 4 11 7 24 7s24-3 24-7V29" />
        <path d="M40 51v19m-8-8 8 8 8-8" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--coral)" }} />
      </> : step === 2 ? <>
        <path d="M22 6h29l8 8v60H22Z" opacity="0.4" />
        <path d="M22 17h37M34 65h13" />
        <rect x="12" y="28" width="55" height="25" fill="var(--paper)" />
        <text x="40" y="45" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="var(--font-mono), monospace" fontSize="12" fontWeight="700">CODE</text>
        <path d="m63 12 7-7m-5 17h11" style={{ stroke: "var(--coral)" }} />
      </> : <>
        <path d="M10 21h49l11 11v35H10Z" opacity="0.4" />
        <path d="M11 21v-8h44v8M53 39h17v17H53Z" />
        <circle cx="60" cy="47" r="2" fill="currentColor" stroke="none" />
        <circle cx="31" cy="41" r="13" fill="var(--paper)" style={{ stroke: "var(--coral)" }} />
        <path d="m24 41 5 5 10-12" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--coral)" }} />
      </>}
    </svg>
  );
}

export function HowItWorks() {
  return (
    <ol className="grid gap-x-8 gap-y-10 sm:grid-cols-2 xl:grid-cols-4">
      {STEPS.map(({ title, body }, i) => (
        <Reveal as="li" key={title} delay={i * 100} className="relative border-t border-line pt-5">
          <div className="flex items-start justify-between gap-4"><span aria-hidden className="editorial text-[46px] leading-none text-ink-3">0{i + 1}</span><StepIcon step={i} /></div>
          <div className="edition-label mt-4">Step {i + 1}</div>
          <h3 className="editorial mt-3 text-[34px] leading-[0.95]">{title}</h3>
          <p className="mt-4 text-[14px] leading-[1.8] text-ink-2">{body}</p>
        </Reveal>
      ))}
    </ol>
  );
}
