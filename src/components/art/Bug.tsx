// Bitbug, Splitdev's mascot: a little beetle (every developer's oldest friend, the bug) whose
// tangerine shell is split down the middle. When it opens its shell, the fees fly out to the
// developers. Pure SVG drawn in a 120×120 box; all colors are CSS variables, so it follows the theme.
import { C, INK, SHINE } from "./parts";

export type BugFace = "happy" | "joy" | "sleepy" | "wow" | "wink";

const SHELL_L = "M60 42C40 42 27 56 27 75C27 94 41 107 60 107Z";
const SHELL_R = "M60 42C80 42 93 56 93 75C93 94 79 107 60 107Z";
/** Left legs; the right ones are mirrored. */
const LEGS = ["M33 60L20 52L13 55", "M29 76L15 76L9 81", "M34 93L22 101L19 109"];

function Eyes({ face, look, sw }: { face: BugFace; look: number; sw: number }) {
  const line = { stroke: INK, strokeWidth: sw, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  const lx = look * 1.6;
  if (face === "sleepy") {
    return (
      <g {...line}>
        <path d="M48 28Q52.5 31 57 28M63 28Q67.5 31 72 28" />
        <path d="M57 37Q60 38.5 63 37" />
      </g>
    );
  }
  if (face === "joy") {
    return (
      <g>
        <path d="M48 30Q52.5 23 57 30M63 30Q67.5 23 72 30" {...line} />
        <path d="M54.5 35Q60 43 65.5 35Z" fill={INK} stroke={INK} strokeWidth={sw * 0.7} strokeLinejoin="round" />
        <circle cx={46} cy={36} r={3} fill={C.pink} opacity={0.75} />
        <circle cx={74} cy={36} r={3} fill={C.pink} opacity={0.75} />
      </g>
    );
  }
  const open = (cx: number) => (
    <g key={cx}>
      <circle cx={cx} cy={28} r={6} fill="#fff" stroke={INK} strokeWidth={sw * 0.8} />
      <circle cx={cx + lx} cy={28.6} r={3} fill={INK} />
      <circle cx={cx + lx + 1.2} cy={27.2} r={1} fill="#fff" />
    </g>
  );
  return (
    <g>
      <g className="bug-eyes">
        {face === "wink" ? [open(52.5), <path key="w" d="M63 29Q67.5 25 72 29" {...line} />] : [open(52.5), open(67.5)]}
      </g>
      {face === "wow" ? <ellipse cx={60} cy={38} rx={2.6} ry={3.2} fill={INK} /> : <path d="M56 37Q60 40.5 64 37" {...line} />}
      <circle cx={45.5} cy={35.5} r={2.6} fill={C.pink} opacity={0.7} />
      <circle cx={74.5} cy={35.5} r={2.6} fill={C.pink} opacity={0.7} />
    </g>
  );
}

/**
 * Bitbug at (x, y) (its centre), `size` px wide. `open` spreads the shell halves by that many
 * degrees; `flap` makes them open and close on their own (CSS, so reduced motion stops it).
 * `shell` and `head` recolor it (developer avatars in the art use other colors).
 */
export function Bug({
  x,
  y,
  size,
  face = "happy",
  open = 0,
  flap = false,
  look = 0,
  shell = C.lime,
  head = C.lilac,
  shadow = true,
  sw = 2.6,
}: {
  x: number;
  y: number;
  size: number;
  face?: BugFace;
  open?: number;
  flap?: boolean;
  look?: number;
  shell?: string;
  head?: string;
  shadow?: boolean;
  sw?: number;
}) {
  const k = size / 120;
  const ink = { stroke: INK, strokeWidth: sw, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  // Legs and antennae are drawn in a color that shows on both papers (the outline ink vanishes on the night paper).
  const limb = { ...ink, stroke: "var(--bug-limb)" };
  const dots = (side: 1 | -1) =>
    [
      [44, 62, 5.2],
      [39, 84, 4.2],
      [51, 96, 3.4],
    ].map(([cx, cy, r]) => <circle key={`${cx}${cy}`} cx={side === 1 ? cx : 120 - cx} cy={cy} r={r} fill={INK} opacity={0.82} />);
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${k})`}>
      {shadow ? <ellipse cx={60} cy={114} rx={36} ry={4.5} fill={INK} opacity={0.18} /> : null}
      {/* antennae with bright tips */}
      <path d="M55 16Q50 6 41 4M65 16Q70 6 79 4" fill="none" {...limb} />
      <circle cx={41} cy={4.5} r={3.6} fill={C.sun} {...limb} strokeWidth={sw * 0.8} />
      <circle cx={79} cy={4.5} r={3.6} fill={C.sun} {...limb} strokeWidth={sw * 0.8} />
      {/* legs */}
      <g fill="none" {...limb}>
        {LEGS.map((d) => (
          <path key={d} d={d} />
        ))}
        <g transform="matrix(-1 0 0 1 120 0)">
          {LEGS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </g>
      {/* body and the soft wings under the shell (seen only when it opens) */}
      <ellipse cx={60} cy={76} rx={30} ry={32} fill={INK} />
      <g opacity={0.55}>
        <ellipse cx={42} cy={78} rx={10} ry={21} fill={C.sky} transform="rotate(22 42 78)" />
        <ellipse cx={78} cy={78} rx={10} ry={21} fill={C.sky} transform="rotate(-22 78 78)" />
      </g>
      {/* head */}
      <circle cx={60} cy={30} r={17} fill={head} {...ink} />
      <Eyes face={face} look={look} sw={sw * 0.9} />
      {/* the split shell */}
      <g className={flap ? "bug-shell-l" : undefined} transform={open ? `rotate(${-open} 59 42)` : undefined}>
        <g transform="translate(-1.2 0)">
          <path d={SHELL_L} fill={shell} {...ink} />
          {dots(1)}
          <path d="M37 59Q41 50 50 47" fill="none" stroke={SHINE} strokeWidth={3} strokeLinecap="round" opacity={0.75} />
        </g>
      </g>
      <g className={flap ? "bug-shell-r" : undefined} transform={open ? `rotate(${open} 61 42)` : undefined}>
        <g transform="translate(1.2 0)">
          <path d={SHELL_R} fill={shell} {...ink} />
          {dots(-1)}
        </g>
      </g>
    </g>
  );
}

/** Bitbug alone in its own <svg>, for the logo and small badges. */
export function BugMark({ size = 32, className, face = "happy" }: { size?: number; className?: string; face?: BugFace }) {
  return (
    <svg width={size} height={size} viewBox="4 -4 112 122" className={className} aria-hidden="true" focusable="false">
      <Bug x={60} y={56} size={120} face={face} shadow={false} sw={3.4} />
    </svg>
  );
}
