import { useId } from "react";
import { C, INK, SHINE, Sparkle } from "./parts";

/** The S of the logo: two rounded bars joined by a bend, one continuous stroke (44×44 box). */
const S = "M32.4 12.9H17.8a5.4 5.4 0 0 0 0 10.8h8.4a5.4 5.4 0 0 1 0 10.8H11.6";
/** The diagonal where the S's two halves meet, across its middle bar: x on that line at height y. */
const cutX = (y: number) => 23 + (y - 23.7) * (4 / 7.8);

/**
 * SplitEarn brand mark: the S from the owner's logo, drawn as a sticker. Two halves (lime on top,
 * green below) meet at a diagonal ink line, with a chunky outline, a hard shadow, a shine and a
 * sparkle. `public/logo.svg` and `src/app/icon.svg` are rendered from this (scripts/render-logo.mjs).
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" className={className} aria-hidden="true" focusable="false">
      <LogoCoin />
      <Sparkle x={37.5} y={7.5} s={4.6} color={C.sun} sw={1.8} />
    </svg>
  );
}

/** The mark's S alone (without the sparkle), in the same 44×44 box, for drawing inside other art. */
export function LogoCoin() {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const round = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  // The top half: everything above the middle bar, plus the part of it left of the diagonal.
  const top = `M-5 -5H49V18.3H${cutX(18.3).toFixed(2)}L${cutX(29.1).toFixed(2)} 29.1H-5Z`;
  return (
    <g>
      <defs>
        <clipPath id={`${id}t`}>
          <path d={top} />
        </clipPath>
      </defs>
      {/* hard shadow, then the ink outline */}
      <path d={S} {...round} stroke={INK} strokeWidth={10.6} transform="translate(2.2 2.2)" />
      <path d={S} {...round} stroke={INK} strokeWidth={10.6} />
      {/* the two halves */}
      <path d={S} {...round} stroke={C.green} strokeWidth={6.4} />
      <path d={S} {...round} stroke={C.lime} strokeWidth={6.4} clipPath={`url(#${id}t)`} />
      {/* where they meet */}
      <path d={`M${cutX(19.6).toFixed(2)} 19.6L${cutX(27.8).toFixed(2)} 27.8`} {...round} stroke={INK} strokeWidth={1.9} />
      {/* shine */}
      <path d="M20.6 11.6H28.4" {...round} stroke={SHINE} strokeWidth={1.7} />
      <path d="M12.4 17.4A4.2 4.2 0 0 1 14.2 14.6" {...round} stroke={SHINE} strokeWidth={1.5} />
      <path d="M15.6 33.2H21" {...round} stroke={SHINE} strokeWidth={1.5} opacity={0.75} />
    </g>
  );
}

/** LogoMark + "SplitEarn" wordmark as a flex row. The mark turns a little when its link is hovered. */
export function Wordmark({ className, textClassName = "", size = 28 }: { className?: string; textClassName?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark size={size} className="transition-transform duration-500 group-hover:-rotate-12 group-hover:scale-110" />
      <span className={`display text-[20px] leading-none ${textClassName}`}>
        Split<span className="text-neon">Earn</span>
      </span>
    </span>
  );
}
