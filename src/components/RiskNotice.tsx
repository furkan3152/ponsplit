"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNetwork } from "@/lib/network-context";

const KEY = "ponsplit:risk-ack:v1";

function acknowledged(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * On mainnet, asks once (per browser) for an acknowledgement before the first launch or trade.
 * `guard(fn)` runs fn right away when already acknowledged, otherwise after the user accepts.
 */
export function useRiskGate() {
  const n = useNetwork();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [ack, setAck] = useState(true);
  useEffect(() => setAck(!n.isTestnet ? acknowledged() : true), [n.isTestnet]);
  const box = useRef<HTMLDivElement>(null);
  // Recorded when the gate opens: by the time an effect runs, Cancel's autoFocus has taken focus.
  const opener = useRef<HTMLElement | null>(null);
  // While open it behaves like a modal: Escape cancels, Tab stays inside, the page behind doesn't
  // scroll, and focus goes back to the button that opened it.
  useEffect(() => {
    if (!pending) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPending(null);
      if (e.key !== "Tab" || !box.current) return;
      const buttons = Array.from(box.current.querySelectorAll<HTMLElement>("button"));
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && (document.activeElement === first || !box.current.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !box.current.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener.current?.focus();
    };
  }, [pending]);

  const guard = (fn: () => void) => {
    if (ack) return fn();
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending(() => fn);
  };

  const dialog = pending ? createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-[var(--glass)] p-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-xl backdrop-saturate-150 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="risk-title"
    >
      <div ref={box} className="card relative isolate w-full max-w-md animate-slide-up overflow-hidden rounded-[28px] border-line-2 p-6 shadow-[0_40px_80px_-24px_rgba(0,0,0,0.6)] sm:animate-pop sm:p-7">
        <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-70" />
        <div aria-hidden className="absolute -right-12 -top-16 -z-10 h-44 w-44 rounded-full bg-sun opacity-[0.16] blur-3xl" />
        <div className="flex items-center gap-4">
          <svg viewBox="0 0 56 56" className="h-14 w-14 shrink-0 animate-wiggle" aria-hidden="true" focusable="false">
            <path d="M28 8L50 46H6Z" fill="var(--outline)" stroke="var(--outline)" strokeWidth={4} strokeLinejoin="round" transform="translate(3 3)" />
            <path d="M28 8L50 46H6Z" fill="var(--sun)" stroke="var(--outline)" strokeWidth={4} strokeLinejoin="round" />
            <path d="M28 21V32" stroke="var(--outline)" strokeWidth={4.5} strokeLinecap="round" />
            <circle cx={28} cy={39.5} r={2.8} fill="var(--outline)" />
          </svg>
          <div className="min-w-0">
            <div className="eyebrow">{n.chain.name} · read once</div>
            <h2 id="risk-title" className="display mt-1.5 text-[28px] leading-none sm:text-[32px]">
              Before you continue
            </h2>
          </div>
        </div>
        <ul className="mt-6 divide-y divide-[var(--line)] border-y border-line text-[14px] leading-relaxed text-ink-2">
          <RiskItem n={1}>Coins here are speculative and can go to zero. Only use money you can afford to lose.</RiskItem>
          <RiskItem n={2}>Anyone can launch a coin and list any X account. A listed account has not endorsed the coin.</RiskItem>
          <RiskItem n={3}>Trades are final. SplitEarn&apos;s contracts are experimental and have not been audited. SplitEarn is not affiliated with pons.</RiskItem>
          <RiskItem n={4}>You are responsible for following the laws where you live.</RiskItem>
        </ul>
        <div className="mt-6 flex gap-2.5">
          {/* Focus lands on the safe choice. */}
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <button autoFocus className="btn-secondary flex-1 py-3" onClick={() => setPending(null)}>
            Cancel
          </button>
          <button
            className="btn-neon flex-1 py-3"
            onClick={() => {
              try {
                localStorage.setItem(KEY, "1");
              } catch {
                // storage unavailable: ask again next time
              }
              setAck(true);
              const fn = pending;
              setPending(null);
              fn();
            }}
          >
            I understand
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return { guard, dialog };
}

function RiskItem({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5 py-3">
      <span className="num shrink-0 pt-[3px] text-[11px] text-ink-3" aria-hidden>
        0{n}
      </span>
      <span>{children}</span>
    </li>
  );
}
