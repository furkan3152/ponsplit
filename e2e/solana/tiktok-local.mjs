// Uses the actual pump.fun programs plus the compiled Tiksplit escrow on a local validator.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Connection, Keypair, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

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
const { OnlinePumpSdk, PUMP_SDK } = require("@pump-fun/pump-sdk");
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
for (const key of [launcher, beneficiary, attacker, treasury]) {
  const sig = await c.requestAirdrop(key.publicKey, 50_000_000_000);
  await c.confirmTransaction(sig, "confirmed");
}

// Preflight before minting and safe completion after minting use the same builder.
await assert.rejects(() => lib.finishTikTokLaunchTransactions(c, launcher.publicKey, mint.publicKey, handle, 500), /20%/);
await lib.finishTikTokLaunchTransactions(c, launcher.publicKey, mint.publicKey, handle, 0);
const create = await lib.createTransaction(c, { user: launcher.publicKey, mint: mint.publicKey, name: "Tiksplit Local", symbol: "TIK", uri, firstBuyLamports: 100_000_000n });
await send(create, [launcher, mint]);
for (const tx of await lib.finishTikTokLaunchTransactions(c, launcher.publicKey, mint.publicKey, handle, 0)) await send(tx, [launcher]);
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
console.log("PASS: real pump.fun creation, immutable TikTok split, listing and exact recovery");

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

const trade = await lib.buyTransaction(c, launcher.publicKey, mint.publicKey, 1_000_000_000n);
await send(trade.tx, [launcher]);
const treasuryBeforeDistribution = BigInt(await c.getBalance(treasury.publicKey));
await send(await lib.distributeTransaction(c, launcher.publicKey, mint.publicKey), [launcher]);
const before = await lib.creatorVaultClaimable(c, handle);
const platformReceived = BigInt(await c.getBalance(treasury.publicKey)) - treasuryBeforeDistribution;
assert.ok(platformReceived > 0n, "20% goes directly to admin treasury");
assert.ok(before.claimable >= platformReceived * 4n && before.claimable <= platformReceived * 4n + 5n, "80/20 routing conserves fee rounding");
assert.ok(before.claimable > 0n, "pump.fun distribution deposits into unverified escrow");
assert.equal(before.beneficiary, null);
const unauthorizedClaim = await transaction([lib.claimCreatorInstruction(handle, attacker.publicKey)]);
unauthorizedClaim.sign([beneficiary, attacker]);
const refused = await c.simulateTransaction(unauthorizedClaim);
assert.ok(refused.value.err, "unverified escrow cannot be claimed");
console.log("PASS: creator fees accrue before verification and remain locked");

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
const poolBuy = await lib.buyTransaction(c, launcher.publicKey, mint.publicKey, 2_000_000_000n);
await send(poolBuy.tx, [launcher]);
const poolSell = await lib.sellTransaction(c, launcher.publicKey, mint.publicKey, poolBuy.tokens / 2n);
await send(poolSell.tx, [launcher]);
const poolTrades = await lib.recentTrades(c, mint.publicKey, true);
assert.ok(poolTrades.some(x => x.venue === "pool" && x.kind === "buy"));
assert.ok(poolTrades.some(x => x.venue === "pool" && x.kind === "sell"));
await send(await lib.distributeTransaction(c, launcher.publicKey, mint.publicKey), [launcher]);
const poolFees = await lib.creatorVaultClaimable(c, handle);
assert.ok(poolFees.claimable > 0n);
await send(await transaction([lib.claimCreatorInstruction(handle, beneficiary.publicKey)]), [beneficiary]);
const poolClaim = await lib.creatorVaultClaimable(c, handle);
assert.equal(poolClaim.totalClaimed, after.totalClaimed + poolFees.claimable);
assert.equal(poolClaim.claimable, 0n);
console.log("PASS: graduation, PumpSwap buy/sell, pool fee routing and subsequent claim");
