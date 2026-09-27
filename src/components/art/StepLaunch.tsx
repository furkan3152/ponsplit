import { C, INK, Sparkle, SplitCoin, Star } from "./parts";

const SW = 2.8;

/** "Launch" step: a split-coin character blasting off on little rocket fins. */
export function StepLaunch({ className }: { className?: string }) {
  const lo = { stroke: INK, strokeWidth: SW, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  return (
    <svg viewBox="0 0 160 160" className={className} aria-hidden="true" focusable="false">
      {/* smoke puffs */}
      <g fill={C.sky} {...lo}>
        <circle cx={48} cy={140} r={11} />
        <circle cx={112} cy={140} r={11} />
        <circle cx={64} cy={146} r={10} />
        <circle cx={96} cy={146} r={10} />
      </g>
      {/* flame */}
      <path d="M66 100Q62 124 80 146Q98 124 94 100Z" fill={C.orange} {...lo} />
      <path d="M73 102Q72 118 80 132Q88 118 87 102Z" fill={C.sun} />
      {/* fins + nozzle */}
      <path d="M56 78Q40 88 38 108Q48 100 60 98Z" fill={C.red} {...lo} />
      <path d="M104 78Q120 88 122 108Q112 100 100 98Z" fill={C.red} {...lo} />
      <path d="M68 92H92L96 104H64Z" fill={C.lilac} {...lo} />
      <SplitCoin cx={80} cy={62} r={30} sw={SW} shadow={3} face="joy" />
      {/* speed lines */}
      <g {...lo} opacity={0.5}>
        <path d="M24 58V78M34 70V90M126 54V74M136 66V86" />
      </g>
      <Star x={132} y={28} s={9} sw={SW * 0.8} rot={12} />
      <Sparkle x={26} y={30} s={8} color={C.lime} sw={SW * 0.8} />
      <Sparkle x={140} y={112} s={6} color={C.pink} sw={SW * 0.7} />
    </svg>
  );
}
