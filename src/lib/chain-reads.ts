import { parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { launcherAbi } from "./abi";
import type { NetworkId } from "./networks";
import { BPS, PONS_FEE_BPS, toCoin } from "./pons";
import type { Coin, Trade } from "./types";

/**
 * Chain reads shared by the browser (hooks.ts, as a fallback) and the server (the cached
 * snapshots in server-snapshot.ts): the coin list, trades from logs, payouts. No React here.
 */

// ------------------------------------------------------------------ coins

const PAGE = 40;

/** Every coin a launcher has made, newest first (hidden ones included; callers filter). */
export async function readCoins(c: PublicClient, launcher: Address): Promise<Coin[]> {
  const total = Number(await c.readContract({ address: launcher, abi: launcherAbi, functionName: "launchCount" }));
  const pages = await Promise.all(
    Array.from({ length: Math.ceil(total / PAGE) }, (_, i) =>
      c.readContract({ address: launcher, abi: launcherAbi, functionName: "getLaunches", args: [BigInt(i * PAGE), BigInt(PAGE)] })
    )
  );
  return pages.flat().map(toCoin);
}

export type Wiring = { poolManager: Address; router: Address };

export async function readWiring(c: PublicClient, launcher: Address): Promise<Wiring> {
  const [poolManager, router] = await Promise.all([
    c.readContract({ address: launcher, abi: launcherAbi, functionName: "poolManager" }),
    c.readContract({ address: launcher, abi: launcherAbi, functionName: "router" }),
  ]);
  return { poolManager, router };
}

// ------------------------------------------------------------------ logs

export const CURVE_BUY = parseAbiItem("event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)");
export const CURVE_SELL = parseAbiItem("event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)");
export const SWAP = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)"
);
export const POOL_TRADE = parseAbiItem(
  "event PoolTrade(address indexed token, address indexed trader, address indexed recipient, bool isBuy, uint256 ethAmount, uint256 tokenAmount)"
);

/** Robinhood Chain's public RPC answers log queries over at most 1M blocks with an address filter. */
const WINDOW = 900_000n;
/** Addresses / topics per log query (the RPC allows 1000 selectors in all). */
const CHUNK = 900;

export type AnyLog = {
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
export async function logsOver<T extends AnyLog>(query: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint): Promise<T[]> {
  const out: T[] = [];
  const windows: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += WINDOW) windows.push([start, start + WINDOW - 1n < to ? start + WINDOW - 1n : to]);
  const results = await Promise.all(windows.map(([a, b]) => logsSplit(query, a, b)));
  results.forEach((r) => out.push(...r));
  return out;
}

const blockTimes = new Map<string, number>();

/** Timestamps of the given blocks (cached: a block's time never changes). */
export async function timesOf(c: PublicClient, net: NetworkId, blocks: bigint[]): Promise<Map<bigint, number>> {
  // A long-running server keeps this bounded; dropping it only means re-reading some block times.
  if (blockTimes.size > 200_000) blockTimes.clear();
  const missing = Array.from(new Set(blocks.filter((b) => !blockTimes.has(`${net}:${b}`))));
  // In parallel, but not all at once: the batching transport sends 20 per HTTP request.
  for (let i = 0; i < missing.length; i += 100) {
    const slice = missing.slice(i, i + 100);
    const got = await Promise.all(slice.map((b) => c.getBlock({ blockNumber: b }).catch(() => null)));
    got.forEach((blk, j) => blk && blockTimes.set(`${net}:${slice[j]}`, Number(blk.timestamp)));
  }
  return new Map(blocks.map((b) => [b, blockTimes.get(`${net}:${b}`) ?? 0]));
}

export type Venue = { token: Address; curve: Address; poolId: Hex; creatorTaxBps: number };

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
export async function tradesBetween(
  c: PublicClient,
  venues: Venue[],
  wiring: { poolManager: Address; router: Address },
  from: bigint,
  to: bigint
): Promise<Omit<Trade, "timestamp">[]> {
  if (!venues.length || from > to) return [];
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
  // Pool trades made through SplitEarn name the trader; other apps' only show their router.
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

export async function withTimes(c: PublicClient, net: NetworkId, trades: Omit<Trade, "timestamp">[]): Promise<Trade[]> {
  const times = await timesOf(c, net, trades.map((t) => t.blockNumber));
  return trades.map((t) => ({ ...t, timestamp: times.get(t.blockNumber) ?? 0 }));
}

export const venueOf = (c: Coin): Venue => ({ token: c.token, curve: c.curve, poolId: c.poolId, creatorTaxBps: c.creatorTaxBps });

/** How far back a coin page reads at first (~2 days of Robinhood Chain blocks); older on request. */
export const FIRST_SPAN = 1_800_000n;

// ------------------------------------------------------------------ activity

/** Recent activity across every coin (~a day): the ticker, trending order and 24h numbers. */
const ACTIVITY_SPAN = 864_000n;

export type Activity = { trades: (Trade & { symbol: string })[]; tradesByToken: Map<string, number>; volumeByToken: Map<string, bigint> };

/** Where an incremental log scan got to, so the next one only reads the new blocks. */
export type ScanState<T> = { key: string; to: bigint; items: T[] } | null;

export async function scanActivity(
  c: PublicClient,
  net: NetworkId,
  coins: Coin[],
  wiring: Wiring,
  prev: ScanState<Omit<Trade, "timestamp">>
): Promise<{ state: NonNullable<ScanState<Omit<Trade, "timestamp">>>; activity: Activity }> {
  const venues = coins.map(venueOf);
  const symbols = new Map(coins.map((x) => [x.token.toLowerCase(), x.symbol]));
  const key = `${net}:${venues.map((v) => v.token).join(",")}`;
  const head = await c.getBlockNumber();
  const floor = head > ACTIVITY_SPAN ? head - ACTIVITY_SPAN : 0n;
  const last = prev?.key === key ? prev : null;
  const from = last ? last.to + 1n : floor;
  const fresh = await tradesBetween(c, venues, wiring, from, head);
  const trades = [...(last?.items ?? []), ...fresh].filter((t) => t.blockNumber >= floor);
  const tradesByToken = new Map<string, number>();
  const volumeByToken = new Map<string, bigint>();
  for (const t of trades) {
    const k = t.token.toLowerCase();
    tradesByToken.set(k, (tradesByToken.get(k) ?? 0) + 1);
    volumeByToken.set(k, (volumeByToken.get(k) ?? 0n) + t.ethAmount);
  }
  const latest = await withTimes(c, net, trades.slice(-30).reverse());
  return {
    state: { key, to: head, items: trades },
    activity: { trades: latest.map((t) => ({ ...t, symbol: symbols.get(t.token.toLowerCase()) ?? "" })), tradesByToken, volumeByToken },
  };
}

// ------------------------------------------------------------------ payouts

const CLAIMED = parseAbiItem("event Claimed(uint64 indexed xId, address indexed to, uint256 amount)");
/** How far back the payout feed reads (~a week of Robinhood Chain blocks). */
const PAYOUT_SPAN = 6_000_000n;

export type Payout = { xId: bigint; handle?: string; to: Address; amount: bigint; txHash: Hex; blockNumber: bigint; timestamp: number };
type PayoutLog = Omit<Payout, "timestamp" | "handle">;
export type Payouts = { latest: Payout[]; total: bigint; count: number };

export async function scanPayouts(
  c: PublicClient,
  net: NetworkId,
  feeVault: Address,
  prev: ScanState<PayoutLog>
): Promise<{ state: NonNullable<ScanState<PayoutLog>>; payouts: Payouts }> {
  const head = await c.getBlockNumber();
  const floor = head > PAYOUT_SPAN ? head - PAYOUT_SPAN : 0n;
  const key = `${net}:${feeVault}`;
  const last = prev?.key === key ? prev : null;
  const from = last ? last.to + 1n : floor;
  const fresh = (await logsOver(
    (a, b) => c.getLogs({ address: feeVault, event: CLAIMED, fromBlock: a, toBlock: b }) as Promise<AnyLog[]>,
    from,
    head
  )) as unknown as { args: { xId: bigint; to: Address; amount: bigint }; transactionHash: Hex; blockNumber: bigint }[];
  const logs = [
    ...(last?.items ?? []),
    ...fresh.map((l) => ({ xId: l.args.xId, to: l.args.to, amount: l.args.amount, txHash: l.transactionHash, blockNumber: l.blockNumber })),
  ];
  const latest = logs.slice(-20).reverse();
  const times = await timesOf(c, net, latest.map((l) => l.blockNumber));
  return {
    state: { key, to: head, items: logs },
    payouts: { latest: latest.map((l) => ({ ...l, timestamp: times.get(l.blockNumber) ?? 0 })), total: logs.reduce((s, l) => s + l.amount, 0n), count: logs.length },
  };
}

// ------------------------------------------------------------------ snapshots

/**
 * What every visitor of a network sees, read once on the server and cached by the CDN for a few
 * seconds (/api/snapshot). A part that couldn't be read is null; browsers read it themselves then.
 */
export type Snapshot = { at: number; coins: Coin[]; activity: Activity | null; payouts: Payouts | null };

/** A coin's recent trades as the server read them (/api/trades): the window [from, to]. */
export type CoinTrades = { from: bigint; to: bigint; trades: Trade[] };
