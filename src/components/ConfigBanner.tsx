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
      <p className="border-b border-line bg-card-2 px-4 py-2 text-center text-[13px] font-medium text-ink-2">
        Can&apos;t reach {activeChain.name} right now. Retrying…
      </p>
    );
  }
  if (!missing || pathname === "/setup") return null;
  return (
    <Link href="/setup" className="block border-b border-line bg-sun px-4 py-2 text-center text-[13px] font-semibold text-[#1d1d1f]">
      PonSplit isn&apos;t set up on {activeChain.name} yet. Finish setup →
    </Link>
  );
}
