import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import type { Coin, LaunchView, Phase, Recipient } from "./types";

/**
 * Pons v2 arithmetic, reproduced from its docs ("Getting a quote") and the verified curve, in the
 * curve's own integer order so a quote matches what the trade settles at.
 */
export const BPS = 10_000n;
/** Pons launch config 0 mints a fixed 1B supply (18 decimals). */
export const TOTAL_SUPPLY = 1_000_000_000;
/** Pons's standard trade fee: 1%, of which 30% goes to Pons and 70% to the creator. */
export const PONS_FEE_BPS = 100;
export const PONS_PROTOCOL_SHARE_BPS = 3_000;

const PHASES: Phase[] = ["curve", "graduating", "pool", "rescued"];
const Q96 = 2 ** 96;

const eth = (wei: bigint) => Number(wei) / 1e18;

/** ETH per whole token on the curve (the marginal price; both reserves have 18 decimals). */
export function curvePrice(quoteReserve: bigint, tokenReserve: bigint): number {
  return tokenReserve === 0n ? 0 : Number(quoteReserve) / Number(tokenReserve);
}

/** ETH per whole token in a Pons pool, whose currency0 is always native ETH. */
export function poolPrice(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 === 0n) return 0;
  const tokensPerEth = (Number(sqrtPriceX96) / Q96) ** 2;
  return tokensPerEth === 0 ? 0 : 1 / tokensPerEth;
}

/** Pons's v4 pool id for an ETH-paired coin (fee 0, tick spacing 200, the Pons hook). */
export function ponsPoolId(token: Address, hook: Address, tickSpacing = 200, fee = 0): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      ["0x0000000000000000000000000000000000000000", token, fee, tickSpacing, hook]
    )
  );
}

export function toCoin(v: LaunchView): Coin {
  const l = v.launch;
  const phase = PHASES[v.phase] ?? "curve";
  const price =
    phase === "pool"
      ? poolPrice(v.sqrtPriceX96)
      : phase === "curve"
        ? curvePrice(v.quoteReserve, v.tokenReserve)
        : // Graduating or rescued: the price the curve closed at, which is where the pool opens.
          curvePrice(v.phantomQuote + v.threshold, v.reservedTokens);
  const progress = phase === "curve" ? (v.threshold === 0n ? 0 : Math.min(100, (eth(v.raised) / eth(v.threshold)) * 100)) : 100;
  const recipients: Recipient[] = v.xIds.map((xId, i) => ({ xId, handle: v.handles[i] ?? "", bps: Number(v.bps[i] ?? 0) }));
  return {
    token: l.token,
    curve: l.curve,
    splitter: l.splitter,
    creator: l.creator,
    poolId: l.poolId,
    createdAt: Number(l.createdAt),
    createdBlock: l.createdBlock,
    name: v.name,
    symbol: v.symbol,
    logo: v.logo,
    creatorTaxBps: Number(l.creatorTaxBps),
    platformBps: Number(l.platformBps),
    phase,
    graduated: phase !== "curve",
    feeRecipient: v.feeRecipient,
    feesMoved: v.feeRecipient.toLowerCase() !== l.splitter.toLowerCase(),
    quoteReserve: v.quoteReserve,
    tokenReserve: v.tokenReserve,
    raised: v.raised,
    threshold: v.threshold,
    sellable: v.sellable,
    phantomQuote: v.phantomQuote,
    reservedTokens: v.reservedTokens,
    sqrtPriceX96: v.sqrtPriceX96,
    liquidity: v.liquidity,
    price,
    marketCap: price * TOTAL_SUPPLY,
    progress,
    feesSplit: v.feesSplit,
    feesPending: v.feesPending,
    accountsEarned: v.feesSplit + toRecipients(v.feesPending, Number(l.platformBps)),
    platformPending: v.feesPending - toRecipients(v.feesPending, Number(l.platformBps)),
    recipients,
    handles: [...v.handles],
    xIds: [...v.xIds],
  };
}

/** The part of a payout that reaches the X accounts (SplitEarn keeps `platformBps` of it). */
export const toRecipients = (amount: bigint, platformBps: number) => amount - (amount * BigInt(platformBps)) / BPS;

// ------------------------------------------------------------------ quotes

const amountOut = (a: bigint, rIn: bigint, rOut: bigint) => (a * rOut) / (rIn + a);
const amountIn = (o: bigint, rIn: bigint, rOut: bigint) => (o * rIn) / (rOut - o) + 1n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export type CurveTerms = {
  quoteReserve: bigint;
  tokenReserve: bigint;
  sellable: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
  /** The buyer's current opening snipe tax (0 once the first seconds are over, or if exempt). */
  snipeBps?: bigint;
};

/** Pons curve buy: tokens out, what the curve actually takes, and what it refunds. */
export function quoteCurveBuy(t: CurveTerms, quoteIn: bigint): { tokensOut: bigint; spent: bigint; refund: bigint } {
  if (quoteIn <= 0n || t.tokenReserve === 0n) return { tokensOut: 0n, spent: 0n, refund: quoteIn };
  let snipe = t.snipeBps ?? 0n;
  const cap = BPS - t.feeBps - t.creatorTaxBps - 100n;
  if (snipe > 0n && snipe > cap) snipe = cap;
  let spent = quoteIn;
  const fee = (spent * t.feeBps) / BPS;
  const tax = (spent * t.creatorTaxBps) / BPS;
  const snipeTax = (spent * snipe) / BPS;
  let tokensOut = amountOut(spent - fee - tax - snipeTax, t.quoteReserve, t.tokenReserve);
  if (tokensOut > t.sellable) {
    tokensOut = t.sellable;
    if (t.sellable === 0n) return { tokensOut: 0n, spent: 0n, refund: quoteIn };
    const grossed = ceilDiv(amountIn(t.sellable, t.quoteReserve, t.tokenReserve) * BPS, BPS - t.feeBps - t.creatorTaxBps - snipe);
    spent = grossed < quoteIn ? grossed : quoteIn;
  }
  return { tokensOut, spent, refund: quoteIn - spent };
}

/** Pons curve sell: ETH out after the fee and creator tax. */
export function quoteCurveSell(t: CurveTerms, tokensIn: bigint): bigint {
  if (tokensIn <= 0n || t.quoteReserve === 0n) return 0n;
  const gross = amountOut(tokensIn, t.tokenReserve, t.quoteReserve);
  return gross - (gross * t.feeBps) / BPS - (gross * t.creatorTaxBps) / BPS;
}

/**
 * The minimum a buy accepts. Pons checks a clamped (partial) buy against the price, not the
 * quantity, so this stays right when the last buy of a curve is only partly filled.
 */
export const minOut = (amount: bigint, slippageBps: number) => (amount * BigInt(10_000 - slippageBps)) / 10_000n;

/** The opening snipe tax for a non-exempt buyer, `elapsed` seconds after launch (Pons's decay). */
export function snipeTaxBps(startBps: bigint, windowSeconds: bigint, elapsed: bigint): bigint {
  if (startBps === 0n || elapsed >= windowSeconds) return 0n;
  return startBps >> ((elapsed * 14n) / windowSeconds);
}
