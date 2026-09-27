import { C, INK, Sparkle, SplitCoin } from "./parts";

const SW = 2.6;

/** Badge: split coin in a graduation cap, for tokens that completed their bonding curve. */
export function GraduatedArt({ className }: { className?: string }) {
  const lo = { stroke: INK, strokeWidth: SW, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  return (
    <svg viewBox="0 0 96 96" className={className} aria-hidden="true" focusable="false">
      <SplitCoin cx={46} cy={58} r={28} sw={SW} shadow={3} face="happy" />
      <path d="M31 30V39Q46 46 61 39V30Z" fill={INK} {...lo} />
      <path d="M46 14L78 26L46 38L14 26Z" fill={INK} transform="translate(2.5 2.5)" {...lo} />
      <path d="M46 14L78 26L46 38L14 26Z" fill={C.lilac} {...lo} />
      <path d="M46 26L72 30V44" fill="none" {...lo} />
      <path d="M68 44H76L74 52H70Z" fill={C.sun} {...lo} />
      <circle cx={46} cy={26} r={3} fill={C.sun} {...lo} strokeWidth={SW * 0.8} />
      <Sparkle x={84} y={72} s={7} sw={SW * 0.8} />
      <Sparkle x={12} y={60} s={5} sw={SW * 0.7} color={C.lime} />
    </svg>
  );
}
