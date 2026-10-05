import { Bug } from "./Bug";
import { C, INK } from "./parts";

const Z = ({ x, y, s }: { x: number; y: number; s: number }) => (
  <path d={`M${x} ${y}h${s}l${-s} ${s}h${s}`} fill="none" stroke="var(--ink-3)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
);

/** Bitbug napping on a leaf, for empty lists. */
export function EmptyArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden="true" focusable="false">
      <ellipse cx={80} cy={112} rx={54} ry={5} fill={INK} opacity={0.12} />
      {/* leaf */}
      <path d="M22 98Q60 70 136 92Q100 116 22 98Z" fill={C.green} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
      <path d="M30 97Q80 88 128 92" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
      <g transform="rotate(-78 74 66)">
        <Bug x={74} y={66} size={66} face="sleepy" shadow={false} sw={3} />
      </g>
      <Z x={112} y={36} s={9} />
      <Z x={126} y={20} s={12} />
      <Z x={144} y={8} s={7} />
    </svg>
  );
}
