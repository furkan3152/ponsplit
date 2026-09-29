"use client";

import { usePathname } from "next/navigation";
import { useBytecode } from "wagmi";
import { useNetwork, useSwitchNetwork } from "@/lib/network-context";
import { NETWORKS, isLive, otherNetwork } from "@/lib/networks";

/** Says when SplitEarn isn't live on the network being browsed, and when its RPC is down. */
export function ConfigBanner() {
  const pathname = usePathname();
  const n = useNetwork();
  const switchTo = useSwitchNetwork();
  const live = isLive(n);
  const { data: code, isSuccess, isError } = useBytecode({
    address: n.launcher,
    chainId: n.chain.id,
    query: { enabled: live, refetchInterval: 15_000 },
  });
  if (live && isError && !code) {
    return (
      <p
        role="status"
        className="flex items-center justify-center gap-2.5 border-b border-line bg-card-2 px-4 py-2 text-center font-mono text-[11.5px] text-ink-2"
      >
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inset-0 animate-ping rounded-full bg-down opacity-60" />
          <span className="relative h-2 w-2 rounded-full bg-down" />
        </span>
        <span>Can&apos;t reach {n.chain.name} right now. Retrying…</span>
      </p>
    );
  }
  // Only a successful read of empty code means the pinned contract isn't there.
  const missing = !live || (isSuccess && (!code || code === "0x"));
  if (!missing || pathname === "/setup") return null;
  const otherId = otherNetwork(n.id);
  const other = otherId ? NETWORKS[otherId] : null;
  return (
    <div className="relative overflow-hidden border-b border-line bg-[color-mix(in_oklab,var(--sun)_13%,var(--paper))] px-4 py-2">
      {/* hazard tape at both ends */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-10 opacity-70 [mask-image:linear-gradient(90deg,#000,transparent)] sm:w-24"
        style={{ backgroundImage: "repeating-linear-gradient(-45deg, var(--sun) 0 6px, transparent 6px 12px)" }}
      />
      <span
        aria-hidden
        className="absolute inset-y-0 right-0 w-10 opacity-70 [mask-image:linear-gradient(270deg,#000,transparent)] sm:w-24"
        style={{ backgroundImage: "repeating-linear-gradient(-45deg, var(--sun) 0 6px, transparent 6px 12px)" }}
      />
      <span className="relative mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[13px] font-medium text-ink">
        <span className="inline-flex items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-sun shadow-[0_0_10px_var(--sun)]" aria-hidden />
          <span>SplitEarn isn&apos;t live on {n.label.toLowerCase()} yet.</span>
        </span>
        {other && isLive(other) ? (
          <button
            type="button"
            onClick={() => switchTo(other.id)}
            className="inline-flex items-center gap-1 rounded-full border border-outline px-2.5 py-0.5 text-[12px] font-semibold text-ink transition hover:bg-card"
          >
            Go to {other.label.toLowerCase()} →
          </button>
        ) : null}
      </span>
    </div>
  );
}
