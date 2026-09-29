import { C, INK, SHINE, Sparkle } from "./parts";

/**
 * One half of the owner's S, in a 44×44 box: the top bar with its slanted end, the round bowl on
 * the left and the short middle stub. The other half is the same shape turned half a turn around
 * the centre (22, 22); the two stubs meet in the middle with a gap, the "split".
 */
const HALF =
  "M15 6H33.9Q35.9 6 34.86 7.7L30.02 15.6Q29.5 16.45 28.5 16.45H24.2A3 3 0 0 0 21.2 19.45V23.8Q21.2 25 20 25H15A8 8 0 0 1 7 17V14A8 8 0 0 1 15 6Z";
const TURN = "rotate(180 22 22)";

/**
 * SplitEarn brand mark: the owner's S drawn flat, as a sticker. Its two halves (lime on top, green
 * below) have a chunky ink outline, a hard shadow, a shine and a sparkle. `public/logo.svg` and
 * `src/app/icon.svg` are rendered from this (scripts/render-logo.mjs).
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" className={className} aria-hidden="true" focusable="false">
      <LogoCoin />
      <Sparkle x={6.4} y={6.4} s={4.2} color={C.sun} sw={1.6} />
    </svg>
  );
}

/** The mark's S alone (without the sparkle), in the same 44×44 box, for drawing inside other art. */
export function LogoCoin() {
  const ink = { stroke: INK, strokeWidth: 2.6, strokeLinejoin: "round" as const };
  const shine = { fill: "none", stroke: SHINE, strokeLinecap: "round" as const };
  return (
    <g>
      {/* hard shadow */}
      <g transform="translate(2 2.2)" fill={INK} {...ink}>
        <path d={HALF} />
        <path d={HALF} transform={TURN} />
      </g>
      {/* the two halves */}
      <path d={HALF} fill={C.lime} {...ink} />
      <path d={HALF} transform={TURN} fill={C.green} {...ink} />
      {/* shine */}
      <path d="M15.6 9.1H30.6" {...shine} strokeWidth={1.7} />
      <path d="M10.2 15.2A5.4 5.4 0 0 1 11.6 11.3" {...shine} strokeWidth={1.5} />
      <path d="M26.8 28.4H31.6" {...shine} strokeWidth={1.5} opacity={0.75} />
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
