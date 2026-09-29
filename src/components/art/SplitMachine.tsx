"use client";

import { useId } from "react";
import { useEffect } from "react";
import { useInView, useReducedMotion } from "../motion";
import { Avatar, C, type Hair, INK, splitHalves } from "./parts";

const CX = 280;
const CY = 214;
const R = 76;

/** Where the five accounts sit around the coin, and how their streams bend. */
const SLOTS: { x: number; y: number; color: string; hair: Hair; hairColor: string; bend: number; face: "happy" | "joy" }[] = [
  { x: 92, y: 96, color: C.sky, hair: 0, hairColor: C.sun, bend: -46, face: "happy" },
  { x: 470, y: 84, color: C.pink, hair: 3, hairColor: C.lilac, bend: 44, face: "joy" },
  { x: 498, y: 292, color: C.sun, hair: 1, hairColor: C.green, bend: -40, face: "happy" },
  { x: 318, y: 390, color: C.lilac, hair: 2, hairColor: C.orange, bend: 34, face: "joy" },
  { x: 72, y: 318, color: C.orange, hair: 4, hairColor: C.sky, bend: 38, face: "happy" },
];

/** A real X account the coin pays: its username, share, and profile photo when known. */
export type MachineAccount = { handle: string; pct: number; image?: string };

const r2 = (n: number) => Math.round(n * 10) / 10;

/**
 * The home hero: a coin that keeps splitting. Every trade's fee leaves the coin as a stream of
 * drops, one stream per X account, sized by its share. Pure SVG; motion stops for visitors who
 * ask for less of it.
 */
export function SplitMachine({ className, accounts, caption = "CREATOR FEES, EVERY TRADE" }: { className?: string; accounts: MachineAccount[]; caption?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const halves = splitHalves(CX, CY, R, 9);
  const reduced = useReducedMotion();
  // All of this motion repaints the whole drawing every frame, so it only runs while on screen.
  const [ref, onScreen] = useInView<SVGSVGElement>({ once: false, rootMargin: "0px" });
  useEffect(() => {
    const svg = ref.current;
    if (!svg?.pauseAnimations) return;
    if (onScreen) svg.unpauseAnimations();
    else svg.pauseAnimations();
  }, [onScreen, ref]);
  const NODES = accounts.slice(0, SLOTS.length).map((a, i) => ({ ...SLOTS[i], handle: `@${a.handle}`, pct: `${+a.pct.toFixed(1)}%`, weight: a.pct, image: a.image }));
  const streams = NODES.map((n, i) => {
    const dx = n.x - CX;
    const dy = n.y - CY;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const x0 = CX + ux * (R + 12);
    const y0 = CY + uy * (R + 12);
    const x3 = n.x - ux * 38;
    const y3 = n.y - uy * 38;
    const mx = (x0 + x3) / 2 - uy * n.bend;
    const my = (y0 + y3) / 2 + ux * n.bend;
    return { id: `${uid}s${i}`, d: `M${r2(x0)} ${r2(y0)}Q${r2(mx)} ${r2(my)} ${r2(x3)} ${r2(y3)}`, n, weight: n.weight };
  });

  return (
    <svg
      ref={ref}
      viewBox="0 0 560 450"
      className={`${className ?? ""} ${onScreen ? "" : "motion-paused"}`}
      role="img"
      aria-label={`A coin splitting its trading fees between ${NODES.map((n) => `${n.handle} (${n.pct})`).join(", ")}`}
    >
      <defs>
        <radialGradient id={`${uid}glow`}>
          <stop offset="0%" stopColor="var(--lime)" stopOpacity="0.38" />
          <stop offset="60%" stopColor="var(--lime)" stopOpacity="0.06" />
          <stop offset="100%" stopColor="var(--lime)" stopOpacity="0" />
        </radialGradient>
        {streams.map((s) => (
          <path key={s.id} id={s.id} d={s.d} />
        ))}
      </defs>

      {/* orbits */}
      <g className="origin-center animate-spin-slow" style={{ transformBox: "fill-box" }}>
        <circle cx={CX} cy={CY} r={128} fill="none" stroke="var(--line-2)" strokeWidth={1.2} strokeDasharray="2 9" />
      </g>
      <circle cx={CX} cy={CY} r={186} fill="none" stroke="var(--line)" strokeWidth={1} strokeDasharray="1 7" />
      <circle cx={CX} cy={CY} r={150} fill={`url(#${uid}glow)`} />

      {/* fee streams: dashed rails plus drops travelling down each one */}
      {streams.map((s, i) => (
        <g key={s.id}>
          <use href={`#${s.id}`} fill="none" stroke={s.n.color} strokeOpacity={0.28} strokeWidth={2 + s.weight / 10} strokeLinecap="round" />
          <use href={`#${s.id}`} fill="none" stroke={s.n.color} strokeWidth={2} strokeLinecap="round" strokeDasharray="4 12" className="animate-flow" style={{ animationDuration: `${1.2 + i * 0.15}s` }} />
          {reduced
            ? null
            : [0, 1].map((k) => (
                <circle key={k} r={4.5} fill={s.n.color} stroke={INK} strokeWidth={1.5}>
                  <animateMotion dur={`${2.2 + i * 0.25}s`} repeatCount="indefinite" begin={`${-(k * (1.1 + i * 0.12) + i * 0.3)}s`} rotate="auto">
                    <mpath href={`#${s.id}`} />
                  </animateMotion>
                </circle>
              ))}
        </g>
      ))}

      {/* the coin: round, split diagonally into a lime and a green half that part and close again */}
      <g className="animate-float" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        <path d={halves[1]} fill={INK} transform="translate(5 5)" />
        <path d={halves[0]} fill={C.lime} stroke={INK} strokeWidth={3.2} strokeLinejoin="round" className="split-half-a" />
        <path d={halves[1]} fill={C.green} stroke={INK} strokeWidth={3.2} strokeLinejoin="round" className="split-half-b" />
        <path d={`M${CX - 44} ${CY - 30}A54 54 0 0 1 ${CX - 20} ${CY - 50}`} fill="none" stroke="var(--shine)" strokeWidth={3.4} strokeLinecap="round" opacity={0.85} className="split-half-a" />
      </g>
      <text x={CX} y={CY - R - 26} textAnchor="middle" className="fill-[var(--ink-3)] font-mono" fontSize={11} letterSpacing="0.14em">
        {caption}
      </text>

      {/* the accounts */}
      {NODES.map((n, i) => (
        <g key={n.handle} className="animate-float" style={{ animationDelay: `${-i * 1.1}s`, transformBox: "fill-box", transformOrigin: "center" }}>
          {n.image ? (
            <g>
              <clipPath id={`${uid}c${i}`}>
                <circle cx={n.x} cy={n.y} r={25} />
              </clipPath>
              <circle cx={n.x + 3} cy={n.y + 3} r={27} fill={INK} />
              <circle cx={n.x} cy={n.y} r={27} fill={n.color} stroke={INK} strokeWidth={2.8} />
              <image href={n.image} x={n.x - 25} y={n.y - 25} width={50} height={50} clipPath={`url(#${uid}c${i})`} preserveAspectRatio="xMidYMid slice" />
            </g>
          ) : (
            <Avatar cx={n.x} cy={n.y} r={26} color={n.color} hair={n.hair} hairColor={n.hairColor} sw={2.8} face={n.face} shadow={3} />
          )}
          <g transform={`translate(${n.x} ${n.y + 44})`}>
            <rect x={-62} y={-12} width={124} height={24} rx={12} fill="var(--card)" stroke="var(--line-2)" />
            <text x={-52} y={4} className="fill-[var(--ink)] font-mono" fontSize={11}>
              {n.handle.length > 12 ? `${n.handle.slice(0, 11)}…` : n.handle}
            </text>
            {/* The pastel reads on the dark pill; on the paper edition's white pill the share is ink. */}
            <text x={54} y={4} textAnchor="end" className="font-mono [[data-theme=light]_&]:fill-[var(--ink)]" fill={n.color} fontSize={11} fontWeight={600}>
              {n.pct}
            </text>
          </g>
        </g>
      ))}
    </svg>
  );
}
