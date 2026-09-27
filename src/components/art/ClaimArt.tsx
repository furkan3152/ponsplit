import { Avatar, C, INK, InkLine, MiniCoin, Sparkle } from "./parts";

const SW = 2.8;

/** Happy avatar catching a stack of coins, for the claim page. */
export function ClaimArt({ className }: { className?: string }) {
  const lo = { stroke: INK, strokeWidth: SW, strokeLinejoin: "round" as const };
  const coins = [0, 1, 2, 3].map((i) => {
    const y = 136 - i * 9;
    const x = 100 + (i % 2 ? 3 : -2);
    const side = `M${x - 26} ${y}A26 8 0 0 0 ${x + 26} ${y}V${y + 7}A26 8 0 0 1 ${x - 26} ${y + 7}Z`;
    return (
      <g key={i}>
        <path d={side} fill={i % 2 ? C.green : C.sun} {...lo} />
        <ellipse cx={x} cy={y} rx={26} ry={8} fill={i % 2 ? C.lime : C.sun} {...lo} />
        {i === 3 && <path d={`M${x + 8} ${y - 7}L${x - 8} ${y + 7}`} stroke={INK} strokeWidth={SW} strokeLinecap="round" />}
      </g>
    );
  });
  return (
    <svg viewBox="0 0 200 160" className={className} aria-hidden="true" focusable="false">
      <ellipse cx={100} cy={152} rx={50} ry={5} fill={INK} opacity={0.1} />
      <Avatar cx={100} cy={62} r={38} color={C.sky} hair={4} hairColor={C.lilac} sw={SW} face="joy" shadow={3.5} />
      <g transform="translate(3 3)">
        <path d="M74 136V143A26 8 0 0 0 126 143V111H74Z" fill={INK} />
      </g>
      {coins}
      <InkLine d="M66 78Q56 104 72 122" color={C.sky} w={5} sw={SW} />
      <InkLine d="M134 78Q144 104 128 122" color={C.sky} w={5} sw={SW} />
      <circle cx={72} cy={120} r={6} fill={C.sky} {...lo} />
      <circle cx={128} cy={120} r={6} fill={C.sky} {...lo} />
      <MiniCoin cx={34} cy={40} r={9} sw={SW * 0.85} split />
      <MiniCoin cx={166} cy={26} r={8} sw={SW * 0.85} />
      <MiniCoin cx={160} cy={84} r={7} sw={SW * 0.85} color={C.lime} />
      <Sparkle x={42} y={96} s={7} sw={SW * 0.75} color={C.pink} />
      <Sparkle x={140} y={10} s={6} sw={SW * 0.7} />
      <Sparkle x={24} y={10} s={5} sw={SW * 0.7} color={C.lime} />
    </svg>
  );
}
