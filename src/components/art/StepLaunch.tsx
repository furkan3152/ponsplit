import { Bug } from "./Bug";
import { C, CodeTag, INK, Sparkle } from "./parts";

const SW = 2.8;

/** "Launch" step: Bitbug blasting off on a little rocket flame, `</>` sticker trailing. */
export function StepLaunch({ className }: { className?: string }) {
  const lo = { stroke: INK, strokeWidth: SW, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  return (
    <svg viewBox="0 0 160 160" className={className} aria-hidden="true" focusable="false">
      {/* smoke puffs */}
      <g fill={C.lilac} {...lo}>
        <circle cx={50} cy={144} r={10} />
        <circle cx={110} cy={144} r={10} />
        <circle cx={66} cy={150} r={9} />
        <circle cx={94} cy={150} r={9} />
      </g>
      {/* flame */}
      <path d="M64 108Q60 130 80 150Q100 130 96 108Z" fill={C.lime} {...lo} />
      <path d="M72 110Q71 124 80 138Q89 124 88 110Z" fill={C.sun} />
      <g transform="rotate(0 80 64)">
        <Bug x={80} y={66} size={92} face="joy" open={10} sw={3} />
      </g>
      {/* speed lines */}
      <g {...lo} stroke="var(--ink-3)" opacity={0.7}>
        <path d="M22 70V92M32 84V104M128 66V88M138 80V100" />
      </g>
      <CodeTag x={134} y={26} s={26} sw={1.4} color={C.sky} rot={12} />
      <Sparkle x={24} y={28} s={8} color={C.sun} sw={SW * 0.8} />
      <Sparkle x={144} y={124} s={6} color={C.pink} sw={SW * 0.7} />
    </svg>
  );
}
