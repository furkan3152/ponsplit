import "server-only";
import { Connection, PublicKey } from "@solana/web3.js";
import { PUMP_SDK } from "@pump-fun/pump-sdk";
import { resolveIds } from "../github";
import { parseMetadata, safeUrl, type TokenMetadata } from "../metadata";
import { fetchPublicBytes } from "../safe-image";
import { rpcUrls } from "./config";
import { PUMP_FEES_PROGRAM_ID } from "./pump";
import { listCoins, many, readCoin, type Coin } from "./reads";
import { recentTrades, type Trade } from "./trades";

/**
 * The server's side of Splidev's chain reads. However many visitors ask, the coin list is read at
 * most once per FRESH_MS per server instance (concurrent requests share one read) and the CDN in
 * front keeps each answer a few seconds on top of that.
 */
const FRESH_MS = 5_000;
export const CDN_CACHE = "public, max-age=0, s-maxage=10, stale-while-revalidate=20";

let conn: Connection | null = null;
/** SOLANA_RPC_URL (server only, e.g. a paid key) first, else the public endpoints. */
export function serverConnection(): Connection {
  if (!conn) conn = new Connection(process.env.SOLANA_RPC_URL?.split(",")[0]?.trim() || rpcUrls()[0], "confirmed");
  return conn;
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
const metaCache = new Map<string, TokenMetadata>();
async function metadataFor(uri: string): Promise<TokenMetadata> {
  const hit = metaCache.get(uri);
  if (hit) return hit;
  const url = safeUrl(uri);
  const bytes = url ? await fetchPublicBytes(url, 64 * 1024).catch(() => null) : null;
  const meta = bytes ? parseMetadata(Buffer.from(bytes).toString("utf8")) : {};
  if (bytes) {
    if (metaCache.size > 5_000) metaCache.delete(metaCache.keys().next().value as string);
    metaCache.set(uri, meta); // metadata URIs are immutable; failures are retried next time
  }
  return meta;
}

// ── A coin's age: the block time of its first transaction, found once ─────────────────────────
const created = new Map<string, number | null>();
async function createdAt(c: Connection, mint: string): Promise<number | null> {
  if (created.has(mint)) return created.get(mint)!;
  let before: string | undefined;
  let oldest: { blockTime?: number | null } | undefined;
  // The mint is in every transaction of the coin; its oldest one is the launch.
  for (let page = 0; page < 4; page++) {
    const sigs = await c.getSignaturesForAddress(new PublicKey(mint), { limit: 1000, before }, "confirmed").catch(() => null);
    if (!sigs) return null;
    if (sigs.length) oldest = sigs[sigs.length - 1];
    if (sigs.length < 1000) {
      const t = oldest?.blockTime ?? null;
      created.set(mint, t);
      return t;
    }
    before = sigs[sigs.length - 1].signature;
  }
  return oldest?.blockTime ?? null; // older than 4,000 transactions: an upper bound, not remembered
}

async function enrich(c: Connection, coins: Coin[]): Promise<CoinView[]> {
  const ids = Array.from(new Set(coins.flatMap((x) => x.recipients.map((r) => r.githubId))));
  const [profiles, metas, ages] = await Promise.all([
    resolveIds(ids).catch(() => ({}) as Awaited<ReturnType<typeof resolveIds>>),
    Promise.all(coins.map((x) => metadataFor(x.uri).catch(() => ({}) as TokenMetadata))),
    Promise.all(coins.map((x) => createdAt(c, x.token))),
  ]);
  return coins.map((x, i) => ({
    ...x,
    ...metas[i],
    createdAt: ages[i],
    recipients: x.recipients.map((r) => {
      const p = profiles[r.githubId];
      return p ? { ...r, login: p.login, name: p.name, avatar: p.avatar } : r;
    }),
  }));
}

async function earnersOf(c: Connection, coins: CoinView[]): Promise<Earner[]> {
  const byId = new Map<string, Earner>();
  for (const coin of coins)
    for (const r of coin.recipients) {
      const e = byId.get(r.githubId) ?? { githubId: r.githubId, login: r.login, avatar: r.avatar, claimable: 0n, claimed: 0n, coins: 0 };
      e.coins++;
      byId.set(r.githubId, e);
    }
  const list = [...byId.values()];
  const accounts = coins.flatMap((x) => x.recipients).filter((r, i, all) => all.findIndex((o) => o.githubId === r.githubId) === i);
  const infos = await many(c, accounts.map((r) => new PublicKey(r.feeAccount)));
  const rent = await c.getMinimumBalanceForRentExemption(infos.find(Boolean)?.data.length ?? 0);
  infos.forEach((info, i) => {
    if (!info || !info.owner.equals(PUMP_FEES_PROGRAM_ID)) return;
    const e = byId.get(accounts[i].githubId)!;
    e.claimable = BigInt(Math.max(0, info.lamports - rent));
    try {
      e.claimed = BigInt(PUMP_SDK.decodeSocialFeePda(info).totalClaimed.toString());
    } catch {
      // not readable: leave at 0
    }
  });
  return list.sort((a, b) => Number(b.claimable + b.claimed - (a.claimable + a.claimed)));
}

const snap: Memo<Snapshot> = { at: 0 };
/** Every Splidev coin (with metadata, GitHub profiles and age) and the GitHub accounts they pay. */
export function snapshot(): Promise<Snapshot> {
  return memo(snap, async () => {
    const c = serverConnection();
    const coins = await enrich(c, await listCoins(c));
    const earners = await earnersOf(c, coins).catch(() => []);
    return { at: Date.now(), coins, earners };
  });
}

/** One coin (from the snapshot when it's there, else read directly), or null if it isn't a Splidev coin. */
export async function coinView(mint: string): Promise<CoinView | null> {
  let key: PublicKey;
  try {
    key = new PublicKey(mint);
  } catch {
    return null;
  }
  const listed = (await snapshot().catch(() => null))?.coins.find((x) => x.token === mint);
  if (listed) return listed;
  const c = serverConnection();
  const coin = await readCoin(c, key);
  return coin ? (await enrich(c, [coin]))[0] : null;
}

const tradeMemos = new Map<string, Memo<Trade[]>>();
/** A coin's latest trades, shared by every visitor of its page. */
export function coinTrades(mint: string, graduated: boolean): Promise<Trade[]> {
  let m = tradeMemos.get(mint);
  if (!m) {
    if (tradeMemos.size > 500) tradeMemos.delete(tradeMemos.keys().next().value as string);
    tradeMemos.set(mint, (m = { at: 0 }));
  }
  return memo(m, () => recentTrades(serverConnection(), new PublicKey(mint), graduated, 150));
}
