import { Avatar, C, MiniCoin, Sparkle, SplitCoin, Trail } from "./parts";

const SW = 2.6;

/** "Split" step: one coin breaks into smaller coins that drop to three X-account avatars. */
export function StepSplit({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 160" className={className} aria-hidden="true" focusable="false">
      <Trail d="M62 64Q40 76 36 100" sw={SW} />
      <Trail d="M80 76V104" sw={SW} />
      <Trail d="M98 64Q120 76 124 100" sw={SW} />
      <SplitCoin cx={80} cy={40} r={27} sw={SW} spread={3} shadow={3} face="happy" />
      <MiniCoin cx={46} cy={80} r={7.5} sw={SW * 0.85} />
      <MiniCoin cx={80} cy={90} r={7.5} sw={SW * 0.85} split />
      <MiniCoin cx={114} cy={80} r={7.5} sw={SW * 0.85} />
      <Avatar cx={32} cy={130} r={19} color={C.sky} hair={0} hairColor={C.red} sw={SW * 0.9} shadow={2.5} />
      <Avatar cx={80} cy={134} r={19} color={C.pink} hair={4} hairColor={C.orange} sw={SW * 0.9} shadow={2.5} face="joy" />
      <Avatar cx={128} cy={130} r={19} color={C.lilac} hair={2} hairColor={C.sun} sw={SW * 0.9} shadow={2.5} />
      <Sparkle x={130} y={20} s={8} sw={SW * 0.8} />
      <Sparkle x={28} y={26} s={6} color={C.lime} sw={SW * 0.7} />
    </svg>
  );
}
