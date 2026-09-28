"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { feeVaultAbi, launchpadAbi } from "./abi";
import { activeChain } from "./chains";
import { FEE_VAULT_ADDRESS, LAUNCHPAD_ADDRESS } from "./config";
import type { TradeRecord } from "./types";

const base = { address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, chainId: activeChain.id } as const;

// getTokens costs ~105k gas per token in an eth_call; 60 per call stays far below RPC gas caps.
const TOKEN_PAGE = 60;

export function useTokenCount() {
  return useReadContract({ ...base, functionName: "tokenCount", query: { enabled: Boolean(LAUNCHPAD_ADDRESS), refetchInterval: 10_000 } });
}

/**
 * Every token, newest first, fetched in parallel pages of 60. Pages are re-read as the count
 * moves, so lists, search and sorting always cover all coins, not only the newest ones.
 * (At very large scale this belongs in an indexer; see MAINNET.md.)
 */
export function useAllTokens() {
  const client = usePublicClient({ chainId: activeChain.id });
  const { data: count, error: countError } = useTokenCount();
  const query = useQuery({
    queryKey: ["tokens", "all", count?.toString()],
    enabled: Boolean(client && LAUNCHPAD_ADDRESS && count !== undefined),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const total = Number(count ?? 0n);
      const pages = Math.ceil(total / TOKEN_PAGE);
      const results = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          client!.readContract({
            address: LAUNCHPAD_ADDRESS!,
            abi: launchpadAbi,
            functionName: "getTokens",
            args: [BigInt(i * TOKEN_PAGE), BigInt(Math.min(TOKEN_PAGE, total - i * TOKEN_PAGE))],
          })
        )
      );
      return results.flat();
    },
  });
  return { ...query, error: query.error ?? countError, isLoading: query.isLoading || (count === undefined && !countError) };
}

/** Platform totals straight from the contracts (not summed from a page of coins). */
export function useGlobalStats() {
  const { data } = useReadContracts({
    contracts: [
      { ...base, functionName: "tokenCount" },
      { ...base, functionName: "globalTradeCount" },
      { address: FEE_VAULT_ADDRESS, abi: feeVaultAbi, chainId: activeChain.id, functionName: "totalDeposited" },
    ],
    query: { enabled: Boolean(LAUNCHPAD_ADDRESS && FEE_VAULT_ADDRESS), refetchInterval: 10_000 },
  });
  const pick = (i: number) => (data?.[i]?.status === "success" ? (data[i].result as bigint) : undefined);
  return { coins: pick(0), trades: pick(1), feesSplit: pick(2) };
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
  const { data } = useReadContract({ ...base, functionName, query: { enabled: Boolean(LAUNCHPAD_ADDRESS), refetchInterval: 30_000 } });
  return data;
}

/** The value, once it has stopped changing for `ms` (use primitives: arrays are new every render). */
export function useDebounced<T>(value: T, ms = 450) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
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
