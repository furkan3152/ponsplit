"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { usePublicClient, useReadContract } from "wagmi";
import { feeVaultAbi, launchpadAbi } from "./abi";
import { activeChain } from "./chains";
import { FEE_VAULT_ADDRESS, LAUNCHPAD_ADDRESS } from "./config";
import type { TradeRecord } from "./types";

const base = { address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, chainId: activeChain.id } as const;

export function useTokens(limit = 100) {
  return useReadContract({
    ...base,
    functionName: "getTokens",
    args: [0n, BigInt(limit)],
    query: { enabled: Boolean(LAUNCHPAD_ADDRESS), refetchInterval: 10_000 },
  });
}

export function useToken(token: Address | undefined) {
  return useReadContract({
    ...base,
    functionName: "getToken",
    args: token ? [token] : undefined,
    query: { enabled: Boolean(LAUNCHPAD_ADDRESS && token), refetchInterval: 5_000 },
  });
}

export function useRecentTrades(limit = 30) {
  return useReadContract({
    ...base,
    functionName: "getRecentTrades",
    args: [BigInt(limit)],
    query: { enabled: Boolean(LAUNCHPAD_ADDRESS), refetchInterval: 6_000 },
  });
}

export function useLaunchpadNumber(functionName: "feeBps" | "protocolShareBps" | "creationFee") {
  const { data } = useReadContract({ ...base, functionName, query: { enabled: Boolean(LAUNCHPAD_ADDRESS) } });
  return data;
}

export function useLaunchesPaused() {
  const { data } = useReadContract({ ...base, functionName: "launchesPaused", query: { enabled: Boolean(LAUNCHPAD_ADDRESS), refetchInterval: 30_000 } });
  return data;
}

export function useClaimsPaused() {
  const { data } = useReadContract({
    address: FEE_VAULT_ADDRESS,
    abi: feeVaultAbi,
    chainId: activeChain.id,
    functionName: "claimsPaused",
    query: { enabled: Boolean(FEE_VAULT_ADDRESS), refetchInterval: 30_000 },
  });
  return data;
}

const PAGE = 500n;
const MAX_TRADES = 3_000n;

/** A token's most recent trades (up to 3000), oldest first. Refetches when the trade count moves. */
export function useTrades(token: Address | undefined, count: bigint | undefined) {
  const client = usePublicClient({ chainId: activeChain.id });
  return useQuery({
    queryKey: ["trades", token, count?.toString()],
    enabled: Boolean(client && token && LAUNCHPAD_ADDRESS && count !== undefined),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const total = count ?? 0n;
      const start = total > MAX_TRADES ? total - MAX_TRADES : 0n;
      const out: TradeRecord[] = [];
      for (let offset = start; offset < total; offset += PAGE) {
        const page = await client!.readContract({ address: LAUNCHPAD_ADDRESS!, abi: launchpadAbi, functionName: "getTrades", args: [token!, offset, PAGE] });
        out.push(...page);
      }
      return out;
    },
  });
}

/** Re-renders every `ms` so relative times stay fresh. */
export function useNow(ms = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export type XProfileLite = { id: string; username: string; name: string; image?: string };

/** Looks up X profiles through the app's resolver API. */
export function useXProfiles(handles: string[]) {
  const key = handles.slice().sort().join(",");
  return useQuery({
    queryKey: ["x-profiles", key],
    enabled: handles.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/x/resolve?handles=${encodeURIComponent(key)}`);
      const body = (await res.json()) as { profiles?: Record<string, XProfileLite | null>; error?: string };
      if (!res.ok) throw new Error(body.error || "Lookup failed");
      return body.profiles ?? {};
    },
  });
}
