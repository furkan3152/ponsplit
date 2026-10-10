/** The approved Tiksplit monogram, shared with the profile image and social banner. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="24 24 144 144" fill="none" className={className} aria-hidden>
      <image href="/brand/tiksplit-logo.png" width="192" height="192" />
    </svg>
  );
}

export function WordmarkText({ className = "" }: { className?: string }) {
  return <span className={`logo-word whitespace-nowrap leading-none ${className}`}>tik<span className="text-neon">split</span><span className="text-[var(--coral)]">.</span></span>;
}

export function Wordmark({ className, textClassName = "", size = 28 }: { className?: string; textClassName?: string; size?: number }) {
  return <span className={`inline-flex items-center gap-2 ${className ?? ""}`}><LogoMark size={size} /><WordmarkText className={`text-[22px] ${textClassName}`} /></span>;
}
