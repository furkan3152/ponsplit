import "server-only";
import { Connection, PublicKey } from "@solana/web3.js";
import { CREATOR_VAULT_SIZE, decodeCreatorVault } from "./tiktok-escrow";
import { parseMetadata, safeUrl, type TokenMetadata } from "../metadata";
import { rateLimit } from "../ratelimit";
import { fetchPublicBytes } from "../safe-image";
import { rpcUrls } from "./config";
import { PUBLIC_MAINNET_RPC, PUBLIC_INDEX_RPC } from "./rpc";
import { listCoins, many, readCoin, type Coin } from "./reads";
import { recentTrades, type Trade } from "./trades";

/**
 * The server's side of Splitdev's chain reads. However many visitors ask, the coin list is read at
 * most once per FRESH_MS per server instance (concurrent requests share one read) and the CDN in
 * front keeps each answer a few seconds on top of that.
 */
const FRESH_MS = 5_000;
export const CDN_CACHE = "public, max-age=0, s-maxage=10, stale-while-revalidate=20";

let conn: Connection | null = null;
/** Official public mainnet RPC supports indexed scans; no legacy paid credentials. */
export function serverConnection(): Connection {
  if (!conn) {
    const endpoint = rpcUrls()[0];
    conn = new Connection(endpoint === PUBLIC_MAINNET_RPC ? PUBLIC_INDEX_RPC : endpoint, "confirmed");
  }
  return conn;
}

let tradeConnections: Connection[] | undefined;
/** Indexed account scans and transaction history have different public RPC limits. */
function historyConnections(): Connection[] {
  if (!tradeConnections) {
    const endpoint = rpcUrls()[0];
    const endpoints = endpoint === PUBLIC_MAINNET_RPC ? [PUBLIC_MAINNET_RPC, PUBLIC_INDEX_RPC] : [endpoint];
    tradeConnections = endpoints.map((url) => new Connection(url, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      fetch: async (input, init) => {
        // Fail over promptly instead of keeping the chart in a rate-limit retry loop.
        return fetch(input, { ...init, signal: AbortSignal.timeout(8_000) });
      },
    }));
  }
  return tradeConnections;
}

import type { CoinView, Earner, GithubRecipient, Snapshot } from "./server-types";
export type { CoinView, Earner, GithubRecipient, Snapshot };

type Memo<T> = { at: number; value?: T; inflight?: Promise<T> };
async function memo<T>(m: Memo<T>, read: () => Promise<T>, fresh = FRESH_MS): Promise<T> {
  if (m.value !== undefined && Date.now() - m.at < fresh) return m.value;
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

// ── Metadata JSON (name, description, image, links), fetched once per URI ─────────────────────
// Metadata URIs are immutable, so good answers are kept for good; failures are kept for 5 minutes,
// and no fetch may hold the snapshot longer than 2.5 s (a coin whose metadata host is slow or never
// answers must not slow the whole site down; its details fill in on a later refresh).
const metaCache = new Map<string, TokenMetadata>();
const metaMiss = new Map<string, number>();
const metaInflight = new Map<string, Promise<TokenMetadata | null>>();
async function metadataFor(uri: string): Promise<TokenMetadata> {
  const hit = metaCache.get(uri);
  if (hit) return hit;
  if ((metaMiss.get(uri) ?? 0) > Date.now()) return {};
  let job = metaInflight.get(uri);
  if (!job) {
    const url = safeUrl(uri);
    job = (url ? fetchPublicBytes(url, 64 * 1024).catch(() => null) : Promise.resolve(null))
      .then((bytes) => {
        if (!bytes) {
          if (metaMiss.size > 5_000) metaMiss.delete(metaMiss.keys().next().value as string);
          metaMiss.set(uri, Date.now() + 5 * 60_000);
          return null;
        }
        const meta = parseMetadata(Buffer.from(bytes).toString("utf8"));
        if (metaCache.size > 5_000) metaCache.delete(metaCache.keys().next().value as string);
        metaCache.set(uri, meta);
        return meta;
      })
      .finally(() => metaInflight.delete(uri));
    metaInflight.set(uri, job);
  }
  const meta = await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), 2_500))]);
  return meta ?? {};
}

// ── A coin's age: the block time of its first transaction, found once ─────────────────────────
// Found once and kept. Past 4,000 transactions the launch time is unknown (null, also kept): the
// 4,000th-newest transaction would make an old, busy coin look new. A failed read retries after a minute.
const created = new Map<string, number | null>();
const createdMiss = new Map<string, number>();
async function createdAt(c: Connection, mint: string): Promise<number | null> {
  if (created.has(mint)) return created.get(mint)!;
  if ((createdMiss.get(mint) ?? 0) > Date.now()) return null;
  let before: string | undefined;
  let oldest: { blockTime?: number | null } | undefined;
  // The mint is in every transaction of the coin; its oldest one is the launch.
  for (let page = 0; page < 4; page++) {
    const sigs = await c.getSignaturesForAddress(new PublicKey(mint), { limit: 1000, before }, "confirmed").catch(() => null);
    if (!sigs) {
      createdMiss.set(mint, Date.now() + 60_000);
      return null;
    }
    if (sigs.length) oldest = sigs[sigs.length - 1];
    if (sigs.length < 1000) {
      const t = oldest?.blockTime ?? null;
      created.set(mint, t);
      return t;
    }
    before = sigs[sigs.length - 1].signature;
  }
  created.set(mint, null);
  return null;
}

async function enrich(c: Connection, coins: Coin[]): Promise<CoinView[]> {
  const [metas, ages] = await Promise.all([
    Promise.all(coins.map((x) => metadataFor(x.uri).catch(() => ({}) as TokenMetadata))),
    Promise.all(coins.map((x) => createdAt(c, x.token))),
  ]);
  return coins.map((x, i) => ({ ...metas[i], ...x, createdAt: ages[i] }));
}

async function earnersOf(c: Connection, coins: CoinView[]): Promise<Earner[]> {
  const byHandle = new Map<string, Earner>();
  for (const coin of coins) for (const r of coin.recipients) {
    const e = byHandle.get(r.handle) ?? { handle: r.handle, claimable: 0n, claimed: 0n, coins: 0, verified: r.verified, wallet: r.wallet };
    e.coins++;
    byHandle.set(r.handle, e);
  }
  const accounts = [...new Map(coins.flatMap(x => x.recipients).map(r => [r.handle, r])).values()];
  if (!accounts.length) return [];
  const keys = accounts.map(r => new PublicKey(r.feeAccount));
  const infos = await many(c, keys);
  const rent = await c.getMinimumBalanceForRentExemption(CREATOR_VAULT_SIZE);
  infos.forEach((info, i) => {
    const vault = decodeCreatorVault(info, keys[i]);
    if (!vault || !info) throw new Error("A creator vault could not be read.");
    const e = byHandle.get(accounts[i].handle)!;
    if (!Number.isSafeInteger(info.lamports)) throw new Error("Creator balance exceeds safe RPC precision.");
    e.claimable = BigInt(Math.max(0, info.lamports - rent));
    e.claimed = vault.totalClaimed;
    e.verified = vault.verified;
    e.wallet = vault.beneficiary?.toBase58();
  });
  return [...byHandle.values()].sort((a,b) => Number(b.claimable + b.claimed - a.claimable - a.claimed));
}

const snap: Memo<Snapshot> = { at: 0 };
/** Every Splitdev coin (with metadata, GitHub profiles and age) and the GitHub accounts they pay. */
export function snapshot(): Promise<Snapshot> {
  return memo(snap, async () => {
    const c = serverConnection();
    const coins = await enrich(c, await listCoins(c));
    const earners = await earnersOf(c, coins);
    return { at: Date.now(), coins, earners };
  });
}

/** One coin (from the snapshot when it's there, else read directly), or null if it isn't a Splitdev coin. */
export async function coinView(mint: string): Promise<CoinView | null> {
  let key: PublicKey;
  try {
    key = new PublicKey(mint);
  } catch {
    return null;
  }
  const listed = (await snapshot().catch(() => null))?.coins.find((x) => x.token === mint);
  if (listed) return listed;
  // Not in the list (brand new, or not a Splitdev coin at all): one direct read, but a miss is
  // remembered for 30 s and direct reads have a site-wide budget, so looping over random addresses
  // can't spend the RPC.
  if ((notACoin.get(mint) ?? 0) > Date.now()) return null;
  if (!rateLimit("coin-read:*", 120, 60_000)) return null;
  const c = serverConnection();
  const coin = await readCoin(c, key);
  if (!coin) {
    if (notACoin.size > 5_000) notACoin.delete(notACoin.keys().next().value as string);
    notACoin.set(mint, Date.now() + 30_000);
    return null;
  }
  return (await enrich(c, [coin]))[0];
}
const notACoin = new Map<string, number>();

const tradeMemos = new Map<string, Memo<Trade[]>>();
/** A coin's latest trades, shared by every visitor of its page. */
export function coinTrades(mint: string, graduated: boolean): Promise<Trade[]> {
  let m = tradeMemos.get(mint);
  if (!m) {
    if (tradeMemos.size > 500) tradeMemos.delete(tradeMemos.keys().next().value as string);
    tradeMemos.set(mint, (m = { at: 0 }));
  }
  return memo(m, async () => {
    let failure: unknown;
    for (const connection of historyConnections()) {
      try {
        return await recentTrades(connection, new PublicKey(mint), graduated, 150);
      } catch (error) {
        failure = error;
      }
    }
    // Do not turn an RPC failure into an empty trade history. The client retains
    // any previously displayed trades and exposes retry when both providers fail.
    throw failure ?? new Error("Trade history is temporarily unavailable.");
  });
}
