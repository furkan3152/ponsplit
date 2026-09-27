import { C, INK, InkLine, Sparkle, SplitCoin } from "./parts";

const SW = 2.8;
const P = [
  [18, 118],
  [70, 116],
  [110, 96],
  [140, 28],
] as const;

const cubic = (t: number) => {
  const m = 1 - t;
  const w = [m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t];
  const dw = [-3 * m * m, 3 * m * m - 6 * m * t, 6 * m * t - 3 * t * t, 3 * t * t];
  const at = (k: 0 | 1, ws: number[]) => ws.reduce((s, wi, i) => s + wi * P[i][k], 0);
  return { x: at(0, w), y: at(1, w), dx: at(0, dw), dy: at(1, dw) };
};

/** "Trade" step: a coin riding up the green bonding curve, progress bar below. */
export function StepTrade({ className }: { className?: string }) {
  const curve = `M${P[0].join(" ")}C${P[1].join(" ")} ${P[2].join(" ")} ${P[3].join(" ")}`;
  const p = cubic(0.68);
  const len = Math.hypot(p.dx, p.dy);
  const nx = p.dy / len, ny = -p.dx / len; // left normal (points up-left)
  const r = 19;
  const cx = p.x + nx * (r + 3.5), cy = p.y + ny * (r + 3.5);
  const ang = (Math.atan2(p.dy, p.dx) * 180) / Math.PI + 30;
  return (
    <svg viewBox="0 0 160 160" className={className} aria-hidden="true" focusable="false">
      <path d={`${curve}L140 122L18 122Z`} fill={C.lime} opacity={0.38} />
      <path d="M14 122H146" stroke={INK} strokeWidth={SW} strokeLinecap="round" opacity={0.25} />
      <InkLine d={curve} color={C.green} w={5} sw={SW} />
      {/* motion puffs behind the coin */}
      <g stroke={INK} strokeWidth={SW} strokeLinecap="round" opacity={0.45}>
        <path d={`M${Math.round(cx - 30)} ${Math.round(cy + 14)}l-10 4M${Math.round(cx - 26)} ${Math.round(cy + 24)}l-8 3`} />
      </g>
      <g transform={`rotate(${Math.round(ang)} ${Math.round(cx)} ${Math.round(cy)})`}>
        <SplitCoin cx={Math.round(cx)} cy={Math.round(cy)} r={r} sw={SW * 0.9} shadow={2.5} face="happy" />
      </g>
      {/* up arrow at the curve's peak */}
      <path d="M140 12l-7 9h14z" fill={C.green} stroke={INK} strokeWidth={SW * 0.8} strokeLinejoin="round" />
      {/* progress bar */}
      <rect x={18} y={134} width={124} height={13} rx={6.5} fill={INK} transform="translate(2.5 2.5)" />
      <rect x={18} y={134} width={124} height={13} rx={6.5} fill="var(--card)" />
      <rect x={18} y={134} width={124} height={13} rx={6.5} fill="var(--ink-2)" fillOpacity={0.25} stroke={INK} strokeWidth={SW} />
      <rect x={18} y={134} width={86} height={13} rx={6.5} fill={C.green} stroke={INK} strokeWidth={SW} />
      <path d="M26 138.5H60" stroke={C.lime} strokeWidth={2.4} strokeLinecap="round" />
      <Sparkle x={36} y={40} s={9} sw={SW * 0.8} />
      <Sparkle x={58} y={74} s={5} color={C.pink} sw={SW * 0.7} />
    </svg>
  );
}
