import { C, INK, SHINE, Sparkle } from "./parts";

/**
 * SplitEarn brand mark: a round, happy coin in two halves (lime and mint), one eye and one
 * blushing cheek on each side, with a sparkle. `public/logo.svg` and `src/app/icon.svg` are
 * rendered from this (scripts/render-logo.mjs).
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" className={className} aria-hidden="true" focusable="false">
      <LogoCoin />
      <Sparkle x={37.5} y={7.5} s={4.6} color={C.sun} sw={1.8} />
    </svg>
  );
}

/** The mark's coin alone, centered at (21, 23.5) with radius 16.5, for drawing inside other art. */
export function LogoCoin() {
  const cx = 21;
  const cy = 23.5;
  const r = 16.5;
  const line = { stroke: INK, strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <g>
      <circle cx={cx + 2.2} cy={cy + 2.2} r={r} fill={INK} />
      <path d={`M${cx} ${cy - r}A${r} ${r} 0 0 0 ${cx} ${cy + r}Z`} fill={C.lime} />
      <path d={`M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx} ${cy + r}Z`} fill={C.green} />
      <path d={`M${cx} ${cy - r}V${cy + r}`} {...line} strokeWidth={1.8} />
      <circle cx={cx} cy={cy} r={r} fill="none" {...line} />
      {/* shine */}
      <path d={`M${cx - 11.2} ${cy - 5}A12 12 0 0 1 ${cx - 5.5} ${cy - 11.4}`} fill="none" stroke={SHINE} strokeWidth={2.4} strokeLinecap="round" />
      {/* face: an eye and a cheek on each half, the smile across the split */}
      <ellipse cx={cx - 9.6} cy={cy + 3.4} rx={2.4} ry={1.5} fill={C.pink} />
      <ellipse cx={cx + 9.6} cy={cy + 3.4} rx={2.4} ry={1.5} fill={C.pink} />
      <path d={`M${cx - 8} ${cy - 0.6}Q${cx - 5.6} ${cy - 3.8} ${cx - 3.2} ${cy - 0.6}`} fill="none" {...line} strokeWidth={2} />
      <path d={`M${cx + 3.2} ${cy - 0.6}Q${cx + 5.6} ${cy - 3.8} ${cx + 8} ${cy - 0.6}`} fill="none" {...line} strokeWidth={2} />
      <path d={`M${cx - 3.4} ${cy + 3.4}Q${cx} ${cy + 8.6} ${cx + 3.4} ${cy + 3.4}Z`} fill={INK} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
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
