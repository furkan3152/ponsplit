import { Bug } from "./Bug";
import { Avatar, C, INK, MiniCoin, Sparkle } from "./parts";

const SW = 2.6;
const BRANCHES = [
  { x: 32, color: C.sky },
  { x: 80, color: C.pink },
  { x: 128, color: C.sun },
];

/** "Split" step: Bitbug opens its shell and coins run down three git branches to three developers. */
export function StepSplit({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 160" className={className} aria-hidden="true" focusable="false">
      {BRANCHES.map((b) => (
        <path
          key={b.x}
          d={b.x === 80 ? "M80 70V108" : `M80 70V78C80 92 ${b.x} 86 ${b.x} 100V108`}
          fill="none"
          stroke={b.color}
          strokeWidth={3.4}
          strokeLinecap="round"
          strokeDasharray="2 7"
        />
      ))}
      <circle cx={80} cy={78} r={5} fill={C.lime} stroke={INK} strokeWidth={2} />
      <Bug x={80} y={38} size={70} face="joy" open={18} sw={3} />
      <MiniCoin cx={46} cy={92} r={7} sw={SW * 0.85} />
      <MiniCoin cx={114} cy={92} r={7} sw={SW * 0.85} split />
      <Avatar cx={32} cy={132} r={18} color={C.sky} hair={0} hairColor={C.lilac} sw={SW * 0.9} shadow={2.5} />
      <Avatar cx={80} cy={136} r={18} color={C.pink} hair={4} hairColor={C.sun} sw={SW * 0.9} shadow={2.5} face="joy" />
      <Avatar cx={128} cy={132} r={18} color={C.sun} hair={2} hairColor={C.lime} sw={SW * 0.9} shadow={2.5} />
      <Sparkle x={138} y={18} s={7} sw={SW * 0.8} />
      <Sparkle x={22} y={24} s={6} color={C.pink} sw={SW * 0.7} />
    </svg>
  );
}
