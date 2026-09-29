import "server-only";
import { zeroAddress, type Address } from "viem";
import { launcherAbi } from "./abi";
import {
  FIRST_SPAN,
  mergeLogs,
  readCoins,
  readWiring,
  scanActivity,
  scanPayouts,
  tradesBetween,
  venueOf,
  withTimes,
  type CoinTrades,
  type Payout,
  type ScanState,
  type Snapshot,
  type Venue,
  type Wiring,
} from "./chain-reads";
import { isHidden, type Network, type NetworkId } from "./networks";
import { toCoin } from "./pons";
import { serverClient } from "./server-network";
import type { Coin, Trade } from "./types";

/**
 * The server's side of the shared chain reads. However many visitors ask, each network is read at
 * most once per FRESH_MS per server instance (concurrent requests share one read), and log scans
 * continue from where the last one stopped. The CDN in front caches the answers on top of that.
 */
const FRESH_MS = 5_000;

/** For the CDN: shared answers are kept a few seconds (browsers themselves don't cache them). */
export const CDN_CACHE = "public, max-age=0, s-maxage=10, stale-while-revalidate=20";

type Memo<T> = { at: number; value?: T; inflight?: Promise<T> };

async function memo<T>(m: Memo<T>, read: () => Promise<T>): Promise<T> {
  if (m.value !== undefined && Date.now() - m.at < FRESH_MS) return m.value;
  if (m.inflight) return m.inflight;
  m.inflight = read()
    .then((value) => {
      m.value = value;
      m.at = Date.now();
      return value;
    })
    .finally(() => {
      m.inflight = undefined;
    });
  return m.inflight;
}

type TradeLog = Omit<Trade, "timestamp">;
type NetState = {
  wiring?: Wiring;
  activity: ScanState<TradeLog>;
  payouts: ScanState<Omit<Payout, "timestamp" | "handle">>;
  snapshot: Memo<Snapshot>;
};
const nets = new Map<NetworkId, NetState>();
const stateOf = (n: Network) => {
  let s = nets.get(n.id);
  if (!s) nets.set(n.id, (s = { activity: null, payouts: null, snapshot: { at: 0 } }));
  return s;
};

async function wiringOf(n: Network): Promise<Wiring> {
  const s = stateOf(n);
  return (s.wiring ??= await readWiring(serverClient(n), n.launcher!));
}

/** The coin list, the day's activity and the week's payouts of a live network. */
export function snapshotFor(n: Network): Promise<Snapshot> {
  const s = stateOf(n);
  return memo(s.snapshot, async () => {
    const c = serverClient(n);
    const [coins, wiring] = await Promise.all([readCoins(c, n.launcher!), wiringOf(n)]);
    // Hidden coins stay out of the ticker and the 24h numbers, as everywhere else.
    const listed = coins.filter((x) => !isHidden(n, x.token));
    const [activity, payouts] = await Promise.all([
      scanActivity(c, n.id, listed, wiring, s.activity).catch(() => null),
      scanPayouts(c, n.id, n.feeVault!, s.payouts).catch(() => null),
    ]);
    if (activity) s.activity = activity.state;
    if (payouts) s.payouts = payouts.state;
    return { at: Date.now(), coins, activity: activity?.activity ?? null, payouts: payouts?.payouts ?? null };
  });
}

type CoinState = { venue: Venue; createdBlock: bigint; scan: { from: bigint; to: bigint; items: TradeLog[] } | null; memo: Memo<CoinTrades> };
const coinStates = new Map<string, CoinState>();
/** Coins followed at once per instance; the least recently added is dropped past this. */
const MAX_COINS = 500;
/** Addresses recently found not to be coins, so repeated lookups don't reach the RPC. */
const misses = new Map<string, number>();
const MISS_MS = 30_000;
const RESCAN = 64n;

/** The coin at `token`, from the shared snapshot when it's there, else from the chain. */
async function findCoin(n: Network, token: Address): Promise<Coin | null> {
  const k = `${n.id}:${token.toLowerCase()}`;
  const missedAt = misses.get(k);
  if (missedAt && Date.now() - missedAt < MISS_MS) return null;
  const listed = (await snapshotFor(n).catch(() => null))?.coins.find((c) => c.token.toLowerCase() === token.toLowerCase());
  if (listed) return listed;
  const v = await serverClient(n).readContract({ address: n.launcher!, abi: launcherAbi, functionName: "getLaunch", args: [token] });
  if (v.launch.token !== zeroAddress) return toCoin(v);
  if (misses.size > 5_000) misses.clear();
  misses.set(k, Date.now());
  return null;
}

/**
 * A coin's trades over its latest ~2 days, or null when the address isn't a coin of this
 * launcher. Continues from the last read, like the snapshot (re-reading a few blocks, merged by
 * transaction and log index, never moving its cursor backwards).
 */
export async function coinTradesFor(n: Network, token: Address): Promise<CoinTrades | null> {
  const k = `${n.id}:${token.toLowerCase()}`;
  let s = coinStates.get(k);
  if (!s) {
    const coin = await findCoin(n, token);
    if (!coin) return null;
    s = { venue: venueOf(coin), createdBlock: coin.createdBlock, scan: null, memo: { at: 0 } };
    if (coinStates.size >= MAX_COINS) coinStates.delete(coinStates.keys().next().value!);
    coinStates.set(k, s);
  }
  const st = s;
  const wiring = await wiringOf(n);
  return memo(st.memo, async () => {
    const c = serverClient(n);
    const latest = await c.getBlockNumber();
    const head = st.scan && st.scan.to > latest ? st.scan.to : latest;
    const floor = head - FIRST_SPAN > st.createdBlock ? head - FIRST_SPAN : st.createdBlock;
    const from = st.scan ? (st.scan.to + 1n - RESCAN > floor ? st.scan.to + 1n - RESCAN : floor) : floor;
    const fresh = from > head ? [] : await tradesBetween(c, [st.venue], wiring, from, head);
    const items = mergeLogs(st.scan?.items ?? [], fresh).filter((t) => t.blockNumber >= floor);
    st.scan = { from: floor, to: head, items };
    return { from: floor, to: head, trades: await withTimes(c, n.id, items) };
  });
}
