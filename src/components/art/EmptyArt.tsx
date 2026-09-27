import { C, INK, SplitCoin } from "./parts";

const SW = 2.8;
const Z = ({ x, y, s }: { x: number; y: number; s: number }) => (
  <path d={`M${x} ${y}h${s}l${-s} ${s}h${s}`} fill="none" stroke="var(--ink-2)" strokeWidth={SW * 0.9} strokeLinecap="round" strokeLinejoin="round" />
);

/** Sleepy coin napping on a pillow, for empty lists. */
export function EmptyArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden="true" focusable="false">
      <ellipse cx={80} cy={110} rx={52} ry={5} fill={INK} opacity={0.08} />
      <path d="M30 96Q26 82 44 82H116Q134 82 130 96Q134 108 116 106H44Q26 108 30 96Z" fill={INK} transform="translate(2.5 2.5)" />
      <path d="M30 96Q26 82 44 82H116Q134 82 130 96Q134 108 116 106H44Q26 108 30 96Z" fill={C.lilac} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M46 88H70" stroke="var(--shine, #fff)" strokeWidth={SW} strokeLinecap="round" opacity={0.7} />
      <g transform="rotate(-14 74 60)">
        <SplitCoin cx={74} cy={60} r={30} sw={SW} shadow={3} face="sleepy" />
      </g>
      <Z x={110} y={34} s={9} />
      <Z x={124} y={18} s={12} />
      <Z x={142} y={6} s={7} />
    </svg>
  );
}
