"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { activeChain } from "@/lib/chains";

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
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [ack, setAck] = useState(true);
  useEffect(() => setAck(!activeChain.testnet ? acknowledged() : true), []);

  const guard = (fn: () => void) => {
    if (ack) return fn();
    setPending(() => fn);
  };

  const dialog = pending ? createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="risk-title">
      <div className="card w-full max-w-md animate-pop space-y-4 p-6">
        <h2 id="risk-title" className="font-display text-[22px] font-bold tracking-tight">
          Before you continue
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-ink-2">
          <li>Coins here are speculative and can go to zero. Only use money you can afford to lose.</li>
          <li>Anyone can launch a coin and list any X account. A listed account has not endorsed the coin.</li>
          <li>Trades are final. The contracts are experimental and have not been audited.</li>
          <li>You are responsible for following the laws where you live.</li>
        </ul>
        <div className="flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => setPending(null)}>
            Cancel
          </button>
          <button
            className="btn-primary flex-1"
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
