/** Small geometric illustrations shared by empty and confirmed states. */
export function StateIcon({ kind = "video", className = "" }: { kind?: "video" | "wallet" | "launch" | "done" | "search"; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden className={className}>
      <circle cx="50" cy="50" r="44" fill="var(--card-2)" stroke="var(--line-2)" />
      <circle cx="18" cy="28" r="5" fill="var(--sky)" />
      <circle cx="83" cy="75" r="7" fill="var(--pink)" />
      {kind === "done" ? <path d="m29 51 14 14 28-31" stroke="var(--green)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /> : kind === "wallet" ? <><rect x="24" y="33" width="52" height="37" rx="9" stroke="var(--lime)" strokeWidth="4" /><path d="M28 33v-5h40v5" stroke="var(--lime)" strokeWidth="4" /><path d="M61 45h15v15H61a7.5 7.5 0 0 1 0-15Z" fill="var(--lime)" /></> : kind === "launch" ? <><path d="M50 72V28m-16 16 16-16 16 16" stroke="var(--lime)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /><path d="M28 64v11h44V64" stroke="var(--sky)" strokeWidth="4" strokeLinecap="round" /></> : kind === "search" ? <><circle cx="46" cy="45" r="17" stroke="var(--lime)" strokeWidth="5" /><path d="m59 58 15 15" stroke="var(--lime)" strokeWidth="5" strokeLinecap="round" /></> : <><rect x="32" y="22" width="36" height="56" rx="10" stroke="var(--lime)" strokeWidth="4" /><path d="m45 40 15 10-15 10V40Z" fill="var(--sky)" /><path d="M45 70h10" stroke="var(--pink)" strokeWidth="3" strokeLinecap="round" /></>}
    </svg>
  );
}
