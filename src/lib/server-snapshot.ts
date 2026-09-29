import "server-only";
import { zeroAddress, type Address } from "viem";
import { launcherAbi } from "./abi";
import {
  FIRST_SPAN,
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
import type { Network, NetworkId } from "./networks";
import { toCoin } from "./pons";
import { serverClient } from "./server-network";
import type { Trade } from "./types";

/**
 * The server's side of the shared chain reads. However many visitors ask, each network is read at
 * most once per FRESH_MS per server instance (concurrent requests share one read), and log scans
 * continue from where the last one stopped. The CDN in front caches the answers on top of that.
 */
const FRESH_MS = 2_000;

/** For the CDN: shared answers are kept a few seconds (browsers themselves don't cache them). */
export const CDN_CACHE = "public, max-age=0, s-maxage=4, stale-while-revalidate=10";

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
    const [activity, payouts] = await Promise.all([
      scanActivity(c, n.id, coins, wiring, s.activity).catch(() => null),
      scanPayouts(c, n.id, n.feeVault!, s.payouts).catch(() => null),
    ]);
    if (activity) s.activity = activity.state;
    if (payouts) s.payouts = payouts.state;
    return { at: Date.now(), coins, activity: activity?.activity ?? null, payouts: payouts?.payouts ?? null };
  });
}

type CoinState = { venue: Venue; createdBlock: bigint; scan: { from: bigint; to: bigint; items: TradeLog[] } | null; memo: Memo<CoinTrades> };
const coinStates = new Map<string, CoinState | null>();
/** Coins followed at once per instance; the least recently added is dropped past this. */
const MAX_COINS = 500;

/**
 * A coin's trades over its latest ~2 days, or null when the address isn't a coin of this
 * launcher. Continues from the last read, like the snapshot.
 */
export async function coinTradesFor(n: Network, token: Address): Promise<CoinTrades | null> {
  const k = `${n.id}:${token.toLowerCase()}`;
  let s = coinStates.get(k);
  if (s === undefined) {
    const v = await serverClient(n).readContract({ address: n.launcher!, abi: launcherAbi, functionName: "getLaunch", args: [token] });
    const coin = v.launch.token === zeroAddress ? null : toCoin(v);
    s = coin ? { venue: venueOf(coin), createdBlock: coin.createdBlock, scan: null, memo: { at: 0 } } : null;
    if (coinStates.size >= MAX_COINS) coinStates.delete(coinStates.keys().next().value!);
    // Not a coin yet may mean launched a moment ago: only coins are remembered.
    if (s) coinStates.set(k, s);
  }
  if (!s) return null;
  const st = s;
  const wiring = await wiringOf(n);
  return memo(st.memo, async () => {
    const c = serverClient(n);
    const head = await c.getBlockNumber();
    const floor = head - FIRST_SPAN > st.createdBlock ? head - FIRST_SPAN : st.createdBlock;
    const from = st.scan ? st.scan.to + 1n : floor;
    const fresh = from > head ? [] : await tradesBetween(c, [st.venue], wiring, from, head);
    const items = [...(st.scan?.items ?? []), ...fresh].filter((t) => t.blockNumber >= floor);
    st.scan = { from: floor, to: head, items };
    return { from: floor, to: head, trades: await withTimes(c, n.id, items) };
  });
}
