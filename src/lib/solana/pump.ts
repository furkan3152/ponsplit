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
import { OnlinePumpSdk, PUMP_SDK, Platform, feeSharingConfigPda, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount, socialFeePda } from "@pump-fun/pump-sdk";
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
  return compile(payer, blockhash, ixs);
}

const compile = (payer: PublicKey, blockhash: string, ixs: TransactionInstruction[]) =>
  new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());

/** Solana's limit for a serialized transaction, signatures included. */
export const TX_BYTES_LIMIT = 1232;

/**
 * A launch as transactions to sign together and send in order:
 * 1. pump.fun's create_v2 (the creator is the launching wallet for now) and the first buy;
 * 2+. the fee split (see finishLaunchTransactions).
 * The mint keypair signs the first transaction too.
 */
export async function launchTransactions(c: Connection, input: LaunchInput): Promise<VersionedTransaction[]> {
  if (!TREASURY) throw new Error("Splidev isn't set up yet.");
  shareholders(input.githubIds, input.bps); // fail before anything is sent
  return [await createTransaction(c, input), ...(await finishLaunchTransactions(c, input.user, input.mint, input.githubIds, input.bps))];
}

/** pump.fun's create_v2 for the coin, with the creator's first buy in the same transaction. */
export async function createTransaction(c: Connection, input: LaunchInput): Promise<VersionedTransaction> {
  const { user, mint } = input;
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
  // create_v2 + the first buy touch ~26 accounts, so a long name or metadata link can push the
  // transaction past Solana's size limit. The compute budget instructions give way first (the
  // priority fee, then everything): the coin still launches, just without priority.
  const { blockhash } = await c.getLatestBlockhash("confirmed");
  const price = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
  for (const extra of [budget(400_000), [price], []]) {
    const tx = compile(user, blockhash, [...extra, ...create]);
    if (tx.serialize().length <= TX_BYTES_LIMIT) return tx;
  }
  throw new Error("The coin's name, ticker and details don't fit in one Solana transaction. Shorten the name or ticker.");
}

/**
 * The rest of a launch, once the coin exists: pump.fun GitHub fee accounts for the recipients that
 * don't have one yet, then pump.fun fee sharing set once to Splidev + the GitHub accounts (after
 * which nobody can change it: pump.fun revokes the admin), with Splidev's launch fee. Also finishes
 * a launch whose first transaction landed but whose split didn't.
 */
export async function finishLaunchTransactions(c: Connection, user: PublicKey, mint: PublicKey, githubIds: string[], bps: number[]): Promise<VersionedTransaction[]> {
  if (!TREASURY) throw new Error("Splidev isn't set up yet.");
  const shares = shareholders(githubIds, bps);
  // A split already on chain: final means there is nothing left to do; a config that exists but
  // isn't final yet is updated instead of created again (creating it twice fails).
  const cfgInfo = await c.getAccountInfo(feeSharingConfigPda(mint), "confirmed");
  const cfg = cfgInfo ? PUMP_SDK.decodeSharingConfig(cfgInfo) : null;
  if (cfg?.adminRevoked) return [];
  const txs: VersionedTransaction[] = [];
  // GitHub fee accounts that don't exist yet (pump.fun's distribution pays into existing ones).
  const missing: string[] = [];
  const infos = await c.getMultipleAccountsInfo(githubIds.map(githubFeeAccount));
  infos.forEach((info, i) => !info && missing.push(githubIds[i]));
  for (let i = 0; i < missing.length; i += 4) {
    const ixs = await Promise.all(missing.slice(i, i + 4).map((id) => PUMP_SDK.createSocialFeePda({ payer: user, userId: id, platform: Platform.GitHub })));
    txs.push(await v0(c, user, [...budget(200_000), ...ixs]));
  }
  const sharing = cfg ? null : await PUMP_SDK.createFeeSharingConfig({ creator: user, mint, pool: null });
  const update = await PUMP_SDK.updateFeeSharesV2({
    authority: user,
    mint,
    currentShareholders: cfg ? cfg.shareholders.map((h: { address: PublicKey }) => h.address) : [user],
    newShareholders: shares,
    quoteMint: NATIVE_MINT,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
  });
  const fee = LAUNCH_FEE_LAMPORTS > 0n ? [SystemProgram.transfer({ fromPubkey: user, toPubkey: TREASURY, lamports: LAUNCH_FEE_LAMPORTS })] : [];
  txs.push(await v0(c, user, [...budget(400_000), ...(sharing ? [sharing] : []), update, ...fee]));
  return txs;
}

/**
 * Where a launch stands on chain: "missing" (the coin doesn't exist, yet or ever), "needs-split"
 * (the coin exists, its fee split isn't final), or "done".
 */
export async function launchState(c: Connection, mint: PublicKey): Promise<"missing" | "needs-split" | "done"> {
  const [mintInfo, cfgInfo] = await c.getMultipleAccountsInfo([mint, feeSharingConfigPda(mint)], "confirmed");
  if (!mintInfo) return "missing";
  if (cfgInfo && PUMP_SDK.decodeSharingConfig(cfgInfo).adminRevoked) return "done";
  return "needs-split";
}

/** pump.fun's starting curve (from its global config), for previews before a coin exists. */
export function newCurvePreview(global: PumpGlobal, tokensBought: bigint) {
  const vt0 = BigInt(global.initialVirtualTokenReserves.toString());
  const vs0 = BigInt(global.initialVirtualSolReserves.toString());
  const real0 = BigInt(global.initialRealTokenReserves.toString());
  const vt1 = vt0 - tokensBought;
  const vs1 = vt1 > 0n ? (vt0 * vs0) / vt1 : vs0;
  const price = vt1 > 0n ? Number(vs1) / 1e9 / (Number(vt1) / 1e6) : 0;
  return {
    price,
    marketCap: price * 1e9,
    progress: real0 > 0n ? Math.min(100, (Number(tokensBought) / Number(real0)) * 100) : 0,
    supplyShare: (Number(tokensBought) / 1e15) * 100,
  };
}

/** Token decimals of every pump.fun coin. */
export const TOKEN_DECIMALS = 6;

/** pump.fun's pool for a coin that has left the curve. */
export const poolOf = (mint: PublicKey) => canonicalPumpPoolPda(mint);

async function poolSwapState(c: Connection, user: PublicKey, mint: PublicKey) {
  return new OnlinePumpAmmSdk(c).swapSolanaState(poolOf(mint), user);
}

/** The pool's pricing inputs, exactly as pump.fun's SDK passes them when it builds the swap. */
function poolTerms(swap: Awaited<ReturnType<typeof poolSwapState>>) {
  const { pool } = swap;
  return {
    virtualQuoteReserves: pool.virtualQuoteReserves,
    coinCreator: pool.coinCreator,
    creator: pool.creator,
    feeConfig: swap.feeConfig,
    quoteMint: pool.quoteMint,
    isMayhemMode: pool.isMayhemMode,
    creatorFeeBps: pool.creatorFeeBps,
  };
}

/** What a buy of `lamports` (fees included) gets now, in raw tokens, on the curve or the pool. */
export async function quoteBuy(c: Connection, mint: PublicKey, lamports: bigint): Promise<bigint> {
  const sdk = new OnlinePumpSdk(c);
  const solAmount = new BN(lamports.toString());
  const [global, feeConfig, curve] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig().catch(() => null), sdk.fetchBondingCurve(mint)]);
  if (curve.complete) {
    const swap = await poolSwapState(c, PublicKey.default, mint);
    const q = buyQuoteInput({ quote: solAmount, slippage: 0, baseReserve: swap.poolBaseAmount, quoteReserve: swap.poolQuoteAmount, globalConfig: swap.globalConfig, baseMintAccount: swap.baseMintAccount, baseMint: swap.baseMint, ...poolTerms(swap) });
    return BigInt(q.base.toString());
  }
  return BigInt(getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: curve.tokenTotalSupply, bondingCurve: curve, amount: solAmount, quoteMint: NATIVE_MINT }).toString());
}

/** What a sell of `tokens` (raw) gets now, in lamports after fees, on the curve or the pool. */
export async function quoteSell(c: Connection, mint: PublicKey, tokens: bigint): Promise<bigint> {
  const sdk = new OnlinePumpSdk(c);
  const amount = new BN(tokens.toString());
  const [global, feeConfig, curve] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig().catch(() => null), sdk.fetchBondingCurve(mint)]);
  if (curve.complete) {
    const swap = await poolSwapState(c, PublicKey.default, mint);
    const q = sellBaseInput({ base: amount, slippage: 0, baseReserve: swap.poolBaseAmount, quoteReserve: swap.poolQuoteAmount, globalConfig: swap.globalConfig, baseMintAccount: swap.baseMintAccount, baseMint: swap.baseMint, ...poolTerms(swap) });
    return BigInt(q.uiQuote.toString());
  }
  return BigInt(getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: curve.tokenTotalSupply, bondingCurve: curve, amount }).toString());
}

/**
 * A buy on the curve, or on pump.fun's pool once the coin has graduated: the tokens `lamports`
 * (fees included) buy right now, for at most `lamports` plus `slippageBps` (pump.fun's buys are
 * "this many tokens, SOL capped"; the trade panel shows that cap). Returns the transaction and the
 * token amount (raw, 6 decimals).
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
      ...poolTerms(swap),
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
      ...poolTerms(swap),
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
