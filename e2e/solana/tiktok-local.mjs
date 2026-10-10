// Uses the actual pump.fun programs plus the compiled Tiksplit escrow on a local validator.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Connection, Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";

const verifier = Keypair.generate();
const treasury = Keypair.generate();
const launcher = Keypair.generate();
const beneficiary = Keypair.generate();
const attacker = Keypair.generate();
const mint = Keypair.generate();
if (!process.env.NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID) throw new Error("Set NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID to the program loaded into the local validator.");
process.env.NEXT_PUBLIC_TIKSPLIT_VERIFIER = verifier.publicKey.toBase58();
process.env.NEXT_PUBLIC_SPLIDEV_TREASURY = treasury.publicKey.toBase58();
process.env.NEXT_PUBLIC_TIKSPLIT_ADMIN_WALLET = treasury.publicKey.toBase58();
const require = createRequire(import.meta.url);
const { OnlinePumpSdk, PUMP_SDK, creatorVaultPda, feeSharingConfigPda, bondingCurvePda, PUMP_PROGRAM_ID, PUMP_FEE_CONFIG_PDA } = require("@pump-fun/pump-sdk");
const { canonicalPumpPoolPda, coinCreatorVaultAtaPda, coinCreatorVaultAuthorityPda } = require("@pump-fun/pump-swap-sdk");
const lib = require("./.build/lib.cjs");
const c = new Connection(process.env.RPC || "http://127.0.0.1:8899", "confirmed");
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(c.rpcEndpoint).hostname)) throw new Error("Disposable test keys require a local validator.");
const handle = "creator.local";
const uri = "https://example.com/tiktok-local.json";

async function send(tx, keys) {
  tx.sign(keys);
  const signature = await c.sendRawTransaction(tx.serialize());
  const result = await c.confirmTransaction(signature, "confirmed");
  assert.equal(result.value.err, null);
  return signature;
}
async function transaction(instructions) {
  const { blockhash } = await c.getLatestBlockhash("confirmed");
  return new VersionedTransaction(new TransactionMessage({ payerKey: beneficiary.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message());
}
// Outside bots now use buy_exact_quote_in_v3, which holds creator fees on the
// curve. The application's legacy SDK buy still pays the creator vault directly.
// Reproduce the actual external trade ABI, not a synthetic edited account.
// Source: pump-public-docs commit 2293f9a66c654e9fe82dc5e8f4618538f24bb35f, idl/pump.json.
async function externalCurveBuy(user, targetMint, quoteIn) {
  const global = await new OnlinePumpSdk(c).fetchGlobal();
  const curve = bondingCurvePda(targetMint);
  const pda = (seed, key) => PublicKey.findProgramAddressSync([Buffer.from(seed), ...(key ? [key.toBuffer()] : [])], PUMP_PROGRAM_ID)[0];
  const baseAta = getAssociatedTokenAddressSync(targetMint, user, true, TOKEN_2022_PROGRAM_ID);
  const quoteAta = owner => getAssociatedTokenAddressSync(NATIVE_MINT, owner, true);
  const data = Buffer.alloc(25);
  Buffer.from([225, 247, 80, 30, 213, 179, 132, 136]).copy(data);
  data.writeBigUInt64LE(quoteIn, 8);
  data.writeBigUInt64LE(1n, 16);
  const accounts = [
    [pda("global"), false], [targetMint, false], [NATIVE_MINT, false],
    [TOKEN_2022_PROGRAM_ID, false], [TOKEN_PROGRAM_ID, false], [curve, true],
    [getAssociatedTokenAddressSync(targetMint, curve, true, TOKEN_2022_PROGRAM_ID), true],
    [quoteAta(curve), true], [user, true, true], [baseAta, true], [quoteAta(user), true],
    [pda("user_volume_accumulator", user), true], [PUMP_FEE_CONFIG_PDA, false],
    [global.buybackFeeRecipients[0], true], [SystemProgram.programId, false],
    [pda("__event_authority"), false], [PUMP_PROGRAM_ID, false],
  ];
  const buy = new TransactionInstruction({ programId: PUMP_PROGRAM_ID, data, keys: accounts.map(([pubkey, isWritable, isSigner = false]) => ({ pubkey, isWritable, isSigner })) });
  const { blockhash } = await c.getLatestBlockhash("confirmed");
  return new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    createAssociatedTokenAccountIdempotentInstruction(user, baseAta, user, targetMint, TOKEN_2022_PROGRAM_ID), buy,
  ] }).compileToV0Message());
}
// Same current public IDL, pump_amm.json buy_v2. Reuse the SDK's quote and WSOL
// setup/cleanup, replacing only its legacy buy with the modern pool bucket ABI.
async function externalPoolBuy(user, targetMint, quoteIn) {
  const quoted = await lib.buyTransaction(c, user, targetMint, quoteIn);
  const message = TransactionMessage.decompile(quoted.tx.message);
  let replaced = 0;
  message.instructions = message.instructions.flatMap(ix => {
    if (!ix.programId.equals(lib.PUMP_AMM_PROGRAM_ID) || !ix.data.subarray(0, 8).equals(Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]))) return [ix];
    replaced++;
    const keys = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 20, 21].map(index => ix.keys[index]);
    // AMM v2 takes the buyback quote token account (the legacy builder's last
    // remaining account); curve v3 instead takes the native-SOL recipient.
    keys.push(ix.keys.at(-1), ix.keys[15], ix.keys[16]);
    return [
      // Mainnet may already have this ATA, while the minimal local fixtures do
      // not include every randomly selected SDK fee recipient's token account.
      createAssociatedTokenAccountIdempotentInstruction(user, ix.keys.at(-1).pubkey, ix.keys.at(-2).pubkey, NATIVE_MINT),
      new TransactionInstruction({ programId: ix.programId, keys, data: Buffer.concat([Buffer.from([184, 23, 238, 97, 103, 197, 211, 61]), ix.data.subarray(8, 24)]) }),
    ];
  });
  assert.equal(replaced, 1, "modern external pool trade replaces exactly one SDK buy");
  return { tx: new VersionedTransaction(message.compileToV0Message()), tokens: quoted.tokens };
}
for (const key of [launcher, beneficiary, attacker, treasury]) {
  const sig = await c.requestAirdrop(key.publicKey, 50_000_000_000);
  await c.confirmTransaction(sig, "confirmed");
}

// Preflight before minting and safe completion after minting use the same builder.
await assert.rejects(() => lib.finishTikTokLaunchTransactions(c, launcher.publicKey, mint.publicKey, handle, 500), /20%/);
await lib.finishTikTokLaunchTransactions(c, launcher.publicKey, mint.publicKey, handle, 0);
const create = await lib.createTikTokTransaction(c, { user: launcher.publicKey, mint: mint.publicKey, name: "Tiksplit Local", symbol: "TIK", uri, firstBuyLamports: 100_000_000n });
await send(create, [launcher, mint]);
// Even a stale JS caller passing an inline-buy amount cannot bypass the locked split.
assert.equal(await c.getBalance(creatorVaultPda(launcher.publicKey)), 0, "TikTok minting must not route an inline buy's creator fee to the launcher");
assert.equal(await lib.tikTokLaunchState(c, mint.publicKey, { handle, launcher: launcher.publicKey, launcherBps: 0, metadataUri: uri }), "needs-split");
assert.ok(!(await lib.listCoins(c)).some(x => x.token === mint.publicKey.toBase58()), "unfinished mints are not listed before their fee split is locked");

// Real incident: an outside trader buys after minting but before the fee split is locked.
// Initialize escrow first, matching the interrupted production launch, then let that buy land.
const initialFinish = await lib.finishTikTokLaunchTransactions(c, launcher.publicKey, mint.publicKey, handle, 0);
assert.equal(initialFinish.length, 2, "new creator needs vault initialization and one finalization transaction");
await send(initialFinish[0], [launcher]);
await send(await externalCurveBuy(attacker.publicKey, mint.publicKey, 1_000_000_000n), [attacker]);
const earlyTrades = await lib.recentTrades(c, mint.publicKey, false);
const earlyCreatorFees = earlyTrades.reduce((sum, trade) => sum + trade.creatorFee, 0n);
assert.ok(earlyCreatorFees > 0n, "the external buy produces real creator fees before finalization");
const originalCreatorVault = creatorVaultPda(launcher.publicKey);
const originalVaultBefore = BigInt(await c.getBalance(originalCreatorVault));
assert.equal(originalVaultBefore, 0n, "modern external buys hold fees on the curve until swept");
assert.equal((await c.getAccountInfo(bondingCurvePda(mint.publicKey))).data.readBigUInt64LE(125), earlyCreatorFees);
const treasuryBeforeLock = BigInt(await c.getBalance(treasury.publicKey));
const escrowBeforeLock = BigInt(await c.getBalance(lib.creatorVault(handle)));

// Prove the previous unswept sequence fails against the actual pump program, without
// broadcasting the known failing transaction or paying a failed-transaction fee.
const { blockhash: unsweptHash } = await c.getLatestBlockhash("confirmed");
const unswept = new VersionedTransaction(new TransactionMessage({
  payerKey: launcher.publicKey,
  recentBlockhash: unsweptHash,
  instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    await PUMP_SDK.createFeeSharingConfig({ creator: launcher.publicKey, mint: mint.publicKey, pool: null }),
    await PUMP_SDK.updateFeeSharesV2({ authority: launcher.publicKey, mint: mint.publicKey, currentShareholders: [launcher.publicKey], newShareholders: lib.tikTokShareholders(handle, launcher.publicKey, 0), quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID }),
  ],
}).compileToV0Message());
const rejectedUnswept = await c.simulateTransaction(unswept, { sigVerify: false, replaceRecentBlockhash: true });
assert.match(JSON.stringify(rejectedUnswept.value.err), /6095/, "old finalization reproduces CreatorFeesNotSwept (6095)");
assert.match(rejectedUnswept.value.logs.join("\n"), /CreatorFeesNotSwept/);
assert.equal(await c.getAccountInfo(feeSharingConfigPda(mint.publicKey)), null, "failed simulation cannot create a sharing config");
console.log("PASS: external buy before split reproduces CreatorFeesNotSwept6095 without submitting a failed transaction", { earlyCreatorFees: earlyCreatorFees.toString() });

for (const tx of await lib.finishTikTokLaunchTransactions(c, launcher.publicKey, mint.publicKey, handle, 0)) await send(tx, [launcher]);
const creatorVaultRent = BigInt(await c.getMinimumBalanceForRentExemption(0));
assert.equal(BigInt(await c.getBalance(originalCreatorVault)) - creatorVaultRent, earlyCreatorFees, "pre-lock creator fees are swept only to the original creator's pump vault, separately from its payer-funded rent");
assert.equal(BigInt(await c.getBalance(treasury.publicKey)) - treasuryBeforeLock, lib.LAUNCH_FEE_LAMPORTS, "pre-lock fees are not diverted to platform revenue");
assert.equal(BigInt(await c.getBalance(lib.creatorVault(handle))), escrowBeforeLock, "pre-lock fees are not relabeled as fees earned under the later split");
const expected = { handle, launcher: launcher.publicKey, launcherBps: 0, platformBps: 2000, metadataUri: uri };
assert.equal(await lib.tikTokLaunchState(c, mint.publicKey, expected), "done");
assert.deepEqual(await lib.finishTikTokLaunchTransactions(c, launcher.publicKey, mint.publicKey, handle, 0), []);
await assert.rejects(() => lib.tikTokLaunchState(c, mint.publicKey, { ...expected, handle: "attacker" }));
const listed = await lib.listCoins(c);
const coin = listed.find(x => x.token === mint.publicKey.toBase58());
assert.ok(coin, "TikTok coin is found by treasury and validated escrow");
assert.equal(coin.recipients[0].handle, handle);
assert.equal(coin.recipients[0].shareBps, 8000);
assert.equal(coin.platformBps, 2000);
assert.equal(coin.launcherBps, 0);
assert.equal(coin.recipients[0].verified, false);
console.log("PASS: mint without inline buy, external-trade fee sweep, immutable20/80 split, listing and idempotent recovery", { earlyCreatorFees: earlyCreatorFees.toString(), originalCreatorVault: originalCreatorVault.toBase58() });

// A fee-policy change must not rewrite a historical interrupted launch's permanent split.
const historicalMint = Keypair.generate();
await send(await lib.createTransaction(c, { user: launcher.publicKey, mint: historicalMint.publicKey, name: "Historic Tiksplit", symbol: "OLD", uri, firstBuyLamports: 0n }), [launcher, historicalMint]);
await assert.rejects(() => lib.finishTikTokLaunchTransactions(c, launcher.publicKey, historicalMint.publicKey, handle, 500, 1000), /Historical/);
const historicalSplit = lib.tikTokShareholders(handle, launcher.publicKey, 500, 1000);
const historicalInstructions = [
  await PUMP_SDK.createFeeSharingConfig({ creator: launcher.publicKey, mint: historicalMint.publicKey, pool: null }),
  await PUMP_SDK.updateFeeSharesV2({ authority: launcher.publicKey, mint: historicalMint.publicKey, currentShareholders: [launcher.publicKey], newShareholders: historicalSplit, quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID }),
];
const { blockhash: historicalBlockhash } = await c.getLatestBlockhash("confirmed");
await send(new VersionedTransaction(new TransactionMessage({ payerKey: launcher.publicKey, recentBlockhash: historicalBlockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...historicalInstructions] }).compileToV0Message()), [launcher]);
assert.deepEqual(await lib.finishTikTokLaunchTransactions(c, launcher.publicKey, historicalMint.publicKey, handle, 500, 1000), []);
const historicalExpected = { ...expected, launcherBps: 500, platformBps: 1000 };
assert.equal(await lib.tikTokLaunchState(c, historicalMint.publicKey, historicalExpected), "done");
await assert.rejects(() => lib.tikTokLaunchState(c, historicalMint.publicKey, expected), /split/);
const historicalCoin = (await lib.listCoins(c)).find(x => x.token === historicalMint.publicKey.toBase58());
assert.equal(historicalCoin?.platformBps, 1000);
assert.equal(historicalCoin?.recipients[0].shareBps, 8500);
console.log("PASS: historical locked split retains its original policy during recovery");

await send(await externalCurveBuy(launcher.publicKey, mint.publicKey, 1_000_000_000n), [launcher]);
const unsweptCreatorFees = (await c.getAccountInfo(bondingCurvePda(mint.publicKey))).data.readBigUInt64LE(125);
assert.ok(unsweptCreatorFees > 0n);
assert.equal(await c.getBalance(creatorVaultPda(feeSharingConfigPda(mint.publicKey))), 0, "no legacy creator-vault balance exists before sweeping the curve");
assert.equal((await lib.listCoins(c)).find(x => x.token === mint.publicKey.toBase58())?.pendingFees, unsweptCreatorFees, "listing includes the new per-curve creator fees before any sweep");
const treasuryBeforeDistribution = BigInt(await c.getBalance(treasury.publicKey));
await send(await lib.distributeTransaction(c, launcher.publicKey, mint.publicKey), [launcher]);
const before = await lib.creatorVaultClaimable(c, handle);
const platformReceived = BigInt(await c.getBalance(treasury.publicKey)) - treasuryBeforeDistribution;
const curveRoundingRemainder = BigInt(await c.getBalance(creatorVaultPda(feeSharingConfigPda(mint.publicKey)))) - creatorVaultRent;
assert.ok(platformReceived > 0n, "20% goes directly to admin treasury");
assert.ok(before.claimable >= platformReceived * 4n && before.claimable <= platformReceived * 4n + 5n, "80/20 routing conserves fee rounding");
assert.ok(before.claimable > 0n, "pump.fun distribution deposits into unverified escrow");
assert.ok(curveRoundingRemainder >= 0n && curveRoundingRemainder <= 1n, "two integer shareholder payouts may retain at most one lamport for the next distribution");
assert.equal(before.claimable + platformReceived + curveRoundingRemainder, unsweptCreatorFees, "curve payouts plus retained rounding preserve every earned lamport");
assert.equal((await c.getAccountInfo(bondingCurvePda(mint.publicKey))).data.readBigUInt64LE(125), 0n, "distribution atomically consumes the curve bucket");
assert.equal(before.beneficiary, null);
const unauthorizedClaim = await transaction([lib.claimCreatorInstruction(handle, attacker.publicKey)]);
unauthorizedClaim.sign([beneficiary, attacker]);
const refused = await c.simulateTransaction(unauthorizedClaim);
assert.ok(refused.value.err, "unverified escrow cannot be claimed");
console.log("PASS: creator fees accrue before verification and remain locked", { platformReceived: platformReceived.toString(), creatorReceived: before.claimable.toString(), retainedRounding: curveRoundingRemainder.toString() });

const identityHash = createHash("sha256").update("local-test-tiktok-open-id").digest();
const bind = await transaction([lib.bindCreatorInstruction(handle, beneficiary.publicKey, identityHash)]);
await send(bind, [beneficiary, verifier]);
const bound = await lib.creatorVaultClaimable(c, handle);
assert.equal(bound.beneficiary, beneficiary.publicKey.toBase58());
const adminClaim = await transaction([lib.claimCreatorInstruction(handle, treasury.publicKey)]);
adminClaim.sign([beneficiary, treasury]);
assert.ok((await c.simulateTransaction(adminClaim)).value.err, "admin cannot withdraw creator share");
const takeover = await transaction([lib.bindCreatorInstruction(handle, attacker.publicKey, identityHash)]);
takeover.sign([beneficiary, verifier, attacker]);
assert.ok((await c.simulateTransaction(takeover)).value.err, "verified ownership cannot be overwritten");
await send(await transaction([lib.claimCreatorInstruction(handle, beneficiary.publicKey)]), [beneficiary]);
const after = await lib.creatorVaultClaimable(c, handle);
assert.equal(after.claimable, 0n);
assert.equal(after.totalClaimed, before.claimable);
assert.ok(await c.getAccountInfo(lib.creatorVault(handle)), "claim retains rent-exempt escrow account");
console.log("PASS: verified beneficiary signs claim, rent is retained, claimed ledger is exact");

// Graduation must preserve fee routing when trading moves to the native pump.fun AMM.
const sdk = new OnlinePumpSdk(c);
await c.confirmTransaction(await c.requestAirdrop(launcher.publicKey, 200_000_000_000), "confirmed");
for (let attempt = 0; attempt < 30; attempt++) {
  if ((await sdk.fetchBondingCurve(mint.publicKey)).complete) break;
  const buy = await lib.buyTransaction(c, launcher.publicKey, mint.publicKey, 10_000_000_000n, 5000);
  await send(buy.tx, [launcher]);
}
assert.equal((await sdk.fetchBondingCurve(mint.publicKey)).complete, true);
const global = await sdk.fetchGlobal();
const migrate = await PUMP_SDK.migrateInstruction({ withdrawAuthority: global.withdrawAuthority, mint: mint.publicKey, user: launcher.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID });
const { blockhash: migrationBlockhash } = await c.getLatestBlockhash("confirmed");
await send(new VersionedTransaction(new TransactionMessage({ payerKey: launcher.publicKey, recentBlockhash: migrationBlockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), migrate] }).compileToV0Message()), [launcher]);
const graduated = await lib.readCoin(c, mint.publicKey);
assert.equal(graduated?.graduated, true);
assert.ok(graduated.price > 0);
assert.equal(graduated.recipients[0].verified, true);
const poolBuy = await externalPoolBuy(launcher.publicKey, mint.publicKey, 2_000_000_000n);
await send(poolBuy.tx, [launcher]);
const poolAddress = canonicalPumpPoolPda(mint.publicKey);
const poolBucket = (await c.getAccountInfo(poolAddress)).data.readBigUInt64LE(279);
assert.ok(poolBucket > 0n, "modern external pool trade accrues its creator fees in the pool bucket");
const pumpCreatorVault = creatorVaultPda(feeSharingConfigPda(mint.publicKey));
const poolCreatorVault = coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(feeSharingConfigPda(mint.publicKey)), NATIVE_MINT, TOKEN_PROGRAM_ID);
const pumpVaultBalance = BigInt(await c.getBalance(pumpCreatorVault));
const legacyPoolFees = (await c.getAccountInfo(poolCreatorVault))?.data.readBigUInt64LE(64) ?? 0n;
assert.equal((await lib.readCoin(c, mint.publicKey)).pendingFees, (pumpVaultBalance > creatorVaultRent ? pumpVaultBalance - creatorVaultRent : 0n) + legacyPoolFees + poolBucket, "pending fees include the modern pool bucket without counting trading reserves");
const poolSell = await lib.sellTransaction(c, launcher.publicKey, mint.publicKey, poolBuy.tokens / 2n);
await send(poolSell.tx, [launcher]);
const poolTrades = await lib.recentTrades(c, mint.publicKey, true);
assert.ok(poolTrades.some(x => x.venue === "pool" && x.kind === "buy"));
assert.ok(poolTrades.some(x => x.venue === "pool" && x.kind === "sell"));
const poolPending = (await lib.readCoin(c, mint.publicKey)).pendingFees;
const treasuryBeforePoolDistribution = BigInt(await c.getBalance(treasury.publicKey));
await send(await lib.distributeTransaction(c, launcher.publicKey, mint.publicKey), [launcher]);
assert.equal((await c.getAccountInfo(poolAddress)).data.readBigUInt64LE(279), 0n, "distribution atomically sweeps the modern pool bucket");
const poolFees = await lib.creatorVaultClaimable(c, handle);
assert.ok(poolFees.claimable > 0n);
const poolPlatformReceived = BigInt(await c.getBalance(treasury.publicKey)) - treasuryBeforePoolDistribution;
const poolRoundingRemainder = BigInt(await c.getBalance(pumpCreatorVault)) - creatorVaultRent;
assert.ok(poolRoundingRemainder >= 0n && poolRoundingRemainder <= 1n);
assert.equal(poolFees.claimable + poolPlatformReceived + poolRoundingRemainder, poolPending, "combined curve and pool payouts plus retained rounding preserve every earned lamport");
assert.ok(poolFees.claimable >= poolPlatformReceived * 4n && poolFees.claimable <= poolPlatformReceived * 4n + 5n, "modern pool fees preserve permanent 80/20 routing");
await send(await transaction([lib.claimCreatorInstruction(handle, beneficiary.publicKey)]), [beneficiary]);
const poolClaim = await lib.creatorVaultClaimable(c, handle);
assert.equal(poolClaim.totalClaimed, after.totalClaimed + poolFees.claimable);
assert.equal(poolClaim.claimable, 0n);
console.log("PASS: graduation, external modern PumpSwap buy, pool bucket display/sweep, sell and subsequent claim", { poolBucket: poolBucket.toString(), platformReceived: poolPlatformReceived.toString(), creatorReceived: poolFees.claimable.toString(), retainedRounding: poolRoundingRemainder.toString() });
