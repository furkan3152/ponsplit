// pump.fun as Splidev uses it: the launch transactions, trades and fee distribution, built with
// pump.fun's own SDK. Splidev has no program of its own: a coin is a normal pump.fun coin whose
// creator fees are shared, permanently, through pump.fun's fee sharing between Splidev's treasury
// (first) and pump.fun's GitHub fee accounts of the chosen GitHub users.
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { OnlinePumpSdk, PUMP_SDK, Platform, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount, socialFeePda } from "@pump-fun/pump-sdk";
import { OnlinePumpAmmSdk, PUMP_AMM_SDK, buyQuoteInput, canonicalPumpPoolPda, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import { LAUNCH_FEE_LAMPORTS, PLATFORM_BPS, SHARES_TOTAL, TREASURY } from "./config";

export { Platform, socialFeePda };
export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const PUMP_FEES_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

/** pump.fun's GitHub fee account for a GitHub user id (where that user's share of every Splidev coin lands). */
export const githubFeeAccount = (githubId: string) => socialFeePda(githubId, Platform.GitHub);

export type Share = { address: PublicKey; shareBps: number };

/**
 * The permanent shareholder list of a new coin: Splidev's treasury first (that is how the site finds
 * Splidev coins), then each GitHub account with its part of the rest. `bps` are the accounts' shares
 * of their part and add up to 10,000; rounding goes to the first account.
 */
export function shareholders(githubIds: string[], bps: number[], treasury: PublicKey = TREASURY!, platformBps = PLATFORM_BPS): Share[] {
  if (!githubIds.length || githubIds.length !== bps.length) throw new Error("Each GitHub account needs a share.");
  if (bps.reduce((a, b) => a + b, 0) !== SHARES_TOTAL) throw new Error("Shares must add up to 100%.");
  const rest = SHARES_TOTAL - platformBps;
  const parts = bps.map((b) => Math.floor((b * rest) / SHARES_TOTAL));
  parts[0] += rest - parts.reduce((a, b) => a + b, 0);
  if (parts.some((p) => p <= 0)) throw new Error("Every share must be above 0%.");
  const list: Share[] = githubIds.map((id, i) => ({ address: githubFeeAccount(id), shareBps: parts[i] }));
  return platformBps > 0 ? [{ address: treasury, shareBps: platformBps }, ...list] : list;
}

export type LaunchInput = {
  user: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  /** The metadata JSON's URL (name, symbol, description, image, links). */
  uri: string;
  githubIds: string[];
  bps: number[];
  /** First buy in lamports, fees included (0 for none). */
  firstBuyLamports: bigint;
};

type PumpGlobal = Awaited<ReturnType<OnlinePumpSdk["fetchGlobal"]>>;
type PumpFeeConfig = Awaited<ReturnType<OnlinePumpSdk["fetchFeeConfig"]>> | null;

/** Tokens (raw) a first buy of `lamports` gets on a brand-new curve. */
export function firstBuyTokens(global: PumpGlobal, feeConfig: PumpFeeConfig, lamports: bigint): bigint {
  const t = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: new BN(lamports.toString()), quoteMint: NATIVE_MINT });
  return BigInt(t.toString());
}

const budget = (units: number) => [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })];

async function v0(c: Connection, payer: PublicKey, ixs: TransactionInstruction[]) {
  const { blockhash } = await c.getLatestBlockhash("confirmed");
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
}

/**
 * A launch as transactions to sign together and send in order:
 * 1. pump.fun's create_v2 (the creator is the launching wallet for now) and the first buy;
 * 2. pump.fun GitHub fee accounts for the recipients that don't have one yet (several if needed);
 * 3. pump.fun fee sharing for the coin, set once to Splidev + the GitHub accounts, after which
 *    nobody can change it (pump.fun revokes the admin), and Splidev's launch fee.
 * The mint keypair signs the first transaction too.
 */
export async function launchTransactions(c: Connection, input: LaunchInput): Promise<VersionedTransaction[]> {
  if (!TREASURY) throw new Error("Splidev isn't set up yet.");
  const { user, mint } = input;
  const shares = shareholders(input.githubIds, input.bps);

  const create: TransactionInstruction[] = [];
  if (input.firstBuyLamports > 0n) {
    const sdk = new OnlinePumpSdk(c);
    const [global, feeConfig] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig().catch(() => null)]);
    const solAmount = new BN(input.firstBuyLamports.toString());
    // pump.fun's buy takes the token amount and a SOL ceiling; on a brand-new curve nobody can trade
    // first, so the quote for the SOL amount is exact.
    const tokens = firstBuyTokens(global, feeConfig, input.firstBuyLamports);
    create.push(
      ...(await PUMP_SDK.createV2AndBuyInstructions({
        global,
        mint,
        name: input.name,
        symbol: input.symbol,
        uri: input.uri,
        creator: user,
        user,
        amount: new BN(tokens.toString()),
        solAmount,
        mayhemMode: false,
      }))
    );
  } else {
    create.push(await PUMP_SDK.createV2Instruction({ mint, name: input.name, symbol: input.symbol, uri: input.uri, creator: user, user, mayhemMode: false }));
  }
  const txs = [await v0(c, user, [...budget(400_000), ...create])];

  // GitHub fee accounts that don't exist yet (pump.fun's distribution pays into existing ones).
  const missing: string[] = [];
  const infos = await c.getMultipleAccountsInfo(input.githubIds.map(githubFeeAccount));
  infos.forEach((info, i) => !info && missing.push(input.githubIds[i]));
  for (let i = 0; i < missing.length; i += 4) {
    const ixs = await Promise.all(missing.slice(i, i + 4).map((id) => PUMP_SDK.createSocialFeePda({ payer: user, userId: id, platform: Platform.GitHub })));
    txs.push(await v0(c, user, [...budget(200_000), ...ixs]));
  }

  const sharing = await PUMP_SDK.createFeeSharingConfig({ creator: user, mint, pool: null });
  const update = await PUMP_SDK.updateFeeSharesV2({
    authority: user,
    mint,
    currentShareholders: [user],
    newShareholders: shares,
    quoteMint: NATIVE_MINT,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
  });
  // Splidev's launch fee rides with the fee sharing (create_v2 with a first buy fills the first transaction).
  const fee = LAUNCH_FEE_LAMPORTS > 0n ? [SystemProgram.transfer({ fromPubkey: user, toPubkey: TREASURY, lamports: LAUNCH_FEE_LAMPORTS })] : [];
  txs.push(await v0(c, user, [...budget(400_000), sharing, update, ...fee]));
  return txs;
}

/** Token decimals of every pump.fun coin. */
export const TOKEN_DECIMALS = 6;

/** pump.fun's pool for a coin that has left the curve. */
export const poolOf = (mint: PublicKey) => canonicalPumpPoolPda(mint);

async function poolSwapState(c: Connection, user: PublicKey, mint: PublicKey) {
  return new OnlinePumpAmmSdk(c).swapSolanaState(poolOf(mint), user);
}

/**
 * A buy: spend `lamports` (fees included) on the curve, or on pump.fun's pool once the coin has
 * graduated, accepting at worst `slippageBps` fewer tokens than quoted now. Returns the
 * transaction and the quoted token amount (raw, 6 decimals).
 */
export async function buyTransaction(c: Connection, user: PublicKey, mint: PublicKey, lamports: bigint, slippageBps = 200) {
  const sdk = new OnlinePumpSdk(c);
  const [global, feeConfig, state] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig().catch(() => null), sdk.fetchBuyState(mint, user, TOKEN_2022_PROGRAM_ID)]);
  const solAmount = new BN(lamports.toString());
  if (state.bondingCurve.complete) {
    const swap = await poolSwapState(c, user, mint);
    const q = buyQuoteInput({
      quote: solAmount,
      slippage: slippageBps / 100,
      baseReserve: swap.poolBaseAmount,
      quoteReserve: swap.poolQuoteAmount,
      globalConfig: swap.globalConfig,
      baseMintAccount: swap.baseMintAccount,
      baseMint: swap.baseMint,
      coinCreator: swap.pool.coinCreator,
      creator: swap.pool.creator,
      feeConfig: swap.feeConfig,
    });
    const ixs = await PUMP_AMM_SDK.buyQuoteInput(swap, solAmount, slippageBps / 100);
    return { tx: await v0(c, user, [...budget(300_000), ...ixs]), tokens: BigInt(q.base.toString()) };
  }
  const tokens = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: state.bondingCurve.tokenTotalSupply, bondingCurve: state.bondingCurve, amount: solAmount, quoteMint: NATIVE_MINT });
  const ixs = await PUMP_SDK.buyInstructions({
    global,
    bondingCurveAccountInfo: state.bondingCurveAccountInfo,
    bondingCurve: state.bondingCurve,
    associatedUserAccountInfo: state.associatedUserAccountInfo,
    mint,
    user,
    amount: tokens,
    solAmount,
    slippage: slippageBps / 100,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  return { tx: await v0(c, user, [...budget(300_000), ...ixs]), tokens: BigInt(tokens.toString()) };
}

/** A sell of `tokens` (raw) on the curve or the pool, accepting at worst `slippageBps` less SOL than quoted now. */
export async function sellTransaction(c: Connection, user: PublicKey, mint: PublicKey, tokens: bigint, slippageBps = 200) {
  const sdk = new OnlinePumpSdk(c);
  const [global, feeConfig, state] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig().catch(() => null), sdk.fetchSellState(mint, user, TOKEN_2022_PROGRAM_ID)]);
  const amount = new BN(tokens.toString());
  if (state.bondingCurve.complete) {
    const swap = await poolSwapState(c, user, mint);
    const q = sellBaseInput({
      base: amount,
      slippage: slippageBps / 100,
      baseReserve: swap.poolBaseAmount,
      quoteReserve: swap.poolQuoteAmount,
      globalConfig: swap.globalConfig,
      baseMintAccount: swap.baseMintAccount,
      baseMint: swap.baseMint,
      coinCreator: swap.pool.coinCreator,
      creator: swap.pool.creator,
      feeConfig: swap.feeConfig,
    });
    const ixs = await PUMP_AMM_SDK.sellBaseInput(swap, amount, slippageBps / 100);
    return { tx: await v0(c, user, [...budget(300_000), ...ixs]), lamports: BigInt(q.uiQuote.toString()) };
  }
  const sol = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: state.bondingCurve.tokenTotalSupply, bondingCurve: state.bondingCurve, amount });
  const ixs = await PUMP_SDK.sellInstructions({
    global,
    bondingCurveAccountInfo: state.bondingCurveAccountInfo,
    bondingCurve: state.bondingCurve,
    mint,
    user,
    amount,
    solAmount: sol,
    slippage: slippageBps / 100,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    mayhemMode: state.bondingCurve.isMayhemMode,
  });
  return { tx: await v0(c, user, [...budget(300_000), ...ixs]), lamports: BigInt(sol.toString()) };
}

/**
 * Moves a coin's accumulated creator fees to its shareholders (Splidev and the GitHub fee accounts),
 * through pump.fun's permissionless distribution; for a graduated coin it first sweeps the pool's
 * creator fees. Anyone can send it and pays only the network fee.
 */
export async function distributeTransaction(c: Connection, payer: PublicKey, mint: PublicKey) {
  const { instructions } = await new OnlinePumpSdk(c).buildDistributeCreatorFeesInstructions(mint, { payer });
  return v0(c, payer, [...budget(400_000), ...instructions]);
}
