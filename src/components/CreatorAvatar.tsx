import type { CSSProperties } from "react";

const COLORS = ["var(--sky)", "var(--pink)", "var(--sun)", "var(--lilac)", "var(--orange)"];

/** An identity marker, not a fetched TikTok profile photo. */
export function CreatorAvatar({ handle, size = 28, className = "" }: { handle?: string; size?: number; className?: string }) {
  const clean = (handle ?? "").replace(/^@/, "");
  const hash = Array.from(clean).reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 0);
  const style: CSSProperties = { width: size, height: size, fontSize: Math.max(9, size * 0.36), background: COLORS[hash % COLORS.length], color: "var(--outline)" };
  return (
    <span title={clean ? `@${clean}` : "Creator"} aria-label={clean ? `@${clean}` : "Creator"} style={style} className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold uppercase ring-2 ring-card ${className}`}>
      {clean.slice(0, 2) || "◎"}
    </span>
  );
}

export function CreatorAvatarStack({ people, size = 22, max = 4 }: { people: readonly { handle: string }[]; size?: number; max?: number }) {
  return (
    <div className="flex items-center">
      {people.slice(0, max).map((p, i) => <CreatorAvatar key={p.handle} handle={p.handle} size={size} className={i ? "-ml-1.5 transition-[margin] duration-300 group-hover:-ml-0.5" : ""} />)}
      {people.length > max ? <span className="chip -ml-1 font-mono !text-[10.5px] ring-2 ring-card">+{people.length - max}</span> : null}
    </div>
  );
}
