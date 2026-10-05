"use client";

import { useEffect, useId } from "react";
import { useInView, useReducedMotion } from "../motion";
import { Bug } from "./Bug";
import { C, INK } from "./parts";

/** A real GitHub developer the coin pays: its username, share, and profile photo when known. */
export type MachineAccount = { handle: string; pct: number; image?: string };

const COLORS = [C.sky, C.pink, C.sun, C.lilac, C.orange, C.green, C.red, C.lime, C.sky];
const BUG = { x: 280, y: 108, size: 178 };
const FORK_Y = 240; // where the trunk forks into one branch per developer
const AV_Y = 350;

/**
 * The home hero: Bitbug opens its split shell and every trade's creator fee runs out as a git graph,
 * one branch per developer, a drop per fee. Pure SVG; motion runs only on screen and stops for
 * visitors who ask for less of it.
 */
export function SplitMachine({ className, accounts, caption = "creator fees, every trade" }: { className?: string; accounts: MachineAccount[]; caption?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduced = useReducedMotion();
  // The motion repaints the whole drawing every frame, so it only runs while on screen.
  const [ref, onScreen] = useInView<SVGSVGElement>({ once: false, rootMargin: "0px" });
  useEffect(() => {
    const svg = ref.current;
    if (!svg?.pauseAnimations) return;
    if (onScreen) svg.unpauseAnimations();
    else svg.pauseAnimations();
  }, [onScreen, ref]);

  const list = accounts.slice(0, 5);
  const n = list.length;
  const span = n > 1 ? Math.min(420, (n - 1) * 105) : 0;
  const nodes = list.map((a, i) => {
    const x = Math.round(280 - span / 2 + (n > 1 ? (span / (n - 1)) * i : 0));
    // trunk out of the bug, a commit where it forks, then an S-curve down to the developer
    const d = x === 280 ? `M280 196V${AV_Y - 30}` : `M280 196V${FORK_Y}C280 ${FORK_Y + 30} ${x} ${FORK_Y + 22} ${x} ${FORK_Y + 56}V${AV_Y - 30}`;
    return { ...a, x, d, color: COLORS[i % COLORS.length], id: `${uid}b${i}`, handle: `@${a.handle}`, pctText: `${+a.pct.toFixed(1)}%` };
  });

  return (
    <svg
      ref={ref}
      viewBox="0 0 560 420"
      className={`${className ?? ""} ${onScreen ? "" : "motion-paused"}`}
      role="img"
      aria-label={`Bitbug splitting a coin's trading fees between ${nodes.map((v) => `${v.handle} (${v.pctText})`).join(", ")}`}
    >
      <defs>
        <radialGradient id={`${uid}glow`}>
          <stop offset="0%" stopColor="var(--lime)" stopOpacity="0.34" />
          <stop offset="65%" stopColor="var(--lime)" stopOpacity="0.05" />
          <stop offset="100%" stopColor="var(--lime)" stopOpacity="0" />
        </radialGradient>
        {nodes.map((v) => (
          <path key={v.id} id={v.id} d={v.d} />
        ))}
      </defs>

      <text x={14} y={20} className="fill-[var(--ink-3)] font-mono" fontSize={11}>
        <tspan fill="var(--lime)">{"// "}</tspan>
        {caption}
      </text>

      {/* glow and an orbit behind the bug */}
      <circle cx={BUG.x} cy={BUG.y} r={130} fill={`url(#${uid}glow)`} />
      <g className="origin-center animate-spin-slow" style={{ transformBox: "fill-box" }}>
        <circle cx={BUG.x} cy={BUG.y} r={112} fill="none" stroke="var(--line-2)" strokeWidth={1.2} strokeDasharray="2 9" />
      </g>

      {/* the git graph: a soft rail, a dashed flow on top, drops riding down each branch */}
      {nodes.map((v, i) => (
        <g key={v.id}>
          <use href={`#${v.id}`} fill="none" stroke={v.color} strokeOpacity={0.22} strokeWidth={3 + v.pct / 8} strokeLinecap="round" />
          <use href={`#${v.id}`} fill="none" stroke={v.color} strokeWidth={2} strokeLinecap="round" strokeDasharray="3 10" className="animate-flow" style={{ animationDuration: `${1.1 + i * 0.14}s` }} />
          {reduced
            ? null
            : [0, 1].map((k) => (
                <circle key={k} r={4.6} fill={v.color} stroke={INK} strokeWidth={1.5}>
                  <animateMotion dur={`${2.4 + i * 0.2}s`} repeatCount="indefinite" begin={`${-(k * (1.2 + i * 0.1) + i * 0.35)}s`}>
                    <mpath href={`#${v.id}`} />
                  </animateMotion>
                </circle>
              ))}
          {/* a commit on each branch, with the developer's share */}
          <circle cx={v.x} cy={FORK_Y + 56} r={6} fill="var(--card)" stroke={v.color} strokeWidth={3} />
        </g>
      ))}
      {/* the fork commit */}
      <circle cx={280} cy={FORK_Y} r={8} fill="var(--lime)" stroke={INK} strokeWidth={2.4} />
      <text x={294} y={FORK_Y + 4} className="fill-[var(--ink-3)] font-mono" fontSize={10}>
        split()
      </text>

      {/* Bitbug, opening its shell */}
      <g className="animate-float" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        <Bug x={BUG.x} y={BUG.y} size={BUG.size} face="joy" flap />
      </g>

      {/* the developers */}
      {nodes.map((v, i) => (
        <g key={v.handle} className="animate-float" style={{ animationDelay: `${-i * 1.1}s`, transformBox: "fill-box", transformOrigin: "center" }}>
          <clipPath id={`${uid}c${i}`}>
            <circle cx={v.x} cy={AV_Y} r={24} />
          </clipPath>
          <circle cx={v.x} cy={AV_Y} r={28} fill={v.color} stroke={INK} strokeWidth={2.6} />
          {v.image ? (
            <image href={v.image} x={v.x - 24} y={AV_Y - 24} width={48} height={48} clipPath={`url(#${uid}c${i})`} preserveAspectRatio="xMidYMid slice" />
          ) : (
            <circle cx={v.x} cy={AV_Y} r={24} fill="var(--card-2)" />
          )}
          {/* share badge on the avatar's shoulder */}
          <g transform={`translate(${v.x + 16} ${AV_Y - 26})`}>
            <rect x={-4} y={-10} width={40} height={20} rx={10} fill={v.color} stroke={INK} strokeWidth={2} />
            <text x={16} y={4} textAnchor="middle" className="font-mono" fill={INK} fontSize={10.5} fontWeight={700}>
              {v.pctText}
            </text>
          </g>
          <text x={v.x} y={AV_Y + 46} textAnchor="middle" className="fill-[var(--ink-2)] font-mono" fontSize={11}>
            {v.handle.length > 13 ? `${v.handle.slice(0, 12)}…` : v.handle}
          </text>
        </g>
      ))}
    </svg>
  );
}
