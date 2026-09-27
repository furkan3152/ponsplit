import { C, INK, QMark, SplitCoin } from "./parts";

const SW = 2.8;
const MAP = "M128 80L158 70L188 80L214 72L220 84L212 94L222 106L214 118L221 132L214 142L188 150L158 140L128 150Z";

/** Confused coin squinting at a torn treasure map, for 404 pages. */
export function NotFoundArt({ className }: { className?: string }) {
  const lo = { stroke: INK, strokeWidth: SW, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  return (
    <svg viewBox="0 0 240 180" className={className} aria-hidden="true" focusable="false">
      <ellipse cx={120} cy={166} rx={92} ry={6} fill={INK} opacity={0.08} />
      {/* torn map */}
      <path d={MAP} fill={INK} transform="translate(3 3)" {...lo} />
      <path d={MAP} fill={C.sky} {...lo} />
      <path d="M158 70L188 80L188 150L158 140Z" fill={INK} opacity={0.12} />
      <path d="M158 70V140M188 80V150" {...lo} fill="none" />
      <path d="M136 132Q150 110 168 118T200 100" fill="none" stroke={C.red} strokeWidth={SW * 0.9} strokeDasharray="1 6" strokeLinecap="round" />
      <path d="M140 96l6 6M146 96l-6 6" {...lo} />
      <circle cx={170} cy={96} r={5} fill={C.lime} {...lo} strokeWidth={SW * 0.8} />
      {/* arm holding the map */}
      <path d="M112 118Q124 122 132 114" fill="none" stroke={INK} strokeWidth={SW * 2.4} strokeLinecap="round" />
      <path d="M112 118Q124 122 132 114" fill="none" stroke={C.green} strokeWidth={SW * 0.9} strokeLinecap="round" />
      <g transform="rotate(-8 74 104)">
        <SplitCoin cx={74} cy={104} r={42} sw={SW} shadow={3.5} face="confused" look={1} />
      </g>
      <QMark x={116} y={34} s={1.5} color={C.sun} sw={SW} rot={-10} />
      <QMark x={160} y={30} s={1.05} color={C.pink} sw={SW} rot={12} />
      <QMark x={200} y={44} s={0.8} color={C.lilac} sw={SW} rot={-4} />
    </svg>
  );
}
