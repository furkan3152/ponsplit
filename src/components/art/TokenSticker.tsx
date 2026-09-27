import type { ReactNode } from "react";

const INK = "var(--outline)";
const SHINE = "var(--shine, #fff)";
const PALETTE = ["var(--lime)", "var(--green)", "var(--sky)", "var(--pink)", "var(--sun)", "var(--lilac)", "var(--orange)", "var(--red)"];
const PINK = 3, RED = 7;

/** FNV-1a (32-bit) over the lowercased seed, then an avalanche mix. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  const s = seed.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

const q = (n: number) => Math.round(n * 100) / 100;

/** Smooth closed blob through points (Catmull-Rom -> cubic bezier). */
function blobPath(pts: [number, number][]): string {
  const n = pts.length;
  let d = `M${q(pts[0][0])} ${q(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${q(p1[0] + (p2[0] - p0[0]) / 6)} ${q(p1[1] + (p2[1] - p0[1]) / 6)} ${q(p2[0] - (p3[0] - p1[0]) / 6)} ${q(p2[1] - (p3[1] - p1[1]) / 6)} ${q(p2[0])} ${q(p2[1])}`;
  }
  return `${d}Z`;
}

export interface TokenStickerProps {
  /** Token address (0x...). Same seed always yields the same sticker. */
  seed: string;
  size?: number;
  className?: string;
}

/** Deterministic generative sticker avatar for tokens without an image. */
export function TokenSticker({ seed, size = 48, className }: TokenStickerProps) {
  const h = hash(seed);
  const h2 = hash(`${seed}#2`);
  const bodyI = h % 8;
  const bgI = (bodyI + 2 + ((h >>> 3) % 5)) % 8;
  const shape = (h >>> 6) & 3;
  const eyes = (h >>> 8) & 3;
  const mouth = (h >>> 10) & 3;
  const acc = (h >>> 12) % 6; // 0 none, 1 hat, 2 sparkle, 3 bow, 4 antenna, 5 glasses
  let accI = (h >>> 16) % 8;
  if (accI === bodyI) accI = (accI + 3) % 8;
  const tilt = ((h2 % 7) - 3) * 2.5;
  const body = PALETTE[bodyI], accC = PALETTE[accI];
  const SW = 2.3;
  const lo = { stroke: INK, strokeWidth: SW, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

  // body shape
  const cx = 24, cy = 27.5;
  let shapeEl: (p: object) => ReactNode;
  let top = 13;
  if (shape === 0) {
    shapeEl = (p) => <circle cx={cx} cy={cy} r={14.5} {...p} />;
    top = cy - 14.5;
  } else if (shape === 1) {
    shapeEl = (p) => <rect x={10} y={14} width={28} height={27} rx={9} {...p} />;
    top = 14;
  } else if (shape === 2) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
      const r = 13.2 + ((h2 >>> (i * 3)) & 7) * 0.42;
      pts.push([cx + Math.cos(a) * r * 1.02, cy + Math.sin(a) * r]);
    }
    const d = blobPath(pts);
    shapeEl = (p) => <path d={d} {...p} />;
    top = pts[0][1] + 0.5;
  } else {
    shapeEl = (p) => <rect x={12} y={12} width={24} height={31} rx={12} {...p} />;
    top = 12;
  }

  const ey = 25.5, exL = 18.6, exR = 29.4;
  const eyeStroke = { stroke: INK, strokeWidth: 2, strokeLinecap: "round" as const, fill: "none" };
  const dot = (x: number) => <circle key={x} cx={x} cy={ey} r={2.2} fill={INK} />;
  const arc = (x: number) => <path key={x} d={`M${x - 2.5} ${ey + 1}Q${x} ${ey - 2.8} ${x + 2.5} ${ey + 1}`} {...eyeStroke} />;
  let eyeEls: ReactNode[];
  if (acc === 5 || eyes === 0) eyeEls = [dot(exL), dot(exR)];
  else if (eyes === 1) eyeEls = [arc(exL), arc(exR)];
  else if (eyes === 2) eyeEls = [dot(exL), <path key="w" d={`M${exR - 2.2} ${ey - 2.2}L${exR + 1.6} ${ey}L${exR - 2.2} ${ey + 2.2}`} {...eyeStroke} strokeLinejoin="round" />];
  else
    eyeEls = [exL, exR].map((x) => (
      <g key={x}>
        <circle cx={x} cy={ey} r={3.3} fill={INK} />
        <circle cx={x + 1.1} cy={ey - 1.2} r={1.25} fill={SHINE} />
      </g>
    ));

  const my = 31;
  let mouthEl: ReactNode;
  if (mouth === 0) mouthEl = <path d={`M20.6 ${my}Q24 ${my + 3.6} 27.4 ${my}`} {...eyeStroke} />;
  else if (mouth === 1)
    mouthEl = (
      <g>
        <path d={`M20.2 ${my - 0.4}Q24 ${my + 7} 27.8 ${my - 0.4}Z`} fill={INK} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
        <ellipse cx={24} cy={my + 2.6} rx={1.9} ry={1.1} fill={bodyI === PINK ? "var(--red)" : "var(--pink)"} />
      </g>
    );
  else if (mouth === 2) mouthEl = <path d={`M20.4 ${my}Q22.2 ${my + 2.6} 24 ${my + 0.3}Q25.8 ${my + 2.6} 27.6 ${my}`} {...eyeStroke} strokeLinejoin="round" />;
  else mouthEl = <ellipse cx={24} cy={my + 1.2} rx={1.8} ry={2.1} fill={INK} />;

  const blush = bodyI === PINK || bodyI === RED ? "var(--sun)" : "var(--pink)";
  let behind: ReactNode = null;
  let front: ReactNode = null;
  if (acc === 1) {
    front = (
      <g transform={`rotate(14 26 ${top})`}>
        <path d={`M20 ${top + 2.5}L32 ${top + 2.5}L26 ${top - 8}Z`} fill={accC} stroke={INK} strokeWidth={1.9} strokeLinejoin="round" />
        <circle cx={26} cy={top - 8.6} r={2.1} fill="var(--sun)" stroke={INK} strokeWidth={1.5} />
      </g>
    );
  } else if (acc === 2) {
    const x = 39, y = 10, s = 5.6, k = 1;
    front = (
      <g>
        <path d={`M${x} ${y - s}Q${x + k} ${y - k} ${x + s} ${y}Q${x + k} ${y + k} ${x} ${y + s}Q${x - k} ${y + k} ${x - s} ${y}Q${x - k} ${y - k} ${x} ${y - s}Z`} fill={accI === 4 ? "var(--sun)" : accC} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
        <circle cx={8.5} cy={11} r={1.6} fill={accC} stroke={INK} strokeWidth={1.1} />
      </g>
    );
  } else if (acc === 3) {
    const x = 15, y = top + 3.5;
    front = (
      <g fill={accC} stroke={INK} strokeWidth={1.7} strokeLinejoin="round">
        <path d={`M${x} ${y}L${x - 6} ${y - 4.5}L${x - 5.4} ${y + 4}Z`} />
        <path d={`M${x} ${y}L${x + 6} ${y - 4.5}L${x + 5.4} ${y + 4}Z`} />
        <circle cx={x} cy={y} r={2} />
      </g>
    );
  } else if (acc === 4) {
    behind = (
      <g>
        <path d={`M24 ${top + 2}Q24 ${top - 5} 29 ${top - 7}`} fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
        <circle cx={29.5} cy={top - 7.5} r={2.9} fill={accC} stroke={INK} strokeWidth={1.7} />
      </g>
    );
  } else if (acc === 5) {
    front = (
      <g fill={SHINE} fillOpacity={0.35} stroke={INK} strokeWidth={1.8}>
        <circle cx={exL} cy={ey} r={4.4} />
        <circle cx={exR} cy={ey} r={4.4} />
        <path d={`M${exL + 4.4} ${ey - 0.5}Q24 ${ey - 2.2} ${exR - 4.4} ${ey - 0.5}`} fill="none" />
      </g>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <rect width={48} height={48} rx={13.5} fill="var(--card)" />
      <rect width={48} height={48} rx={13.5} fill={PALETTE[bgI]} fillOpacity={0.32} />
      <g transform={`rotate(${tilt} 24 28)`}>
        {behind}
        <g transform="translate(1.7 1.7)">{shapeEl({ fill: INK, ...lo })}</g>
        {shapeEl({ fill: body, ...lo })}
        <path d={`M${shape === 1 ? 15 : 16} ${shape === 3 ? 20 : 21}Q${shape === 1 ? 15.5 : 17} ${top + 3.5} 22 ${top + 3}`} fill="none" stroke={SHINE} strokeWidth={2} strokeLinecap="round" opacity={0.75} />
        <ellipse cx={14.8} cy={29.6} rx={2.4} ry={1.4} fill={blush} opacity={0.8} />
        <ellipse cx={33.2} cy={29.6} rx={2.4} ry={1.4} fill={blush} opacity={0.8} />
        {eyeEls}
        {mouthEl}
        {front}
      </g>
    </svg>
  );
}
