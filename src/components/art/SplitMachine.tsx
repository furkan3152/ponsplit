"use client";

import { useId } from "react";
import { useEffect } from "react";
import { useInView, useReducedMotion } from "../motion";
import { Avatar, C, type Hair, INK, splitHalves } from "./parts";

const CX = 280;
const CY = 214;
const R = 76;

const NODES: { x: number; y: number; color: string; hair: Hair; hairColor: string; handle: string; pct: string; bend: number; face: "happy" | "joy" }[] = [
  { x: 92, y: 96, color: C.sky, hair: 0, hairColor: C.sun, handle: "@ada", pct: "40%", bend: -46, face: "happy" },
  { x: 470, y: 84, color: C.pink, hair: 3, hairColor: C.lilac, handle: "@kofi", pct: "25%", bend: 44, face: "joy" },
  { x: 498, y: 292, color: C.sun, hair: 1, hairColor: C.green, handle: "@mei", pct: "15%", bend: -40, face: "happy" },
  { x: 318, y: 390, color: C.lilac, hair: 2, hairColor: C.orange, handle: "@noor", pct: "10%", bend: 34, face: "joy" },
  { x: 72, y: 318, color: C.orange, hair: 4, hairColor: C.sky, handle: "@sol", pct: "10%", bend: 38, face: "happy" },
];

const r2 = (n: number) => Math.round(n * 10) / 10;

/**
 * The home hero: a coin that keeps splitting. Every trade's fee leaves the coin as a stream of
 * drops, one stream per X account, sized by its share. Pure SVG; motion stops for visitors who
 * ask for less of it.
 */
export function SplitMachine({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduced = useReducedMotion();
  // All of this motion repaints the whole drawing every frame, so it only runs while on screen.
  const [ref, onScreen] = useInView<SVGSVGElement>({ once: false, rootMargin: "0px" });
  useEffect(() => {
    const svg = ref.current;
    if (!svg?.pauseAnimations) return;
    if (onScreen) svg.unpauseAnimations();
    else svg.pauseAnimations();
  }, [onScreen, ref]);
  const [a, b] = splitHalves(CX, CY, R, 9);
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
    return { id: `${uid}s${i}`, d: `M${r2(x0)} ${r2(y0)}Q${r2(mx)} ${r2(my)} ${r2(x3)} ${r2(y3)}`, n, weight: parseInt(n.pct, 10) };
  });

  return (
    <svg
      ref={ref}
      viewBox="0 0 560 450"
      className={`${className ?? ""} ${onScreen ? "" : "motion-paused"}`}
      role="img"
      aria-label="A coin splitting its trading fees between five X accounts"
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

      {/* the coin, splitting and closing again */}
      <g>
        <path d={b} fill={INK} transform="translate(5 5)" />
        <path d={a} fill={C.lime} stroke={INK} strokeWidth={3.2} strokeLinejoin="round" className="split-half-a" />
        <path d={b} fill={C.green} stroke={INK} strokeWidth={3.2} strokeLinejoin="round" className="split-half-b" />
        <path d={`M${CX - 44} ${CY - 30}A54 54 0 0 1 ${CX - 20} ${CY - 50}`} fill="none" stroke="var(--shine)" strokeWidth={3.4} strokeLinecap="round" opacity={0.85} className="split-half-a" />
      </g>
      <text x={CX} y={CY - R - 26} textAnchor="middle" className="fill-[var(--ink-3)] font-mono" fontSize={11} letterSpacing="0.14em">
        CREATOR FEES, EVERY TRADE
      </text>

      {/* the accounts */}
      {NODES.map((n, i) => (
        <g key={n.handle} className="animate-float" style={{ animationDelay: `${-i * 1.1}s`, transformBox: "fill-box", transformOrigin: "center" }}>
          <Avatar cx={n.x} cy={n.y} r={26} color={n.color} hair={n.hair} hairColor={n.hairColor} sw={2.8} face={n.face} shadow={3} />
          <g transform={`translate(${n.x} ${n.y + 44})`}>
            <rect x={-44} y={-12} width={88} height={24} rx={12} fill="var(--card)" stroke="var(--line-2)" />
            <text x={-34} y={4} className="fill-[var(--ink)] font-mono" fontSize={11}>
              {n.handle}
            </text>
            {/* The pastel reads on the dark pill; on the paper edition's white pill the share is ink. */}
            <text x={36} y={4} textAnchor="end" className="font-mono [[data-theme=light]_&]:fill-[var(--ink)]" fill={n.color} fontSize={11} fontWeight={600}>
              {n.pct}
            </text>
          </g>
        </g>
      ))}
    </svg>
  );
}
