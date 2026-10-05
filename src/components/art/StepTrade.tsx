import { Bug } from "./Bug";
import { C, INK, InkLine, Sparkle } from "./parts";

const SW = 2.8;

/** "Trade" step: Bitbug climbing the mint bonding curve, with the curve's progress bar below. */
export function StepTrade({ className }: { className?: string }) {
  const curve = "M18 118C70 116 110 96 140 28";
  return (
    <svg viewBox="0 0 160 160" className={className} aria-hidden="true" focusable="false">
      <path d={`${curve}L140 122L18 122Z`} fill={C.green} opacity={0.22} />
      <path d="M14 122H146" stroke="var(--ink-3)" strokeWidth={SW} strokeLinecap="round" opacity={0.5} />
      <InkLine d={curve} color={C.green} w={5} sw={SW} />
      {/* Bitbug walking up the curve */}
      <g transform="rotate(38 98 72)">
        <Bug x={98} y={72} size={50} face="happy" sw={3.2} />
      </g>
      {/* up arrow at the curve's peak */}
      <path d="M140 12l-8 10h16z" fill={C.green} stroke={INK} strokeWidth={SW * 0.8} strokeLinejoin="round" />
      {/* progress bar */}
      <rect x={18} y={134} width={124} height={13} rx={6.5} fill="var(--card-2)" stroke={INK} strokeWidth={SW} />
      <rect x={18} y={134} width={86} height={13} rx={6.5} fill={C.green} stroke={INK} strokeWidth={SW} />
      <path d="M26 138.5H60" stroke="var(--shine)" strokeWidth={2.2} strokeLinecap="round" opacity={0.6} />
      <Sparkle x={36} y={40} s={9} sw={SW * 0.8} />
      <Sparkle x={56} y={78} s={5} color={C.pink} sw={SW * 0.7} />
    </svg>
  );
}
