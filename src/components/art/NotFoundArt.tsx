import { Bug } from "./Bug";
import { C, INK, QMark } from "./parts";

const SW = 2.8;

/** Bitbug squinting through a magnifying glass for a page that isn't there, for missing pages. */
export function NotFoundArt({ className }: { className?: string }) {
  const lo = { stroke: INK, strokeWidth: SW, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  return (
    <svg viewBox="0 0 240 180" className={className} aria-hidden="true" focusable="false">
      <ellipse cx={120} cy={168} rx={92} ry={6} fill={INK} opacity={0.1} />
      <Bug x={84} y={100} size={120} face="wow" look={1} />
      {/* magnifying glass */}
      <path d="M150 112L176 140" {...lo} strokeWidth={SW * 3} />
      <path d="M150 112L176 140" stroke={C.lilac} strokeWidth={SW * 1.3} strokeLinecap="round" />
      <circle cx={136} cy={96} r={22} fill={C.sky} fillOpacity={0.3} {...lo} />
      <path d="M124 86Q128 80 136 79" fill="none" stroke="var(--shine)" strokeWidth={3} strokeLinecap="round" opacity={0.8} />
      <QMark x={30} y={34} s={1.3} color={C.sun} sw={SW} rot={-10} />
      <QMark x={196} y={40} s={1} color={C.pink} sw={SW} rot={12} />
    </svg>
  );
}
