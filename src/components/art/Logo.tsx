/** An original split-play mark: the feed becomes a creator's share. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <path d="M7 4.5 22 13v14L7 35.5V4.5Z" fill="var(--lime)" />
      <path d="m26 15.3 8.5 4.7-8.5 4.7v-9.4Z" fill="var(--coral)" />
    </svg>
  );
}

export function WordmarkText({ className = "" }: { className?: string }) {
  return <span className={`display whitespace-nowrap leading-none tracking-[-0.06em] ${className}`}>tik<span className="text-neon">split</span><span className="text-[var(--coral)]">.</span></span>;
}

export function Wordmark({ className, textClassName = "", size = 28 }: { className?: string; textClassName?: string; size?: number }) {
  return <span className={`inline-flex items-center gap-2 ${className ?? ""}`}><LogoMark size={size} /><WordmarkText className={`text-[22px] ${textClassName}`} /></span>;
}
