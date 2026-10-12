// pump.fun as Splitdev uses it: the launch transactions, trades and fee distribution, built with
// pump.fun's own SDK. Splitdev has no program of its own: a coin is a normal pump.fun coin whose
// creator fees are shared, permanently, through pump.fun's fee sharing between Splitdev's treasury
// (first) and pump.fun's GitHub fee accounts of the chosen GitHub users.
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  TransactionInstruction,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { OnlinePumpSdk, PUMP_SDK, Platform, bondingCurvePda, creatorVaultPda, feeSharingConfigPda, getBuyTokenAmountFromSolAmount, getPumpAmmProgram, getSellSolAmountFromTokenAmount, socialFeePda } from "@pump-fun/pump-sdk";
import { OnlinePumpAmmSdk, PUMP_AMM_SDK, buyQuoteInput, canonicalPumpPoolPda, coinCreatorVaultAuthorityPda, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import { LAUNCH_FEE_LAMPORTS, PLATFORM_BPS, SHARES_TOTAL, TREASURY } from "./config";

export { Platform, socialFeePda };
export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const PUMP_FEES_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

/** pump.fun's GitHub fee account for a GitHub user id (where that user's share of every Splitdev coin lands). */
export const githubFeeAccount = (githubId: string) => socialFeePda(githubId, Platform.GitHub);

export type Share = { address: PublicKey; shareBps: number };

/**
 * The permanent shareholder list of a new coin: Splitdev's treasury first (that is how the site finds
 * Splitdev coins), then each GitHub account with its part of the rest. `bps` are the accounts' shares
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

/** Fee-sharing operations may have all nine GitHub recipients. Keep mandatory
 * instructions together, dropping only optional compute/priority budget overhead.
 */
function fitFeeTransaction(payer: PublicKey, blockhash: string, instructions: TransactionInstruction[]): VersionedTransaction | null {
  for (const extra of [budget(400_000), [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })], []]) {
    const tx = compile(payer, blockhash, [...extra, ...instructions]);
    try { if (tx.serialize().length <= TX_BYTES_LIMIT) return tx; } catch { /* over the serialization limit */ }
  }
  return null;
}

/**
 * A launch as transactions to sign together and send in order:
 * 1. pump.fun's create_v2 (the creator is the launching wallet for now) and the first buy;
 * 2+. the fee split (see finishLaunchTransactions).
 * The mint keypair signs the first transaction too.
 */
export async function launchTransactions(c: Connection, input: LaunchInput): Promise<VersionedTransaction[]> {
  if (!TREASURY) throw new Error("Splitdev isn't set up yet.");
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

/** Current pump ABI: curve trades can retain creator fees on the curve itself.
 * This must run in the SAME transaction as creator migration/share updates, so a
 * trade arriving after wallet approval cannot refill the bucket between them.
 * Source: pump-fun/pump-public-docs@2293f9a66c654e9fe82dc5e8f4618538f24bb35f,
 * idl/pump.json, sweep_creator_fee. The installed SDK predates this instruction.
 * SOL only: the quote ATAs are required account addresses but ignored by the program.
 * Pre-split fees go to the original creator's pump vault; this never collects them.
 */
export function sweepCurveCreatorFeeInstruction(payer: PublicKey, mint: PublicKey, creator: PublicKey): TransactionInstruction {
  const curve = bondingCurvePda(mint);
  const recipient = creatorVaultPda(creator);
  const global = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_PROGRAM_ID)[0];
  const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_PROGRAM_ID)[0];
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: global, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: curve, isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(NATIVE_MINT, curve, true), isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(NATIVE_MINT, recipient, true), isSigner: false, isWritable: true },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([32, 246, 191, 52, 8, 201, 73, 186]),
  });
}

/** The matching current AMM instruction moves a pool's creator bucket into its
 * fixed creator-vault ATA before the existing SDK consolidation/distribution.
 * Source: the same official IDL commit, idl/pump_amm.json, sweep_creator_fee.
 */
export function sweepPoolCreatorFeeInstruction(payer: PublicKey, poolKey: PublicKey, pool: { quoteMint: PublicKey; poolQuoteTokenAccount: PublicKey; coinCreator: PublicKey }): TransactionInstruction {
  if (!pool.quoteMint.equals(NATIVE_MINT)) throw new Error("Splitdev fee distribution requires a SOL-quoted pool.");
  const recipient = coinCreatorVaultAuthorityPda(pool.coinCreator);
  return new TransactionInstruction({
    programId: PUMP_AMM_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: PublicKey.findProgramAddressSync([Buffer.from("global_config")], PUMP_AMM_PROGRAM_ID)[0], isSigner: false, isWritable: false },
      { pubkey: poolKey, isSigner: false, isWritable: true },
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: pool.poolQuoteTokenAccount, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(NATIVE_MINT, recipient, true), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_AMM_PROGRAM_ID)[0], isSigner: false, isWritable: false },
      { pubkey: PUMP_AMM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([32, 246, 191, 52, 8, 201, 73, 186]),
  });
}

/**
 * The rest of a launch, once the coin exists: pump.fun GitHub fee accounts for the recipients that
 * don't have one yet, then pump.fun fee sharing set once to Splitdev + the GitHub accounts (after
 * which nobody can change it: pump.fun revokes the admin), with Splitdev's launch fee. Also finishes
 * a launch whose first transaction landed but whose split didn't.
 */
export async function finishLaunchTransactions(c: Connection, user: PublicKey, mint: PublicKey, githubIds: string[], bps: number[]): Promise<VersionedTransaction[]> {
  if (!TREASURY) throw new Error("Splitdev isn't set up yet.");
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
  // Keep each sweep and creator/share update atomic: external buys can refill
  // the curve while a wallet is signing. Large recipient lists need a separate
  // config-creation transaction to remain within Solana's 1,232-byte limit.
  const { blockhash } = await c.getLatestBlockhash("confirmed");
  const sweep = sweepCurveCreatorFeeInstruction(user, mint, cfg ? feeSharingConfigPda(mint) : user);
  const fit = (instructions: TransactionInstruction[]) => fitFeeTransaction(user, blockhash, instructions);
  const combined = fit([sweep, ...(sharing ? [sharing] : []), update, ...fee]);
  if (combined) txs.push(combined);
  else if (sharing) {
    const initialize = fit([sweep, sharing]);
    const finalize = fit([sweepCurveCreatorFeeInstruction(user, mint, feeSharingConfigPda(mint)), update, ...fee]);
    if (!initialize || !finalize) throw new Error("The fee-sharing transaction exceeds Solana's size limit.");
    txs.push(initialize, finalize);
  } else throw new Error("The fee-sharing transaction exceeds Solana's size limit.");
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
 * Moves a coin's accumulated creator fees to its shareholders (Splitdev and the GitHub fee accounts),
 * through pump.fun's permissionless distribution; for a graduated coin it first sweeps the pool's
 * creator fees. Anyone can send it and pays the network fee and any required account rent.
 */
export async function distributeTransaction(c: Connection, payer: PublicKey, mint: PublicKey) {
  const sharingConfigAddress = feeSharingConfigPda(mint);
  const poolAddress = canonicalPumpPoolPda(mint);
  const [configInfo, curveInfo, poolInfo] = await c.getMultipleAccountsInfo([sharingConfigAddress, bondingCurvePda(mint), poolAddress], "confirmed");
  if (!configInfo?.owner.equals(PUMP_FEES_PROGRAM_ID)) throw new Error("The coin's fee-sharing account is unavailable.");
  const sharingConfig = PUMP_SDK.decodeSharingConfig(configInfo);
  if (!sharingConfig.mint.equals(mint)) throw new Error("Fee-sharing mint does not match.");
  if (!curveInfo?.owner.equals(PUMP_PROGRAM_ID)) throw new Error("The coin's bonding curve is unavailable.");
  const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
  if (!curve.creator.equals(sharingConfigAddress) || (curve.quoteMint && !curve.quoteMint.equals(NATIVE_MINT) && !curve.quoteMint.equals(PublicKey.default))) throw new Error("The coin does not have the expected SOL fee-sharing curve.");
  // Always sweep, even if the quoted bucket is empty: another trade can land
  // during approval. Only creator buckets move; protocol fees remain untouched.
  const instructions = [sweepCurveCreatorFeeInstruction(payer, mint, sharingConfigAddress)];
  if (poolInfo) {
    if (!poolInfo.owner.equals(PUMP_AMM_PROGRAM_ID)) throw new Error("The coin's canonical pool has an invalid owner.");
    const pool = PUMP_AMM_SDK.decodePoolNullable(poolInfo);
    if (!pool || !pool.baseMint.equals(mint) || !pool.coinCreator.equals(sharingConfigAddress)) throw new Error("The coin's canonical pool does not match its fee-sharing config.");
    instructions.push(sweepPoolCreatorFeeInstruction(payer, poolAddress, pool));
    // Include consolidation even when the ATA did not exist at the initial read:
    // the preceding sweep creates it idempotently when necessary.
    instructions.push(await getPumpAmmProgram(c).methods.transferCreatorFeesToPump().accountsPartial({
      wsolMint: NATIVE_MINT, tokenProgram: TOKEN_PROGRAM_ID, coinCreator: sharingConfigAddress,
    }).instruction());
  }
  instructions.push(await PUMP_SDK.distributeCreatorFees({ mint, sharingConfig, sharingConfigAddress }));
  const { blockhash } = await c.getLatestBlockhash("confirmed");
  const transaction = fitFeeTransaction(payer, blockhash, instructions);
  if (!transaction) throw new Error("The fee distribution exceeds Solana's transaction size limit.");
  return transaction;
}
