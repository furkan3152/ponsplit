"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { feeVaultAbi, launchpadAbi } from "./abi";
import { activeChain, rpcUrl } from "./chains";
import { FEE_VAULT_ADDRESS, LAUNCHPAD_ADDRESS } from "./config";
import type { TradeRecord } from "./types";

const base = { address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, chainId: activeChain.id } as const;

// getTokens costs ~105k gas per token in an eth_call; 60 per call stays far below RPC gas caps.
const TOKEN_PAGE = 60;

/**
 * Client for the heavy paged reads (getTokens, getTrades). Unlike wagmi's client it never merges
 * calls into one Multicall3 call: several ~6M-gas pages in a single eth_call would exceed the
 * node's eth_call gas cap once there are a few hundred coins. Concurrent pages still share one
 * HTTP request through JSON-RPC batching.
 */
const pagedClient = createPublicClient({ chain: activeChain, transport: http(rpcUrl, { batch: { batchSize: 20 } }) });

export function useTokenCount() {
  return useReadContract({ ...base, functionName: "tokenCount", query: { enabled: Boolean(LAUNCHPAD_ADDRESS), refetchInterval: 10_000 } });
}

/**
 * Every token, newest first, fetched in parallel pages of 60, so lists, search and sorting cover
 * all coins, not only the newest ones. One stable query: a failed refresh keeps the list on screen.
 * (At very large scale this belongs in an indexer; see MAINNET.md.)
 */
export function useAllTokens() {
  const { data: count } = useTokenCount();
  const query = useQuery({
    queryKey: ["tokens", "all"],
    enabled: Boolean(LAUNCHPAD_ADDRESS),
    refetchInterval: 15_000,
    queryFn: async () => {
      const total = Number(await pagedClient.readContract({ address: LAUNCHPAD_ADDRESS!, abi: launchpadAbi, functionName: "tokenCount" }));
      const pages = Math.ceil(total / TOKEN_PAGE);
      const results = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          pagedClient.readContract({
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
  // Pick up a new launch as soon as the (cheaper, faster-polled) count moves.
  const { data, refetch, isFetching } = query;
  useEffect(() => {
    if (count !== undefined && data && BigInt(data.length) !== count && !isFetching) refetch();
  }, [count, data, isFetching, refetch]);
  return query;
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

export type LaunchTerms = {
  version: bigint;
  creationFee: bigint;
  feeBps: bigint;
  protocolShareBps: bigint;
  curve: readonly [bigint, bigint, bigint, bigint];
};

const TERMS = ["termsVersion", "creationFee", "feeBps", "protocolShareBps", "curveConfig"] as const;

/** Reads everything that prices a new launch, together with its version, in one request. */
export async function readLaunchTerms(client: NonNullable<ReturnType<typeof usePublicClient>>): Promise<LaunchTerms> {
  const [version, creationFee, feeBps, protocolShareBps, curve] = (await Promise.all(
    TERMS.map((functionName) => client.readContract({ address: LAUNCHPAD_ADDRESS!, abi: launchpadAbi, functionName }))
  )) as [bigint, bigint, bigint, bigint, readonly [bigint, bigint, bigint, bigint]];
  return { version, creationFee, feeBps, protocolShareBps, curve };
}

/** The launch terms shown on /create. Re-read at submit and pinned on-chain via termsVersion. */
export function useLaunchTerms() {
  const client = usePublicClient({ chainId: activeChain.id });
  return useQuery({
    queryKey: ["launch-terms"],
    enabled: Boolean(client && LAUNCHPAD_ADDRESS),
    refetchInterval: 30_000,
    queryFn: () => readLaunchTerms(client!),
  });
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
  // One query per token (a failed refresh keeps the chart), re-read whenever the count moves.
  const countRef = useRef(count);
  countRef.current = count;
  const fetchedFor = useRef<bigint>();
  const query = useQuery({
    queryKey: ["trades", token],
    enabled: Boolean(token && LAUNCHPAD_ADDRESS && count !== undefined),
    queryFn: async () => {
      const total = countRef.current ?? 0n;
      const start = total > MAX_TRADES ? total - MAX_TRADES : 0n;
      const out: TradeRecord[] = [];
      for (let offset = start; offset < total; offset += PAGE) {
        const page = await pagedClient.readContract({ address: LAUNCHPAD_ADDRESS!, abi: launchpadAbi, functionName: "getTrades", args: [token!, offset, PAGE] });
        out.push(...page);
      }
      fetchedFor.current = total; // only after a successful read, so a failed one is retried
      return out;
    },
  });
  const { refetch, isFetching, dataUpdatedAt } = query;
  useEffect(() => {
    if (count !== undefined && dataUpdatedAt && !isFetching && fetchedFor.current !== count) refetch();
  }, [count, dataUpdatedAt, isFetching, refetch]);
  return query;
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

export type HandleCheck = {
  handle: string;
  /**
   * current: the username still belongs to the account the fees go to.
   * moved:   the account was renamed (the name is free now or belongs to someone else).
   * unknown: not checked yet, or the lookup is unavailable.
   */
  status: "current" | "moved" | "unknown";
  image?: string;
};

/**
 * Coins store usernames as they were at launch; fees follow the permanent X id. Before showing a
 * username's avatar or @-mentioning it, check that it still belongs to that id, so a renamed or
 * re-registered name never shows or tags the wrong person.
 */
export function useHandleChecks(handles: readonly string[], xIds: readonly bigint[]): HandleCheck[] {
  const profiles = useXProfiles([...handles]);
  return handles.map((handle, i) => {
    const p = profiles.data?.[handle];
    if (p === undefined) return { handle, status: "unknown" };
    if (p === null || p.id !== xIds[i]?.toString()) return { handle, status: "moved" };
    return { handle, status: "current", image: p.image };
  });
}

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
