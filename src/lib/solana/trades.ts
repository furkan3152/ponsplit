// A coin's trades, read from the chain: pump.fun records every trade as an Anchor event
// (an inner self-call whose data is the event tag, the event's discriminator, then the event).
import { PublicKey, type Connection, type VersionedTransactionResponse } from "@solana/web3.js";
import { PUMP_SDK, bondingCurvePda } from "@pump-fun/pump-sdk";
import { canonicalPumpPoolPda } from "@pump-fun/pump-swap-sdk";
import bs58 from "bs58";

export type Trade = {
  signature: string;
  slot: number;
  /** Unix seconds. */
  timestamp: number;
  kind: "buy" | "sell";
  venue: "curve" | "pool";
  trader: string;
  /** SOL in or out, lamports. */
  sol: bigint;
  /** Tokens in or out, raw (6 decimals). */
  tokens: bigint;
  /** SOL per whole token this trade paid or received (fees included). */
  price: number;
  /** The coin's creator fee from this trade, lamports. */
  creatorFee: bigint;
};

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

/** Anchor's event-CPI tag (sha256("anchor:event")[0..8], little endian). */
const EVENT_TAG = "e445a52e51cb9a1d";
// sha256("event:<Name>")[0..8]
const TRADE_EVENT = "bddb7fd34ee661ee";
const AMM_BUY_EVENT = "67f4521f2cf57777";
const AMM_SELL_EVENT = "3e2f370aa503dc2a";
// PublicNode permits only one getTransaction per JSON-RPC request. Use bounded
// individual reads rather than a batch the provider rejects outright.
// Poll signatures each refresh, but reuse confirmed transaction bodies instead
// of requesting the same history every five seconds. Failed/null reads retry.
const CONCURRENT_TRANSACTION_READS = 4;
const TRANSACTION_CACHE_LIMIT = 1_000;
const transactionCaches = new WeakMap<Connection, Map<string, VersionedTransactionResponse>>();

const n = (v: { toString(): string } | undefined) => BigInt(v?.toString() ?? "0");
/** SOL per whole token paid or received in a trade. */
const execPrice = (lamports: bigint, raw: bigint) => (raw > 0n ? Number(lamports) / 1e9 / (Number(raw) / 1e6) : 0);

/** The trades of `mint` in one transaction (several when a transaction trades more than once). */
export function tradesIn(tx: VersionedTransactionResponse, mint: string): Trade[] {
  if (!tx.meta || tx.meta.err) return [];
  const out: Trade[] = [];
  const signature = tx.transaction.signatures[0];
  // Only events pump.fun's own programs emitted count: any program can emit bytes that look like a
  // trade event, so the inner instruction must run in pump (curve) or pump AMM (pool), and a pool
  // event must be this coin's pool (a swap route can touch several pools in one transaction).
  let keys: { get(i: number): PublicKey | undefined };
  try {
    keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses ?? undefined });
  } catch {
    return [];
  }
  const pool = canonicalPumpPoolPda(new PublicKey(mint)).toBase58();
  for (const group of tx.meta.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      const program = keys.get(ix.programIdIndex)?.toBase58();
      if (program !== PUMP_PROGRAM && program !== PUMP_AMM_PROGRAM) continue;
      let data: Buffer;
      try {
        data = Buffer.from(bs58.decode(ix.data));
      } catch {
        continue;
      }
      if (data.length < 16 || data.subarray(0, 8).toString("hex") !== EVENT_TAG) continue;
      const disc = data.subarray(8, 16).toString("hex");
      try {
        if (disc === TRADE_EVENT && program === PUMP_PROGRAM) {
          const e = PUMP_SDK.decodeTradeEventBc(data.subarray(16));
          if (e.mint.toBase58() !== mint) continue;
          // What the trader paid or got: the event's amount is before pump.fun's and the creator's fees.
          const fees = n(e.fee) + n(e.creatorFee);
          const sol = e.isBuy ? n(e.solAmount) + fees : n(e.solAmount) - fees;
          out.push({
            signature,
            slot: tx.slot,
            timestamp: Number(n(e.timestamp)),
            kind: e.isBuy ? "buy" : "sell",
            venue: "curve",
            trader: e.user.toBase58(),
            sol,
            tokens: n(e.tokenAmount),
            price: execPrice(sol, n(e.tokenAmount)),
            creatorFee: n(e.creatorFee),
          });
        } else if ((disc === AMM_BUY_EVENT || disc === AMM_SELL_EVENT) && program === PUMP_AMM_PROGRAM) {
          const buy = disc === AMM_BUY_EVENT;
          const e = buy ? PUMP_SDK.decodeBuyEventAmm(data.subarray(16)) : PUMP_SDK.decodeSellEventAmm(data.subarray(16));
          const ev = e as unknown as Record<string, { toString(): string; toBase58?: () => string }>;
          if (ev.pool?.toBase58?.() !== pool) continue;
          const base = n(buy ? ev.baseAmountOut : ev.baseAmountIn);
          // the trader's side, fees included
          const quote = n(buy ? ev.userQuoteAmountIn ?? ev.quoteAmountIn : ev.userQuoteAmountOut ?? ev.quoteAmountOut);
          out.push({
            signature,
            slot: tx.slot,
            timestamp: Number(n(ev.timestamp)),
            kind: buy ? "buy" : "sell",
            venue: "pool",
            trader: ev.user?.toBase58?.() ?? "",
            sol: quote,
            tokens: base,
            price: execPrice(quote, base),
            creatorFee: n(ev.coinCreatorFee),
          });
        }
      } catch {
        // an event of another shape: not a trade we can read
      }
    }
  }
  return out;
}

/**
 * The latest trades of a coin, newest first: transactions touching its curve (and its pool once
 * graduated), `limit` per venue. Pool trades are filtered to this coin by their pool account.
 */
export async function recentTrades(c: Connection, mint: PublicKey, graduated: boolean, limit = 100): Promise<Trade[]> {
  const venues = [bondingCurvePda(mint), ...(graduated ? [canonicalPumpPoolPda(mint)] : [])];
  const sigs = (await Promise.all(venues.map((v) => c.getSignaturesForAddress(v, { limit }, "confirmed")))).flat().filter((s) => !s.err);
  const unique = Array.from(new Set(sigs.map((s) => s.signature)));
  let cache = transactionCaches.get(c);
  if (!cache) {
    cache = new Map();
    transactionCaches.set(c, cache);
  }
  const txs = unique.flatMap(signature => {
    const tx = cache.get(signature);
    return tx ? [tx] : [];
  });
  const missing = unique.filter(signature => !cache.has(signature));
  for (let i = 0; i < missing.length; i += CONCURRENT_TRANSACTION_READS) {
    // web3.js 1.99 supports MessageV1. Modern bot trades may be v1: asking
    // for max version 0 rejects the entire batch, including older valid trades.
    const fetched = await Promise.allSettled(missing.slice(i, i + CONCURRENT_TRANSACTION_READS).map(async requestedSignature => {
      const tx = await c.getTransaction(requestedSignature, { maxSupportedTransactionVersion: 1, commitment: "confirmed" });
      if (!tx) return;
      // Preserve successful reads even if a sibling request fails and the
      // caller retries or falls back to another public RPC.
      const signature = tx.transaction.signatures[0];
      cache!.delete(signature);
      cache!.set(signature, tx);
      if (cache!.size > TRANSACTION_CACHE_LIMIT) cache!.delete(cache!.keys().next().value!);
      return tx;
    }));
    for (const result of fetched) if (result.status === "fulfilled" && result.value) txs.push(result.value);
    const failed = fetched.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }
  const key = mint.toBase58();
  return txs
    .flatMap((tx) => (tx ? tradesIn(tx, key) : []))
    .sort((a, b) => b.slot - a.slot || b.timestamp - a.timestamp);
}
