"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBytecode } from "wagmi";
import { activeChain } from "@/lib/chains";
import { LAUNCHPAD_ADDRESS } from "@/lib/config";

/** Nudges to /setup until the launchpad actually exists on-chain. */
export function ConfigBanner() {
  const pathname = usePathname();
  const { data: code, isSuccess, isError } = useBytecode({
    address: LAUNCHPAD_ADDRESS,
    chainId: activeChain.id,
    query: { enabled: Boolean(LAUNCHPAD_ADDRESS), refetchInterval: 15_000 },
  });
  // Only a successful read of empty code means "not set up"; a failed read means the RPC is down.
  const missing = !LAUNCHPAD_ADDRESS || (isSuccess && (!code || code === "0x"));
  if (isError && !code) {
    return (
      <p
        role="status"
        className="flex items-center justify-center gap-2.5 border-b border-line bg-card-2 px-4 py-2 text-center font-mono text-[11.5px] text-ink-2"
      >
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inset-0 animate-ping rounded-full bg-down opacity-60" />
          <span className="relative h-2 w-2 rounded-full bg-down" />
        </span>
        <span>Can&apos;t reach {activeChain.name} right now. Retrying…</span>
      </p>
    );
  }
  if (!missing || pathname === "/setup") return null;
  return (
    <Link
      href="/setup"
      className="group relative block overflow-hidden border-b border-line bg-[color-mix(in_oklab,var(--sun)_13%,var(--paper))] px-4 py-2 transition-colors duration-300 hover:bg-[color-mix(in_oklab,var(--sun)_20%,var(--paper))]"
    >
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
          <span>PonsEarn isn&apos;t set up on {activeChain.name} yet.</span>
        </span>{" "}
        <span className="inline-flex items-center gap-1 rounded-full bg-sun px-2.5 py-0.5 text-[12px] font-semibold text-[var(--lime-ink)] shadow-[inset_0_-1.5px_0_rgba(0,0,0,0.18)] transition-transform duration-300 group-hover:translate-x-0.5">
          Finish setup →
        </span>
      </span>
    </Link>
  );
}
