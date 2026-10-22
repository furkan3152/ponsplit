// Shared "chunky sticker" building blocks for Splitdev illustrations.
// Pure SVG, no ids, all colors via CSS variables.
import type { ReactNode } from "react";

export const INK = "var(--outline)";
export const SHINE = "var(--shine, #fff)";
export const C = {
  lime: "var(--lime)",
  green: "var(--green)",
  red: "var(--red)",
  sky: "var(--sky)",
  pink: "var(--pink)",
  sun: "var(--sun)",
  lilac: "var(--lilac)",
  orange: "var(--orange)",
  ink2: "var(--ink-2)",
} as const;

const q = (n: number) => Math.round(n * 100) / 100;
export const pt = (x: number, y: number) => `${q(x)} ${q(y)}`;

/** Point on a circle, angle in degrees, math orientation (y up). */
export const onCircle = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
};

const SQ = Math.SQRT1_2;

/** Two halves of a coin split by a "/" diagonal gap. [upper-left, lower-right] path data. */
export function splitHalves(cx: number, cy: number, r: number, gap: number, spread = 0): [string, string] {
  const h = gap / 2;
  const s = Math.sqrt(r * r - h * h);
  // n: normal toward upper-left, d: along the cut toward upper-right
  const nx = -SQ, ny = -SQ, dx = SQ, dy = -SQ;
  const o = h + spread;
  const a1 = pt(cx + nx * o + dx * s, cy + ny * o + dy * s);
  const a2 = pt(cx + nx * o - dx * s, cy + ny * o - dy * s);
  const b1 = pt(cx - nx * o + dx * s, cy - ny * o + dy * s);
  const b2 = pt(cx - nx * o - dx * s, cy - ny * o - dy * s);
  return [`M${a1}A${q(r)} ${q(r)} 0 0 0 ${a2}Z`, `M${b1}A${q(r)} ${q(r)} 0 0 1 ${b2}Z`];
}

export type FaceKind = "happy" | "joy" | "sleepy" | "confused" | "wow";

/** Kawaii face centered on (cx, cy) for a body of radius r. */
export function Face({
  cx: cx0,
  cy: cy0,
  r,
  kind = "happy",
  sw,
  look = 0,
  split = false,
}: {
  cx: number;
  cy: number;
  r: number;
  kind?: FaceKind;
  sw: number;
  look?: number;
  /** Lay the face out so the "/" split gap runs between the eyes and clear of the mouth. */
  split?: boolean;
}) {
  const cx = split ? cx0 + r * 0.07 : cx0;
  const cy = split ? cy0 - r * 0.04 : cy0;
  const ex = split ? r * 0.38 : r * 0.3;
  const ey = cy - r * 0.06;
  const er = Math.max(r * 0.085, 2.3);
  const lx = look * r * 0.08;
  const eyes: ReactNode[] = [];
  let mouth: ReactNode = null;
  const stroke = { stroke: INK, strokeWidth: sw, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  for (const side of [-1, 1]) {
    const x = cx + side * ex + lx;
    if (kind === "joy") {
      eyes.push(<path key={side} d={`M${pt(x - r * 0.09, ey + r * 0.03)}Q${pt(x, ey - r * 0.11)} ${pt(x + r * 0.09, ey + r * 0.03)}`} {...stroke} />);
    } else if (kind === "sleepy") {
      eyes.push(<path key={side} d={`M${pt(x - r * 0.12, ey)}Q${pt(x, ey + r * 0.11)} ${pt(x + r * 0.12, ey)}`} {...stroke} />);
    } else {
      const rr = kind === "wow" ? er * 1.35 : kind === "confused" && side === 1 ? er * 1.25 : er;
      eyes.push(
        <g key={side}>
          <circle cx={q(x)} cy={q(ey)} r={q(rr)} fill={INK} />
          <circle cx={q(x + rr * 0.35)} cy={q(ey - rr * 0.38)} r={q(rr * 0.36)} fill={SHINE} />
        </g>,
      );
    }
  }
  const my = cy + r * (split ? 0.25 : 0.2);
  const mx = split ? cx + r * 0.08 : cx;
  if (kind === "happy") {
    mouth = <path d={`M${pt(mx - r * 0.15, my)}Q${pt(mx, my + r * 0.16)} ${pt(mx + r * 0.15, my)}`} {...stroke} />;
  } else if (kind === "joy") {
    mouth = (
      <g>
        <path d={`M${pt(mx - r * 0.17, my - r * 0.03)}Q${pt(mx, my + r * 0.36)} ${pt(mx + r * 0.17, my - r * 0.03)}Z`} fill={INK} stroke={INK} strokeWidth={sw * 0.6} strokeLinejoin="round" />
        <ellipse cx={q(mx)} cy={q(my + r * 0.1)} rx={q(r * 0.07)} ry={q(r * 0.04)} fill={C.pink} />
      </g>
    );
  } else if (kind === "sleepy") {
    mouth = <ellipse cx={q(mx + r * 0.02)} cy={q(my + r * 0.04)} rx={q(r * 0.055)} ry={q(r * 0.07)} fill={INK} />;
  } else if (kind === "wow") {
    mouth = <ellipse cx={q(mx)} cy={q(my + r * 0.05)} rx={q(r * 0.08)} ry={q(r * 0.1)} fill={INK} />;
  } else {
    const s = r * 0.07;
    mouth = <path d={`M${pt(mx - s * 2, my + r * 0.06)}q${pt(s * 0.5, -s)} ${pt(s, 0)}t${pt(s, 0)}t${pt(s, 0)}t${pt(s, 0)}`} {...stroke} />;
  }
  const brow =
    kind === "confused" ? (
      <path d={`M${pt(cx + ex + lx - r * 0.12, ey - r * 0.2)}Q${pt(cx + ex + lx, ey - r * 0.3)} ${pt(cx + ex + lx + r * 0.13, ey - r * 0.22)}`} {...stroke} />
    ) : null;
  return (
    <g>
      <ellipse cx={q(cx - r * 0.5 + lx)} cy={q(cy + r * 0.13)} rx={q(r * 0.12)} ry={q(r * 0.07)} fill={C.pink} opacity={0.85} />
      <ellipse cx={q(cx + r * 0.5 + lx)} cy={q(cy + r * 0.13)} rx={q(r * 0.12)} ry={q(r * 0.07)} fill={C.pink} opacity={0.85} />
      {eyes}
      {brow}
      {mouth}
    </g>
  );
}

/** The brand split coin, optionally with a face and halves pulled apart. */
export function SplitCoin({
  cx,
  cy,
  r,
  sw,
  gap = sw * 1.1 + r * 0.05,
  spread = 0,
  shadow = sw,
  face,
  look,
  shine = true,
}: {
  cx: number;
  cy: number;
  r: number;
  sw: number;
  gap?: number;
  spread?: number;
  shadow?: number;
  face?: FaceKind;
  look?: number;
  shine?: boolean;
}) {
  const [a, b] = splitHalves(cx, cy, r, gap, spread);
  const [s1x, s1y] = onCircle(cx, cy - 0, r * 0.72, 150);
  const [s2x, s2y] = onCircle(cx, cy, r * 0.72, 118);
  const lo = { stroke: INK, strokeWidth: sw, strokeLinejoin: "round" as const };
  return (
    <g>
      {shadow > 0 && (
        <g transform={`translate(${q(shadow)} ${q(shadow)})`} fill={INK}>
          <path d={b} {...lo} />
        </g>
      )}
      <path d={a} fill={C.lime} {...lo} />
      <path d={b} fill={C.green} {...lo} />
      {shine && (
        <path
          d={`M${pt(s1x - spread * SQ, s1y - spread * SQ)}A${q(r * 0.72)} ${q(r * 0.72)} 0 0 1 ${pt(s2x - spread * SQ, s2y - spread * SQ)}`}
          stroke={SHINE}
          strokeWidth={q(sw * 1.05)}
          strokeLinecap="round"
          fill="none"
        />
      )}
      {face && <Face cx={cx} cy={cy} r={r} kind={face} sw={sw} look={look} split />}
    </g>
  );
}

/** Small gold coin (or mini split coin) used as flying money. */
export function MiniCoin({ cx, cy, r, sw, split = false, color = C.sun }: { cx: number; cy: number; r: number; sw: number; split?: boolean; color?: string }) {
  if (split) return <SplitCoin cx={cx} cy={cy} r={r} sw={sw} gap={r * 0.2} shadow={sw * 0.8} shine={false} />;
  return (
    <g>
      <circle cx={q(cx + sw * 0.8)} cy={q(cy + sw * 0.8)} r={q(r)} fill={INK} stroke={INK} strokeWidth={sw} />
      <circle cx={q(cx)} cy={q(cy)} r={q(r)} fill={color} stroke={INK} strokeWidth={sw} />
      <circle cx={q(cx)} cy={q(cy)} r={q(r * 0.55)} fill="none" stroke={INK} strokeWidth={q(sw * 0.6)} opacity={0.35} />
      <path d={`M${pt(cx - r * 0.18, cy - r * 0.3)}L${pt(cx - r * 0.18, cy + r * 0.3)}`} stroke={INK} strokeWidth={q(sw * 0.6)} strokeLinecap="round" opacity={0.45} />
    </g>
  );
}

/** Concave 4-point sparkle. */
export function Sparkle({ x, y, s, color = C.sun, sw }: { x: number; y: number; s: number; color?: string; sw: number }) {
  const k = s * 0.18;
  return (
    <path
      d={`M${pt(x, y - s)}Q${pt(x + k, y - k)} ${pt(x + s, y)}Q${pt(x + k, y + k)} ${pt(x, y + s)}Q${pt(x - k, y + k)} ${pt(x - s, y)}Q${pt(x - k, y - k)} ${pt(x, y - s)}Z`}
      fill={color}
      stroke={INK}
      strokeWidth={sw}
      strokeLinejoin="round"
    />
  );
}

export type Hair = 0 | 1 | 2 | 3 | 4;

/** Round avatar bubble standing in for a developer. */
export function Avatar({
  cx,
  cy,
  r,
  color,
  hair,
  hairColor = C.lilac,
  sw,
  face = "happy",
  shadow = sw,
}: {
  cx: number;
  cy: number;
  r: number;
  color: string;
  hair: Hair;
  hairColor?: string;
  sw: number;
  face?: FaceKind;
  shadow?: number;
}) {
  const P = (deg: number, rr = r) => pt(...onCircle(cx, cy, rr, deg));
  const X = (f: number) => q(cx + r * f);
  const Y = (f: number) => q(cy + r * f);
  const hs = { fill: hairColor, stroke: INK, strokeWidth: sw, strokeLinejoin: "round" as const };
  let behind: ReactNode = null;
  let front: ReactNode = null;
  if (hair === 0) {
    // side-swept fringe
    front = <path d={`M${P(165)}A${q(r)} ${q(r)} 0 0 1 ${P(15)}Q${X(0.55)} ${Y(-0.1)} ${X(0.1)} ${Y(-0.42)}Q${X(-0.1)} ${Y(-0.2)} ${X(-0.45)} ${Y(-0.2)}Q${X(-0.7)} ${Y(-0.2)} ${P(165)}Z`} {...hs} />;
  } else if (hair === 1) {
    // spiky
    front = (
      <path
        d={`M${P(160)}L${X(-0.8)} ${Y(-1.02)}L${X(-0.38)} ${Y(-0.86)}L${X(-0.12)} ${Y(-1.22)}L${X(0.18)} ${Y(-0.88)}L${X(0.6)} ${Y(-1.1)}L${X(0.62)} ${Y(-0.72)}L${P(20)}Q${X(0.3)} ${Y(-0.3)} ${X(0)} ${Y(-0.46)}Q${X(-0.4)} ${Y(-0.26)} ${P(160)}Z`}
        {...hs}
      />
    );
  } else if (hair === 2) {
    // bun + fringe
    behind = <circle cx={X(0)} cy={Y(-1.02)} r={q(r * 0.32)} {...hs} />;
    front = <path d={`M${P(160)}A${q(r)} ${q(r)} 0 0 1 ${P(20)}Q${X(0.4)} ${Y(-0.28)} ${X(0)} ${Y(-0.36)}Q${X(-0.4)} ${Y(-0.28)} ${P(160)}Z`} {...hs} />;
  } else if (hair === 3) {
    // cap with brim
    front = (
      <g>
        <path d={`M${X(0.3)} ${Y(-0.42)}Q${X(1.05)} ${Y(-0.5)} ${X(1.18)} ${Y(-0.28)}Q${X(0.9)} ${Y(-0.2)} ${X(0.4)} ${Y(-0.28)}Z`} {...hs} />
        <path d={`M${P(168)}A${q(r)} ${q(r)} 0 0 1 ${P(18)}Q${X(0)} ${Y(-0.5)} ${P(168)}Z`} {...hs} />
        <circle cx={X(0)} cy={Y(-1.02)} r={q(sw * 0.9)} fill={INK} />
      </g>
    );
  } else {
    // bob
    behind = <path d={`M${X(-1.12)} ${Y(0.55)}Q${X(-1.3)} ${Y(-1.2)} ${X(0)} ${Y(-1.16)}Q${X(1.3)} ${Y(-1.2)} ${X(1.12)} ${Y(0.55)}Z`} {...hs} />;
    front = <path d={`M${P(170)}A${q(r)} ${q(r)} 0 0 1 ${P(10)}Q${X(0.3)} ${Y(-0.5)} ${X(-0.05)} ${Y(-0.3)}Q${X(-0.5)} ${Y(-0.5)} ${P(170)}Z`} {...hs} />;
  }
  return (
    <g>
      {shadow > 0 && (
        <g transform={`translate(${q(shadow)} ${q(shadow)})`}>
          <circle cx={q(cx)} cy={q(cy)} r={q(r)} fill={INK} stroke={INK} strokeWidth={sw} />
        </g>
      )}
      {behind}
      <circle cx={q(cx)} cy={q(cy)} r={q(r)} fill={color} stroke={INK} strokeWidth={sw} />
      <Face cx={cx} cy={cy + r * 0.14} r={r * 0.92} kind={face} sw={sw * 0.85} />
      {front}
    </g>
  );
}

/** Stroked-over-ink line: a colored path with a chunky outline. */
export function InkLine({ d, color, w, sw }: { d: string; color: string; w: number; sw: number }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={INK} strokeWidth={w + sw * 2} />
      <path d={d} stroke={color} strokeWidth={w} />
    </g>
  );
}

/** Question mark drawn as an outlined stroke (no font dependency). */
export function QMark({ x, y, s, color, sw, rot = 0 }: { x: number; y: number; s: number; color: string; sw: number; rot?: number }) {
  const d = "M-6 -7C-6 -15 7 -15 7 -7C7 -2 0 -2 0 4";
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      <InkLine d={d} color={color} w={4.2} sw={sw / s} />
      <circle cx={0} cy={11.5} r={2.6 + sw / s / 2} fill={INK} />
      <circle cx={0} cy={11.5} r={2.1} fill={color} />
    </g>
  );
}

/** A thick colored stroke with an ink edge: the hand-drawn line every dev doodle is made of. */
function Glyph({ d, color, sw, transform }: { d: string; color: string; sw: number; transform?: string }) {
  const base = { d, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <g transform={transform}>
      <path {...base} stroke={INK} strokeWidth={sw * 2.6} />
      <path {...base} stroke={color} strokeWidth={sw * 1.2} />
    </g>
  );
}

/** "</>" centered on (x, y), `s` wide. */
export function CodeTag({ x, y, s, color = C.lime, sw, rot = 0 }: { x: number; y: number; s: number; color?: string; sw: number; rot?: number }) {
  const h = s * 0.32;
  const d = `M${pt(x - s * 0.22, y - h)}L${pt(x - s / 2, y)}L${pt(x - s * 0.22, y + h)}M${pt(x + s * 0.22, y - h)}L${pt(x + s / 2, y)}L${pt(x + s * 0.22, y + h)}M${pt(x + s * 0.09, y - h * 1.15)}L${pt(x - s * 0.09, y + h * 1.15)}`;
  return <Glyph d={d} color={color} sw={sw} transform={rot ? `rotate(${rot} ${x} ${y})` : undefined} />;
}

/** "{ }" centered on (x, y), `s` wide. */
export function Braces({ x, y, s, color = C.lilac, sw, rot = 0 }: { x: number; y: number; s: number; color?: string; sw: number; rot?: number }) {
  const h = s * 0.42;
  const w = s * 0.12;
  const brace = (cx: number, dir: 1 | -1) =>
    `M${pt(cx + dir * w, y - h)}Q${pt(cx, y - h)} ${pt(cx, y - h * 0.6)}V${q(y - h * 0.22)}Q${pt(cx, y)} ${pt(cx - dir * w, y)}Q${pt(cx, y)} ${pt(cx, y + h * 0.22)}V${q(y + h * 0.6)}Q${pt(cx, y + h)} ${pt(cx + dir * w, y + h)}`;
  return <Glyph d={`${brace(x - s * 0.34, 1)}${brace(x + s * 0.34, -1)}`} color={color} sw={sw} transform={rot ? `rotate(${rot} ${x} ${y})` : undefined} />;
}

/** A little git graph: a main line with commits and one branch that forks off and comes back. */
export function Commits({ x, y, s, sw }: { x: number; y: number; s: number; sw: number }) {
  const k = s / 100;
  const P = (a: number, b: number) => pt(x + a * k, y + b * k);
  const dots: [number, number, string][] = [
    [0, 0, C.lime],
    [0, 34, C.sky],
    [30, 52, C.pink],
    [0, 70, C.sun],
    [0, 100, C.lime],
  ];
  return (
    <g>
      <path d={`M${P(0, 0)}V${q(y + 100 * k)}M${P(0, 34)}Q${P(30, 34)} ${P(30, 52)}Q${P(30, 70)} ${P(0, 74)}`} fill="none" stroke="var(--ink-3)" strokeWidth={sw} strokeLinecap="round" />
      {dots.map(([a, b, c]) => (
        <circle key={`${a}${b}`} cx={x + a * k} cy={y + b * k} r={7 * k + 2} fill={c} stroke={INK} strokeWidth={sw * 0.8} />
      ))}
    </g>
  );
}
