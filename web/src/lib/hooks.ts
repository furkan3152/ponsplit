"use client";

import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { launchpadAbi } from "./abi";
import { activeChain } from "./chains";
import { LAUNCHPAD_ADDRESS } from "./config";

export function useTokens(limit = 60) {
  return useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    chainId: activeChain.id,
    functionName: "getTokens",
    args: [0n, BigInt(limit)],
    query: { enabled: Boolean(LAUNCHPAD_ADDRESS), refetchInterval: 15_000 },
  });
}

export function useToken(token: Address | undefined) {
  return useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    chainId: activeChain.id,
    functionName: "getToken",
    args: token ? [token] : undefined,
    query: { enabled: Boolean(LAUNCHPAD_ADDRESS && token), refetchInterval: 8_000 },
  });
}

export function useFeeBps() {
  const { data } = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    chainId: activeChain.id,
    functionName: "feeBps",
    query: { enabled: Boolean(LAUNCHPAD_ADDRESS) },
  });
  return data;
}
