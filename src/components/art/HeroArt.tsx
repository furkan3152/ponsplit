import { Avatar, C, Confetti, type Hair, MiniCoin, pt, qPoint, Sparkle, SplitCoin, Star, Trail } from "./parts";

const SW = 3.2;
const COIN = { x: 280, y: 178, r: 80 };
const AVATARS: { x: number; y: number; r: number; color: string; hair: Hair; hairColor: string; bend: number; split?: boolean }[] = [
  { x: 84, y: 104, r: 34, color: C.sky, hair: 0, hairColor: C.sun, bend: -40 },
  { x: 116, y: 288, r: 30, color: C.pink, hair: 4, hairColor: C.orange, bend: 36, split: true },
  { x: 472, y: 78, r: 30, color: C.lilac, hair: 3, hairColor: C.red, bend: 40, split: true },
  { x: 494, y: 234, r: 34, color: C.sun, hair: 1, hairColor: C.green, bend: -34 },
  { x: 380, y: 318, r: 25, color: C.orange, hair: 2, hairColor: C.lilac, bend: -30 },
];

/** Wide hero: a big split coin sharing coins with a ring of X-account avatars. */
export function HeroArt({ className }: { className?: string }) {
  const trails = AVATARS.map((a) => {
    const dx = a.x - COIN.x, dy = a.y - COIN.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const p0: [number, number] = [COIN.x + ux * (COIN.r + 16), COIN.y + uy * (COIN.r + 16)];
    const p2: [number, number] = [a.x - ux * (a.r + 14), a.y - uy * (a.r + 14)];
    const p1: [number, number] = [(p0[0] + p2[0]) / 2 - uy * a.bend, (p0[1] + p2[1]) / 2 + ux * a.bend];
    return { a, d: `M${pt(...p0)}Q${pt(...p1)} ${pt(...p2)}`, coin: qPoint(p0, p1, p2, 0.52) };
  });
  return (
    <svg viewBox="0 0 560 360" className={className} aria-hidden="true" focusable="false">
      <ellipse cx={COIN.x + 4} cy={296} rx={70} ry={8} fill="var(--outline)" opacity={0.08} />
      {trails.map((t, i) => (
        <Trail key={i} d={t.d} sw={SW} />
      ))}
      {/* confetti */}
      <Confetti x={196} y={46} kind="r" color={C.pink} sw={SW} rot={-24} />
      <Confetti x={372} y={36} kind="w" color={C.sky} sw={SW} rot={12} />
      <Confetti x={28} y={214} kind="w" color={C.lime} sw={SW} rot={-18} />
      <Confetti x={540} y={148} kind="r" color={C.lilac} sw={SW} rot={30} />
      <Confetti x={236} y={334} kind="r" color={C.sun} sw={SW} rot={14} />
      <Confetti x={172} y={186} kind="d" color={C.orange} sw={SW} />
      <Confetti x={404} y={186} kind="d" color={C.pink} sw={SW} />
      <Confetti x={516} y={320} kind="d" color={C.lime} sw={SW} />
      <Confetti x={40} y={330} kind="r" color={C.sky} sw={SW} rot={-40} />
      <Star x={214} y={88} s={12} sw={SW * 0.85} rot={-8} />
      <Star x={528} y={30} s={9} color={C.pink} sw={SW * 0.8} rot={10} />
      <Star x={30} y={40} s={8} color={C.lime} sw={SW * 0.8} />
      <SplitCoin cx={COIN.x} cy={COIN.y} r={COIN.r} sw={SW} spread={4} shadow={4.5} face="joy" />
      {/* motion ticks at the ends of the split */}
      <g stroke="var(--outline)" strokeWidth={SW} strokeLinecap="round">
        <path d="M350 96l10 -10M366 110l12 -6M340 84l4 -12" />
        <path d="M210 260l-10 10M194 246l-12 6M220 272l-4 12" />
      </g>
      {trails.map((t, i) => (
        <MiniCoin key={i} cx={t.coin[0]} cy={t.coin[1]} r={11} sw={SW * 0.85} split={t.a.split} color={i % 2 ? C.sun : C.lime} />
      ))}
      {AVATARS.map((a, i) => (
        <Avatar key={i} cx={a.x} cy={a.y} r={a.r} color={a.color} hair={a.hair} hairColor={a.hairColor} sw={SW * 0.9} face={i % 2 ? "joy" : "happy"} />
      ))}
      <Sparkle x={374} y={120} s={11} sw={SW * 0.8} />
      <Sparkle x={178} y={128} s={8} color={C.lime} sw={SW * 0.8} />
      <Sparkle x={328} y={292} s={9} color={C.sky} sw={SW * 0.8} />
    </svg>
  );
}
