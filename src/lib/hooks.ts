"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, http, parseAbiItem, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { feeSplitterAbi, feeVaultAbi, launcherAbi, ponsFactoryAbi, ponsTokenAbi } from "./abi";
import { useNetwork } from "./network-context";
import { NETWORKS, isHidden, isLive, otherNetwork, type Network, type NetworkId } from "./networks";
import { BPS, PONS_FEE_BPS, toCoin, toRecipients } from "./pons";
import type { Coin, Trade } from "./types";

// ------------------------------------------------------------------ clients

const clients = new Map<string, PublicClient>();

/**
 * A client per network for the heavy reads (coin pages, logs). Unlike wagmi's, it never merges calls
 * into one Multicall3 call (a few big pages in one eth_call could pass the node's gas cap); concurrent
 * requests still share HTTP round trips through JSON-RPC batching.
 */
export function clientFor(n: Network): PublicClient {
  const key = `${n.id}:${n.rpcUrl}`;
  let c = clients.get(key);
  if (!c) {
    c = createPublicClient({ chain: n.chain, transport: http(n.rpcUrl, { batch: { batchSize: 20 }, retryCount: 3, retryDelay: 400 }) }) as PublicClient;
    clients.set(key, c);
  }
  return c;
}

// ------------------------------------------------------------------ coins

// getLaunches reads ~15 Pons values per coin; 40 per call stays well under RPC gas caps.
const PAGE = 40;

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
      const c = clientFor(n);
      const total = Number(await c.readContract({ address: n.launcher!, abi: launcherAbi, functionName: "launchCount" }));
      const pages = await Promise.all(
        Array.from({ length: Math.ceil(total / PAGE) }, (_, i) =>
          c.readContract({ address: n.launcher!, abi: launcherAbi, functionName: "getLaunches", args: [BigInt(i * PAGE), BigInt(PAGE)] })
        )
      );
      return pages.flat().map(toCoin);
    },
  });
  const hidden = useMemo(() => new Set(n.hidden.map((a) => a.toLowerCase())), [n.hidden]);
  const data = useMemo(() => (hidden.size && query.data ? query.data.filter((c) => !hidden.has(c.token.toLowerCase())) : query.data), [query.data, hidden]);
  return { ...query, data };
}

/** One coin with its live Pons state; `null` when it isn't a PonsEarn coin on this network. */
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
 * Whether a coin that isn't on this network is a PonsEarn coin on the other one (a shared link can
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
  return { coins: coins ? BigInt(coins.length) : undefined, feesSplit: isLive(n) ? feesSplit : 0n };
}

// ------------------------------------------------------------------ logs

const CURVE_BUY = parseAbiItem("event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)");
const CURVE_SELL = parseAbiItem("event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)");
const SWAP = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)"
);
const POOL_TRADE = parseAbiItem(
  "event PoolTrade(address indexed token, address indexed trader, address indexed recipient, bool isBuy, uint256 ethAmount, uint256 tokenAmount)"
);

/** Robinhood Chain's public RPC answers log queries over at most 1M blocks with an address filter. */
const WINDOW = 900_000n;
/** Addresses / topics per log query (the RPC allows 1000 selectors in all). */
const CHUNK = 900;

type AnyLog = {
  blockNumber: bigint | null;
  logIndex: number | null;
  transactionHash: Hex | null;
  address: Address;
  eventName?: string;
  args?: unknown;
};

/** getLogs over [from, to], halving the range whenever the node says the answer is too big. */
async function logsSplit<T extends AnyLog>(query: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint): Promise<T[]> {
  if (from > to) return [];
  try {
    return await query(from, to);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (to - from < 2_000n || !/limit|too many|exceed|spans|range|timed? ?out|10000/i.test(msg)) throw e;
    const mid = from + (to - from) / 2n;
    const [a, b] = await Promise.all([logsSplit(query, from, mid), logsSplit(query, mid + 1n, to)]);
    return [...a, ...b];
  }
}

/** Runs a log query over any block range in windows the RPC accepts. */
async function logsOver<T extends AnyLog>(query: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint): Promise<T[]> {
  const out: T[] = [];
  const windows: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += WINDOW) windows.push([start, start + WINDOW - 1n < to ? start + WINDOW - 1n : to]);
  const results = await Promise.all(windows.map(([a, b]) => logsSplit(query, a, b)));
  results.forEach((r) => out.push(...r));
  return out;
}

const blockTimes = new Map<string, number>();

/** Timestamps of the given blocks (cached: a block's time never changes). */
async function timesOf(n: Network, blocks: bigint[]): Promise<Map<bigint, number>> {
  const c = clientFor(n);
  const missing = Array.from(new Set(blocks.filter((b) => !blockTimes.has(`${n.id}:${b}`))));
  // In parallel, but not all at once: the batching transport sends 20 per HTTP request.
  for (let i = 0; i < missing.length; i += 100) {
    const slice = missing.slice(i, i + 100);
    const got = await Promise.all(slice.map((b) => c.getBlock({ blockNumber: b }).catch(() => null)));
    got.forEach((blk, j) => blk && blockTimes.set(`${n.id}:${slice[j]}`, Number(blk.timestamp)));
  }
  return new Map(blocks.map((b) => [b, blockTimes.get(`${n.id}:${b}`) ?? 0]));
}

type Venue = { token: Address; curve: Address; poolId: Hex; creatorTaxBps: number };

function fromCurveLog(log: AnyLog, token: Address): Omit<Trade, "timestamp"> | null {
  const a = log.args as Record<string, bigint | Address>;
  if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) return null;
  const base = { token, venue: "curve" as const, blockNumber: log.blockNumber, logIndex: log.logIndex, txHash: log.transactionHash };
  if (log.eventName === "CurveBuy") {
    const quoteIn = a.quoteIn as bigint;
    const tokensOut = a.tokensOut as bigint;
    const net = quoteIn - (a.fee as bigint) - (a.tax as bigint);
    return { ...base, kind: "buy", trader: a.recipient as Address, ethAmount: quoteIn, tokenAmount: tokensOut, price: tokensOut === 0n ? 0 : Number(net) / Number(tokensOut) };
  }
  if (log.eventName === "CurveSell") {
    const quoteOut = a.quoteOut as bigint;
    const tokensIn = a.tokensIn as bigint;
    const gross = quoteOut + (a.fee as bigint) + (a.tax as bigint);
    return { ...base, kind: "sell", trader: a.recipient as Address, ethAmount: quoteOut, tokenAmount: tokensIn, price: tokensIn === 0n ? 0 : Number(gross) / Number(tokensIn) };
  }
  return null;
}

/**
 * A Pons pool swap from the trader's side. The Swap event reports the pool's amounts before the
 * Pons hook takes its fee (1% plus the creator tax) from the output, so that is taken off here.
 */
function fromSwapLog(log: AnyLog, v: Venue, traders: Map<string, Address>): Omit<Trade, "timestamp"> | null {
  const a = log.args as { sender: Address; amount0: bigint; amount1: bigint };
  if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) return null;
  const cut = (x: bigint) => x - (x * BigInt(PONS_FEE_BPS)) / BPS - (x * BigInt(v.creatorTaxBps)) / BPS;
  const buy = a.amount0 < 0n;
  const ethGross = buy ? -a.amount0 : a.amount0;
  const tokensGross = buy ? a.amount1 : -a.amount1;
  if (ethGross <= 0n || tokensGross <= 0n) return null;
  return {
    token: v.token,
    venue: "pool",
    kind: buy ? "buy" : "sell",
    trader: traders.get(log.transactionHash.toLowerCase()) ?? a.sender,
    ethAmount: buy ? ethGross : cut(ethGross),
    tokenAmount: buy ? cut(tokensGross) : tokensGross,
    price: Number(ethGross) / Number(tokensGross),
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    txHash: log.transactionHash,
  };
}

const byChain = (a: Pick<Trade, "blockNumber" | "logIndex">, b: Pick<Trade, "blockNumber" | "logIndex">) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

/** Every trade of these coins between two blocks: on their curves and in their Pons pools. */
async function tradesBetween(
  n: Network,
  venues: Venue[],
  wiring: { poolManager: Address; router: Address },
  from: bigint,
  to: bigint
): Promise<Omit<Trade, "timestamp">[]> {
  if (!venues.length || from > to) return [];
  const c = clientFor(n);
  const byCurve = new Map(venues.map((v) => [v.curve.toLowerCase(), v]));
  const byPool = new Map(venues.map((v) => [v.poolId.toLowerCase(), v]));
  const chunks = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

  const curveLogs = (
    await Promise.all(
      chunks(venues.map((v) => v.curve)).map((addresses) =>
        logsOver((a, b) => c.getLogs({ address: addresses, events: [CURVE_BUY, CURVE_SELL], fromBlock: a, toBlock: b }) as Promise<AnyLog[]>, from, to)
      )
    )
  ).flat();
  const swapLogs = (
    await Promise.all(
      chunks(venues.map((v) => v.poolId)).map((ids) =>
        logsOver((a, b) => c.getLogs({ address: wiring.poolManager, event: SWAP, args: { id: ids }, fromBlock: a, toBlock: b }) as Promise<AnyLog[]>, from, to)
      )
    )
  ).flat();
  // Pool trades made through PonsEarn name the trader; other apps' only show their router.
  const traders = new Map<string, Address>();
  if (swapLogs.length) {
    const tagged = await logsOver(
      (a, b) => c.getLogs({ address: wiring.router, event: POOL_TRADE, fromBlock: a, toBlock: b }) as Promise<AnyLog[]>,
      from,
      to
    );
    for (const t of tagged) if (t.transactionHash) traders.set(t.transactionHash.toLowerCase(), (t.args as { trader: Address }).trader);
  }

  const out: Omit<Trade, "timestamp">[] = [];
  for (const log of curveLogs) {
    const v = byCurve.get(log.address.toLowerCase());
    const t = v && fromCurveLog(log, v.token);
    if (t) out.push(t);
  }
  for (const log of swapLogs) {
    const id = ((log as unknown as { topics?: Hex[] }).topics?.[1] ?? (log.args as { id?: Hex }).id ?? "").toLowerCase();
    const v = byPool.get(id);
    const t = v && fromSwapLog(log, v, traders);
    if (t) out.push(t);
  }
  return out.sort(byChain);
}

async function withTimes(n: Network, trades: Omit<Trade, "timestamp">[]): Promise<Trade[]> {
  const times = await timesOf(n, trades.map((t) => t.blockNumber));
  return trades.map((t) => ({ ...t, timestamp: times.get(t.blockNumber) ?? 0 }));
}

const venueOf = (c: Coin): Venue => ({ token: c.token, curve: c.curve, poolId: c.poolId, creatorTaxBps: c.creatorTaxBps });

/** How far back a coin page reads at first (~2 days of Robinhood Chain blocks); older on request. */
const FIRST_SPAN = 1_800_000n;

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
    if (!venue || !wiring || createdBlock === undefined || busy.current) return;
    busy.current = true;
    try {
      const head = await clientFor(n).getBlockNumber();
      const current = stateRef.current?.key === key ? stateRef.current : null;
      const from = current ? current.to + 1n : head - FIRST_SPAN > createdBlock ? head - FIRST_SPAN : createdBlock;
      if (from > head) return;
      const fresh = await withTimes(n, await tradesBetween(n, [venue], wiring, from, head));
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
      const to = s.from - 1n;
      const from = to - FIRST_SPAN > createdBlock ? to - FIRST_SPAN : createdBlock;
      const older = await withTimes(n, await tradesBetween(n, [venue], wiring, from, to));
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
const ACTIVITY_SPAN = 864_000n;

export type Activity = { trades: (Trade & { symbol: string })[]; tradesByToken: Map<string, number>; volumeByToken: Map<string, bigint> };

export function useActivity() {
  const n = useNetwork();
  const { data: coins } = useCoins();
  const { data: wiring } = useLauncherInfo();
  const venues = useMemo(() => (coins ?? []).map(venueOf), [coins]);
  const symbols = useMemo(() => new Map((coins ?? []).map((c) => [c.token.toLowerCase(), c.symbol])), [coins]);
  const venueKey = venues.map((v) => v.token).join(",");
  const cache = useRef<{ key: string; to: bigint; trades: Omit<Trade, "timestamp">[] } | null>(null);
  return useQuery({
    queryKey: ["activity", n.id, n.launcher, venueKey],
    enabled: Boolean(wiring && coins),
    refetchInterval: 12_000,
    queryFn: async (): Promise<Activity> => {
      const head = await clientFor(n).getBlockNumber();
      const floor = head > ACTIVITY_SPAN ? head - ACTIVITY_SPAN : 0n;
      const key = `${n.id}:${venueKey}`;
      const prev = cache.current?.key === key ? cache.current : null;
      const from = prev ? prev.to + 1n : floor;
      const fresh = await tradesBetween(n, venues, wiring!, from, head);
      const trades = [...(prev?.trades ?? []), ...fresh].filter((t) => t.blockNumber >= floor);
      cache.current = { key, to: head, trades };
      const tradesByToken = new Map<string, number>();
      const volumeByToken = new Map<string, bigint>();
      for (const t of trades) {
        const k = t.token.toLowerCase();
        tradesByToken.set(k, (tradesByToken.get(k) ?? 0) + 1);
        volumeByToken.set(k, (volumeByToken.get(k) ?? 0n) + t.ethAmount);
      }
      const latest = await withTimes(n, trades.slice(-30).reverse());
      return { trades: latest.map((t) => ({ ...t, symbol: symbols.get(t.token.toLowerCase()) ?? "" })), tradesByToken, volumeByToken };
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
