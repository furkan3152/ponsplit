import { Bug } from "./Bug";
import { C, INK, Sparkle } from "./parts";

const SW = 2.6;

/** Badge: Bitbug in a graduation cap, for coins that completed their bonding curve. */
export function GraduatedArt({ className }: { className?: string }) {
  const lo = { stroke: INK, strokeWidth: SW, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  return (
    <svg viewBox="0 0 96 96" className={className} aria-hidden="true" focusable="false">
      <Bug x={48} y={58} size={70} face="joy" sw={3.2} />
      {/* cap on the head */}
      <path d="M38 24V30Q48 35 58 30V24Z" fill={INK} {...lo} />
      <path d="M48 10L74 20L48 30L22 20Z" fill={C.lilac} {...lo} />
      <path d="M48 20L68 23V35" fill="none" {...lo} />
      <path d="M64 35H72L70 42H66Z" fill={C.sun} {...lo} />
      <Sparkle x={86} y={70} s={7} sw={SW * 0.8} />
      <Sparkle x={10} y={58} s={5} sw={SW * 0.7} color={C.lime} />
    </svg>
  );
}
