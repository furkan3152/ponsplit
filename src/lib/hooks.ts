"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { feeSplitterAbi, feeVaultAbi, launcherAbi, ponsFactoryAbi, ponsTokenAbi } from "./abi";
import { useNetwork } from "./network-context";
import { NETWORKS, isHidden, isLive, otherNetwork, type Network, type NetworkId } from "./networks";
import {
  readCoins,
  scanActivity,
  scanPayouts,
  tradesBetween,
  venueOf,
  withTimes,
  FIRST_SPAN,
  type Activity,
  type CoinTrades,
  type Payout,
  type Payouts,
  type ScanState,
  type Snapshot,
} from "./chain-reads";
import { BPS, toCoin, toRecipients } from "./pons";
import { rpcTransport } from "./rpc";
import type { Coin, Trade } from "./types";
import { decode } from "./wire";

export type { Activity, Payout } from "./chain-reads";

// ------------------------------------------------------------------ clients

const clients = new Map<string, PublicClient>();

/**
 * A client per network for the heavy reads (coin pages, logs). Unlike wagmi's, it never merges calls
 * into one Multicall3 call (a few big pages in one eth_call could pass the node's gas cap); concurrent
 * requests still share HTTP round trips through JSON-RPC batching.
 */
export function clientFor(n: Network): PublicClient {
  const key = `${n.id}:${n.rpcUrls.join(",")}`;
  let c = clients.get(key);
  if (!c) {
    c = createPublicClient({ chain: n.chain, transport: rpcTransport(n.rpcUrls, { batch: { batchSize: 20 }, retryCount: 3, retryDelay: 400 }) }) as PublicClient;
    clients.set(key, c);
  }
  return c;
}


// ------------------------------------------------------------------ shared snapshots

/**
 * The server reads what every visitor of a network sees (/api/snapshot, /api/trades) and the CDN
 * shares each answer for a few seconds, so a crowd doesn't multiply the load on the chain's RPC.
 * If the server can't answer, the browser reads the chain itself (the code paths below) and tries
 * the server again a minute later.
 */
const SNAPSHOT_TTL = 3_000;
const SNAPSHOT_RETRY = 60_000;
const snapshots = new Map<NetworkId, { at: number; promise: Promise<Snapshot> }>();
const serverDownUntil = new Map<string, number>();

async function fromServer<T>(kind: string, url: string): Promise<T> {
  if ((serverDownUntil.get(kind) ?? 0) > Date.now()) throw new Error("server snapshot unavailable");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) throw Object.assign(new Error("not found"), { notFound: true });
    if (!res.ok) throw new Error(`snapshot ${res.status}`);
    return decode<T>(await res.text());
  } catch (e) {
    if (!(e as { notFound?: boolean }).notFound) serverDownUntil.set(kind, Date.now() + SNAPSHOT_RETRY);
    throw e;
  }
}

/** The network's snapshot, shared by every hook that asks within a few seconds. */
function snapshotOf(n: Network): Promise<Snapshot> {
  const hit = snapshots.get(n.id);
  if (hit && Date.now() - hit.at < SNAPSHOT_TTL) return hit.promise;
  const promise = fromServer<Snapshot>(`snapshot:${n.id}`, `/api/snapshot?network=${n.id}`);
  promise.catch(() => snapshots.delete(n.id));
  snapshots.set(n.id, { at: Date.now(), promise });
  return promise;
}

// ------------------------------------------------------------------ coins

/** Every coin on this network, newest first (hidden ones left out). One stable query. */
export function useCoins() {
  const n = useNetwork();
  const live = isLive(n);
  const query = useQuery({
    queryKey: ["coins", n.id, n.launcher],
    enabled: live,
    // Not deployed yet: there are simply no coins (rather than a list that is forever "loading").
    ...(live ? {} : { initialData: [] as Coin[] }),
    refetchInterval: 15_000,
    queryFn: async () => {
      try {
        return (await snapshotOf(n)).coins;
      } catch {
        return readCoins(clientFor(n), n.launcher!);
      }
    },
  });
  const hidden = useMemo(() => new Set(n.hidden.map((a) => a.toLowerCase())), [n.hidden]);
  const data = useMemo(() => (hidden.size && query.data ? query.data.filter((c) => !hidden.has(c.token.toLowerCase())) : query.data), [query.data, hidden]);
  return { ...query, data };
}


/** One coin with its live Pons state; `null` when it isn't a SplitEarn coin on this network. */
export function useCoin(token: Address | undefined) {
  const n = useNetwork();
  return useQuery({
    queryKey: ["coin", n.id, n.launcher, token],
    enabled: Boolean(isLive(n) && token),
    refetchInterval: 5_000,
    queryFn: async () => {
      const v = await clientFor(n).readContract({ address: n.launcher!, abi: launcherAbi, functionName: "getLaunch", args: [token!] });
      if (v.launch.token === zeroAddress) return null;
      if (isHidden(n, token!)) return null;
      return toCoin(v);
    },
  });
}

/**
 * Whether a coin that isn't on this network is a SplitEarn coin on the other one (a shared link can
 * reach someone browsing the other network). Returns that network's id, or null.
 */
export function useCoinElsewhere(token: Address | undefined, enabled: boolean) {
  const here = useNetwork();
  const other = NETWORKS[otherNetwork(here.id)];
  return useQuery({
    queryKey: ["coin-elsewhere", other.id, other.launcher, token],
    enabled: Boolean(enabled && token && isLive(other)),
    staleTime: 60_000,
    queryFn: async (): Promise<NetworkId | null> => {
      const v = await clientFor(other).readContract({ address: other.launcher!, abi: launcherAbi, functionName: "getLaunch", args: [token!] });
      return v.launch.token !== zeroAddress && !isHidden(other, token!) ? other.id : null;
    },
  });
}

/** What the creator wrote at launch: the description and links pons stores on the coin (they never change). */
export function useTokenInfo(token: Address | undefined) {
  const n = useNetwork();
  return useQuery({
    queryKey: ["token-info", n.id, token],
    enabled: Boolean(token),
    staleTime: Infinity,
    queryFn: async () => {
      const [, , description, socials] = await clientFor(n).readContract({ address: token!, abi: ponsTokenAbi, functionName: "getTokenInfo" });
      return { description, socials };
    },
  });
}

/** Many coins' descriptions in one batch (for cards); a coin whose read fails just has none. */
export function useDescriptions(tokens: readonly Address[]) {
  const n = useNetwork();
  const key = tokens.join(",");
  const { data } = useQuery({
    queryKey: ["descriptions", n.id, key],
    enabled: tokens.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const c = clientFor(n);
      const got = await Promise.all(
        tokens.map((address) => c.readContract({ address, abi: ponsTokenAbi, functionName: "description" }).catch(() => undefined))
      );
      return new Map(tokens.map((t, i) => [t.toLowerCase(), got[i]]));
    },
  });
  return data;
}

/** The launcher's fixed wiring: its FeeVault, router and the Pons contracts it launches on. */
export function useLauncherInfo() {
  const n = useNetwork();
  return useQuery({
    queryKey: ["launcher-info", n.id, n.launcher],
    enabled: isLive(n),
    staleTime: Infinity,
    queryFn: async () => {
      const c = clientFor(n);
      const read = (functionName: "feeVault" | "router" | "ponsFactory" | "ponsHook" | "ponsEscrow" | "poolManager") =>
        c.readContract({ address: n.launcher!, abi: launcherAbi, functionName });
      const [feeVault, router, ponsFactory, ponsHook, ponsEscrow, poolManager] = await Promise.all([
        read("feeVault"),
        read("router"),
        read("ponsFactory"),
        read("ponsHook"),
        read("ponsEscrow"),
        read("poolManager"),
      ]);
      return { feeVault, router, ponsFactory, ponsHook, ponsEscrow, poolManager };
    },
  });
}

export type LaunchTerms = {
  version: bigint;
  platformShareBps: number;
  configId: bigint;
  ponsLaunchFee: bigint;
  economics: Hex;
  maxCreatorTaxBps: number;
  canLaunch: boolean;
  paused: boolean;
  /** A fresh curve's reserves, for pricing the launch's first buy. */
  phantomQuote: bigint;
  supply: bigint;
  curveFeeBps: bigint;
  threshold: bigint;
};

/** Reads everything that prices a new launch, together with its version, in one go. */
export async function readLaunchTerms(n: Network): Promise<LaunchTerms> {
  const c = clientFor(n);
  const [version, platformShare, configId, ponsLaunchFee, economics, maxCreatorTaxBps, canLaunch, paused] = await c.readContract({
    address: n.launcher!,
    abi: launcherAbi,
    functionName: "launchTerms",
  });
  const factory = await c.readContract({ address: n.launcher!, abi: launcherAbi, functionName: "ponsFactory" });
  const config = await c.readContract({ address: factory, abi: ponsFactoryAbi, functionName: "getLaunchConfig", args: [configId] });
  return {
    version,
    platformShareBps: Number(platformShare),
    configId,
    ponsLaunchFee,
    economics,
    maxCreatorTaxBps: Number(maxCreatorTaxBps),
    canLaunch,
    paused,
    phantomQuote: config.phantomQuote,
    supply: config.supply,
    curveFeeBps: config.curveFeeBps,
    threshold: config.graduationThreshold,
  };
}

/** The launch terms shown on /create. Re-read at submit and pinned on-chain (termsVersion, Pons economics). */
export function useLaunchTerms() {
  const n = useNetwork();
  return useQuery({
    queryKey: ["launch-terms", n.id, n.launcher],
    enabled: isLive(n),
    refetchInterval: 30_000,
    queryFn: () => readLaunchTerms(n),
  });
}

export function useClaimsPaused() {
  const n = useNetwork();
  const { data } = useReadContract({
    address: n.feeVault,
    abi: feeVaultAbi,
    chainId: n.chain.id,
    functionName: "claimsPaused",
    query: { enabled: Boolean(n.feeVault), refetchInterval: 30_000 },
  });
  return data;
}

/** Platform totals: coins, and ETH split to X accounts, less what hidden coins contributed. */
export function useGlobalStats() {
  const n = useNetwork();
  const { data: coins } = useCoins();
  const { data } = useReadContracts({
    contracts: [
      { address: n.feeVault, abi: feeVaultAbi, chainId: n.chain.id, functionName: "totalDeposited" },
      ...n.hidden.map((token) => ({ address: n.feeVault, abi: feeVaultAbi, chainId: n.chain.id, functionName: "tokenFees" as const, args: [token] as const })),
    ],
    query: { enabled: isLive(n), refetchInterval: 15_000 },
  });
  const values = data?.map((d) => (d.status === "success" ? (d.result as bigint) : undefined));
  const total = values?.[0];
  const hiddenFees = values?.slice(1);
  const feesSplit =
    total === undefined || !hiddenFees || hiddenFees.some((v) => v === undefined)
      ? undefined
      : hiddenFees.reduce<bigint>((left, v) => (left > v! ? left - v! : 0n), total);
  // Plus the accounts' share of fees still waiting in the coins (collected at the next claim).
  const pendingToAccounts = coins?.reduce((a, c) => a + (c.accountsEarned - c.feesSplit), 0n);
  const earned = feesSplit === undefined || pendingToAccounts === undefined ? undefined : feesSplit + pendingToAccounts;
  return { coins: coins ? BigInt(coins.length) : undefined, feesSplit: isLive(n) ? earned : 0n };
}


// ------------------------------------------------------------------ trades

/**
 * A coin's trades, oldest first: the latest ~2 days at first, then everything new every few seconds,
 * and older history on request (`loadOlder`).
 */
export function useCoinTrades(coin: Coin | null | undefined) {
  const n = useNetwork();
  const { data: wiring } = useLauncherInfo();
  const [state, setState] = useState<{ key: string; trades: Trade[]; from: bigint; to: bigint } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const key = coin ? `${n.id}:${coin.token}` : "";
  const venue = useMemo(() => (coin ? venueOf(coin) : undefined), [coin?.token, coin?.curve, coin?.poolId, coin?.creatorTaxBps]); // eslint-disable-line react-hooks/exhaustive-deps
  const createdBlock = coin?.createdBlock;
  const busy = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const tick = useCallback(async () => {
    if (!venue || createdBlock === undefined || busy.current) return;
    busy.current = true;
    try {
      // The server's shared read of the latest ~2 days first; older trades this page already
      // loaded stay.
      const shared = await fromServer<CoinTrades>(`trades:${n.id}`, `/api/trades?network=${n.id}&token=${venue.token}`).catch(() => null);
      if (shared) {
        setState((s) => {
          if (!s || s.key !== key) return { key, trades: shared.trades, from: shared.from, to: shared.to };
          if (shared.to < s.to) return s;
          const older = s.trades.filter((t) => t.blockNumber < shared.from);
          return { key, trades: [...older, ...shared.trades], from: s.from < shared.from ? s.from : shared.from, to: shared.to };
        });
        setError(null);
        return;
      }
      if (!wiring) return;
      const c = clientFor(n);
      const head = await c.getBlockNumber();
      const current = stateRef.current?.key === key ? stateRef.current : null;
      const from = current ? current.to + 1n : head - FIRST_SPAN > createdBlock ? head - FIRST_SPAN : createdBlock;
      if (from > head) return;
      const fresh = await withTimes(c, n.id, await tradesBetween(c, [venue], wiring, from, head));
      setState((s) =>
        s && s.key === key ? { ...s, trades: [...s.trades, ...fresh], to: head } : { key, trades: fresh, from, to: head }
      );
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      busy.current = false;
    }
  }, [n, venue, wiring, createdBlock, key]);

  useEffect(() => {
    tick();
    const id = setInterval(tick, 5_000);
    return () => clearInterval(id);
  }, [tick]);

  const loadOlder = useCallback(async () => {
    const s = stateRef.current;
    if (!s || s.key !== key || !venue || !wiring || createdBlock === undefined || s.from <= createdBlock) return;
    setLoadingOlder(true);
    try {
      const c = clientFor(n);
      const to = s.from - 1n;
      const from = to - FIRST_SPAN > createdBlock ? to - FIRST_SPAN : createdBlock;
      const older = await withTimes(c, n.id, await tradesBetween(c, [venue], wiring, from, to));
      setState((cur) => (cur && cur.key === key ? { ...cur, trades: [...older, ...cur.trades], from } : cur));
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoadingOlder(false);
    }
  }, [n, venue, wiring, createdBlock, key]);

  const mine = state && state.key === key ? state : null;
  return {
    trades: mine?.trades,
    error: mine ? null : error,
    hasOlder: Boolean(mine && createdBlock !== undefined && mine.from > createdBlock),
    loadOlder,
    loadingOlder,
  };
}

/** Recent activity across every coin (~a day): the ticker, trending order and 24h numbers. */
export function useActivity() {
  const n = useNetwork();
  const { data: coins } = useCoins();
  const { data: wiring } = useLauncherInfo();
  const venueKey = (coins ?? []).map((c) => c.token).join(",");
  const cache = useRef<ScanState<Omit<Trade, "timestamp">>>(null);
  return useQuery({
    queryKey: ["activity", n.id, n.launcher, venueKey],
    enabled: Boolean(wiring && coins),
    refetchInterval: 12_000,
    queryFn: async (): Promise<Activity> => {
      const shared = await snapshotOf(n).catch(() => null);
      if (shared?.activity) return shared.activity;
      const got = await scanActivity(clientFor(n), n.id, coins!, wiring!, cache.current);
      cache.current = got.state;
      return got.activity;
    },
  });
}

// ------------------------------------------------------------------ wallets and X accounts

const BALANCE_OF = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

/** The connected wallet's balance of every coin (one multicall). */
export function useHoldings(owner: Address | undefined) {
  const n = useNetwork();
  const { data: coins } = useCoins();
  // Oldest first, so a new coin is appended and every earlier index keeps pointing at the same
  // coin; that is what lets the previous balances stay on screen while the next read runs.
  const list = useMemo(() => (coins ? [...coins].reverse() : []), [coins]);
  const { data, isLoading } = useReadContracts({
    contracts: list.map((c) => ({ address: c.token, abi: BALANCE_OF, functionName: "balanceOf" as const, args: [owner!] as const, chainId: n.chain.id })),
    query: { enabled: Boolean(owner && list.length), refetchInterval: 15_000, placeholderData: (prev) => prev },
  });
  const holdings = useMemo(
    () =>
      list
        .map((coin, i) => ({ coin, balance: data?.[i]?.status === "success" ? (data[i].result as bigint) : 0n }))
        .filter((h) => h.balance > 0n),
    [list, data]
  );
  return { holdings, isLoading: Boolean(owner && list.length) && isLoading && !data };
}

export type Earnings = {
  xId: bigint;
  claimable: bigint;
  earned: bigint;
  /** This account's share of fees earned but not collected yet; `claim` collects them first. */
  pending: bigint;
  /** The coins with fees to collect for this account. */
  collect: Address[];
  coins: Address[];
};

/** What X account `xId` can claim now, has earned in all, and has on the way. */
export function useEarnings(xId: bigint | undefined) {
  const n = useNetwork();
  return useQuery({
    queryKey: ["earnings", n.id, n.launcher, xId?.toString()],
    enabled: Boolean(isLive(n) && xId !== undefined),
    refetchInterval: 10_000,
    queryFn: async (): Promise<Earnings> => {
      const c = clientFor(n);
      const vault = { address: n.feeVault!, abi: feeVaultAbi } as const;
      const [claimable, earned, coins] = await Promise.all([
        c.readContract({ ...vault, functionName: "claimable", args: [xId!] }),
        c.readContract({ ...vault, functionName: "totalEarned", args: [xId!] }),
        c.readContract({ ...vault, functionName: "tokensOf", args: [xId!] }),
      ]);
      let pending = 0n;
      const collect: Address[] = [];
      await Promise.all(
        coins.map(async (token) => {
          const [launch, split] = await Promise.all([
            c.readContract({ address: n.launcher!, abi: launcherAbi, functionName: "launchOf", args: [token] }),
            c.readContract({ ...vault, functionName: "getSplit", args: [token] }),
          ]);
          const fees = await c.readContract({ address: launch.splitter, abi: feeSplitterAbi, functionName: "pendingFees" });
          const bps = split.find((r) => r.xId === xId)?.bps ?? 0;
          const share = (toRecipients(fees, Number(launch.platformBps)) * BigInt(bps)) / BPS;
          if (fees > 0n) collect.push(token);
          pending += share;
        })
      );
      return { xId: xId!, claimable, earned, pending, collect, coins: [...coins] };
    },
  });
}

// ------------------------------------------------------------------ small utilities

/** The value, once it has stopped changing for `ms` (use primitives: arrays are new every render). */
export function useDebounced<T>(value: T, ms = 450) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
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
   * moved:   the username now belongs to a different account (the fee account was renamed).
   * missing: X doesn't show this username right now (renamed and not taken, or the account is
   *          suspended or deactivated).
   * unknown: not checked yet, or the lookup is unavailable.
   */
  status: "current" | "moved" | "missing" | "unknown";
  image?: string;
};

/**
 * Coins store usernames as they were at launch; fees follow the permanent X id. Before showing a
 * username's avatar or @-mentioning it, check that it still belongs to that id, so a renamed or
 * re-registered name never shows or tags the wrong person.
 */
export function useHandleChecks(handles: readonly string[], xIds: readonly bigint[]): HandleCheck[] {
  // Missing recipients stay missing (renamed, suspended), so coin pages don't keep re-checking them.
  const profiles = useXProfiles([...handles]);
  return handles.map((handle, i) => {
    const p = profiles.data?.[handle];
    if (p === undefined) return { handle, status: "unknown" };
    if (p === null) return { handle, status: "missing" };
    if (p.id !== xIds[i]?.toString()) return { handle, status: "moved" };
    return { handle, status: "current", image: p.image };
  });
}

const hasMiss = (d?: { profiles: Record<string, XProfileLite | null> }) => Boolean(d && Object.values(d.profiles).includes(null));

/**
 * Looks up X profiles through the app's resolver API. Handles the server couldn't fit into its
 * lookup budget this minute are absent from `data`; the query retries them shortly instead of
 * keeping the partial answer for the full stale time. With `recheckMisses` (where someone is
 * typing a username), "not found" answers are re-checked every couple of minutes as well: the
 * account may have just been created, or the lookup was wrong.
 */
export function useXProfiles(handles: string[], { recheckMisses = false }: { recheckMisses?: boolean } = {}) {
  const key = Array.from(new Set(handles)).sort().join(",");
  const missInterval = recheckMisses ? 150_000 : false;
  return useQuery({
    queryKey: ["x-profiles", key],
    enabled: handles.length > 0,
    staleTime: (q) => (q.state.data?.incomplete.length ? 0 : recheckMisses && hasMiss(q.state.data) ? 120_000 : 5 * 60_000),
    refetchInterval: (q) =>
      q.state.status === "error" || q.state.data?.incomplete.length ? 30_000 : hasMiss(q.state.data) ? missInterval : false,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/x/resolve?handles=${encodeURIComponent(key)}`);
      const body = (await res.json().catch(() => ({}))) as {
        profiles?: Record<string, XProfileLite | null>;
        incomplete?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Lookup failed");
      return { profiles: body.profiles ?? {}, incomplete: body.incomplete ?? [] };
    },
    select: (d) => d.profiles,
  });
}


// ------------------------------------------------------------------ payouts

/**
 * Fee payouts: each time an X account claimed its share (FeeVault's Claimed events), newest
 * first, with the account's username where a coin names it. Read incrementally, like trades.
 */
export function usePayouts() {
  const n = useNetwork();
  const { data: coins } = useCoins();
  const handles = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of coins ?? []) c.recipients.forEach((r) => m.set(r.xId.toString(), r.handle));
    return m;
  }, [coins]);
  const cache = useRef<ScanState<Omit<Payout, "timestamp" | "handle">>>(null);
  const q = useQuery({
    queryKey: ["payouts", n.id, n.feeVault],
    enabled: isLive(n),
    refetchInterval: 30_000,
    queryFn: async (): Promise<Payouts> => {
      const shared = await snapshotOf(n).catch(() => null);
      if (shared?.payouts) return shared.payouts;
      const got = await scanPayouts(clientFor(n), n.id, n.feeVault!, cache.current);
      cache.current = got.state;
      return got.payouts;
    },
  });
  const data = useMemo(
    () => (q.data ? { ...q.data, latest: q.data.latest.map((p) => ({ ...p, handle: handles.get(p.xId.toString()) })) as Payout[] } : undefined),
    [q.data, handles]
  );
  return { ...q, data: isLive(n) ? data : { latest: [] as Payout[], total: 0n, count: 0 } };
}

/**
 * The X accounts coins pay the most, across every coin: each coin's split so far shared out by
 * the accounts' bps. What they have earned, not what they have claimed.
 */
export function useTopEarners(limit = 5) {
  const { data: coins } = useCoins();
  return useMemo(() => {
    const by = new Map<string, { handle: string; xId: bigint; earned: bigint; coins: number }>();
    for (const c of coins ?? []) {
      const total = c.recipients.reduce((s, r) => s + r.bps, 0) || 1;
      for (const r of c.recipients) {
        const k = r.xId.toString();
        const e = by.get(k) ?? { handle: r.handle, xId: r.xId, earned: 0n, coins: 0 };
        e.earned += (c.accountsEarned * BigInt(r.bps)) / BigInt(total);
        e.coins += 1;
        by.set(k, e);
      }
    }
    return [...by.values()].sort((a, b) => (b.earned > a.earned ? 1 : b.earned < a.earned ? -1 : b.coins - a.coins)).slice(0, limit);
  }, [coins, limit]);
}
