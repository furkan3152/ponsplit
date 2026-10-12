// Regression coverage against pump.fun's real programs on a disposable local validator.
// Uses GitHub fee accounts only. No mainnet signing or broadcasting is permitted.
// node e2e/solana/build-lib.mjs && RPC=http://127.0.0.1:8899 node e2e/solana/github-fee-compat-local.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Connection, Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
const treasury = Keypair.generate(), launcher = Keypair.generate(), trader = Keypair.generate(), payer = Keypair.generate(), mint = Keypair.generate();
process.env.NEXT_PUBLIC_SPLIDEV_TREASURY = treasury.publicKey.toBase58();
const require = createRequire(import.meta.url);
const { OnlinePumpSdk, PUMP_SDK, creatorVaultPda, feeSharingConfigPda, bondingCurvePda, PUMP_PROGRAM_ID, PUMP_FEE_CONFIG_PDA } = require("@pump-fun/pump-sdk");
const { canonicalPumpPoolPda, coinCreatorVaultAtaPda, coinCreatorVaultAuthorityPda } = require("@pump-fun/pump-swap-sdk");
const lib = require("./.build/lib.cjs");
const c = new Connection(process.env.RPC || "http://127.0.0.1:8899", "confirmed");
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(c.rpcEndpoint).hostname)) throw new Error("Disposable test keys require a local validator.");
async function send(tx, keys) {
  assert.ok(tx.serialize().length <= lib.TX_BYTES_LIMIT);
  tx.sign(keys);
  const signature = await c.sendRawTransaction(tx.serialize());
  const result = await c.confirmTransaction(signature, "confirmed");
  assert.equal(result.value.err, null);
  return signature;
}
async function transaction(user, instructions) {
  const { blockhash } = await c.getLatestBlockhash("confirmed");
  return new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions }).compileToV0Message());
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

for (const key of [launcher, trader, payer, treasury]) {
  const signature = await c.requestAirdrop(key.publicKey, 100_000_000_000);
  await c.confirmTransaction(signature, "confirmed");
}
const githubIds = ["1024025", "810438"], bps = [6000, 4000];
const input = { user: launcher.publicKey, mint: mint.publicKey, name: "GitHub Compatibility", symbol: "GITHUB", uri: "https://example.com/github.json", githubIds, bps, firstBuyLamports: 100_000_000n };
await send(await lib.createTransaction(c, input), [launcher, mint]);
const initialFinish = await lib.finishLaunchTransactions(c, launcher.publicKey, mint.publicKey, githubIds, bps);
for (const tx of initialFinish.slice(0, -1)) await send(tx, [launcher]);
await send(await externalCurveBuy(trader.publicKey, mint.publicKey, 1_000_000_000n), [trader]);
const earlyFees = (await c.getAccountInfo(bondingCurvePda(mint.publicKey))).data.readBigUInt64LE(125);
assert.ok(earlyFees > 0n);
const unswept = await transaction(launcher.publicKey, [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
  await PUMP_SDK.createFeeSharingConfig({ creator: launcher.publicKey, mint: mint.publicKey, pool: null }),
  await PUMP_SDK.updateFeeSharesV2({ authority: launcher.publicKey, mint: mint.publicKey, currentShareholders: [launcher.publicKey], newShareholders: lib.shareholders(githubIds, bps), quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID }),
]);
const rejected = await c.simulateTransaction(unswept, { sigVerify: false, replaceRecentBlockhash: true });
assert.match(JSON.stringify(rejected.value.err), /6095/);
assert.match(rejected.value.logs.join("\n"), /CreatorFeesNotSwept/);
assert.equal(await c.getAccountInfo(feeSharingConfigPda(mint.publicKey)), null);
const originalBefore = BigInt(await c.getBalance(creatorVaultPda(launcher.publicKey)));
const treasuryBefore = BigInt(await c.getBalance(treasury.publicKey));
for (const tx of await lib.finishLaunchTransactions(c, launcher.publicKey, mint.publicKey, githubIds, bps)) await send(tx, [launcher]);
assert.equal(BigInt(await c.getBalance(creatorVaultPda(launcher.publicKey))) - originalBefore, earlyFees);
assert.equal(BigInt(await c.getBalance(treasury.publicKey)) - treasuryBefore, lib.LAUNCH_FEE_LAMPORTS);
assert.equal((await c.getAccountInfo(bondingCurvePda(mint.publicKey))).data.readBigUInt64LE(125), 0n);
const cfg = PUMP_SDK.decodeSharingConfig(await c.getAccountInfo(feeSharingConfigPda(mint.publicKey)));
assert.equal(cfg.adminRevoked, true);
assert.deepEqual(cfg.shareholders.map(s => s.shareBps), [1000, 5400, 3600]);
assert.deepEqual((await lib.readCoin(c, mint.publicKey)).recipients.map(r => r.githubId), githubIds);
console.log("PASS GitHub first-buy launch: old migration fails6095; atomic sweep preserves creator fees and finalizes10/90");

async function assertDistribution(targetMint) {
  const sharing = PUMP_SDK.decodeSharingConfig(await c.getAccountInfo(feeSharingConfigPda(targetMint)));
  const holders = sharing.shareholders.map(h => h.address);
  const before = await Promise.all(holders.map(h => c.getBalance(h)));
  const pending = (await lib.readCoin(c, targetMint)).pendingFees;
  assert.ok(pending > 0n);
  const tx = await lib.distributeTransaction(c, payer.publicKey, targetMint);
  await send(tx, [payer]);
  const gains = (await Promise.all(holders.map(h => c.getBalance(h)))).map((v,i) => BigInt(v - before[i]));
  assert.ok(gains.every(g => g > 0n));
  const remaining = (await lib.readCoin(c, targetMint)).pendingFees;
  assert.equal(gains.reduce((a,b) => a+b, 0n) + remaining, pending);
  for (let i=0; i<gains.length; i++) assert.equal(gains[i], pending * BigInt(sharing.shareholders[i].shareBps) / 10000n);
  assert.equal((await c.getAccountInfo(bondingCurvePda(targetMint))).data.readBigUInt64LE(125), 0n);
  return { pending, bytes: tx.serialize().length };
}
await send(await externalCurveBuy(trader.publicKey, mint.publicKey, 1_000_000_000n), [trader]);
const curveBucket = (await c.getAccountInfo(bondingCurvePda(mint.publicKey))).data.readBigUInt64LE(125);
assert.equal((await lib.readCoin(c, mint.publicKey)).pendingFees, curveBucket);
console.log("PASS GitHub modern curve fees displayed and paid by share", await assertDistribution(mint.publicKey));

const sdk = new OnlinePumpSdk(c);
for (let i=0; i<5; i++) {
  if ((await sdk.fetchBondingCurve(mint.publicKey)).complete) break;
  await send((await lib.buyTransaction(c, launcher.publicKey, mint.publicKey, 25_000_000_000n)).tx, [launcher]);
}
assert.equal((await sdk.fetchBondingCurve(mint.publicKey)).complete, true);
const migrate = await PUMP_SDK.migrateInstruction({ withdrawAuthority: (await sdk.fetchGlobal()).withdrawAuthority, mint: mint.publicKey, user: launcher.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID });
await send(await transaction(launcher.publicKey, [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), migrate]), [launcher]);
await send((await externalPoolBuy(trader.publicKey, mint.publicKey, 1_000_000_000n)).tx, [trader]);
const poolKey = canonicalPumpPoolPda(mint.publicKey);
assert.ok((await c.getAccountInfo(poolKey)).data.readBigUInt64LE(279) > 0n);
console.log("PASS GitHub modern PumpSwap fees displayed and paid by share", await assertDistribution(mint.publicKey));
assert.equal((await c.getAccountInfo(poolKey)).data.readBigUInt64LE(279), 0n);

// Maximum supported recipient count still fits, including a trade between config creation and locking.
const large = Keypair.generate();
const nineIds = Array.from({ length: 9 }, (_,i) => String(1000000+i));
const nineBps = Array(9).fill(1111); nineBps[0]++;
await send(await lib.createTransaction(c, { ...input, mint: large.publicKey, githubIds: nineIds, bps: nineBps, firstBuyLamports: 0n }), [launcher, large]);
const finishNine = await lib.finishLaunchTransactions(c, launcher.publicKey, large.publicKey, nineIds, nineBps);
assert.ok(finishNine.every(tx => tx.serialize().length <= lib.TX_BYTES_LIMIT));
for (const tx of finishNine.slice(0,-1)) await send(tx, [launcher]);
await send(await externalCurveBuy(trader.publicKey, large.publicKey, 1_000_000_000n), [trader]);
await send(finishNine.at(-1), [launcher]);
assert.equal((await lib.readCoin(c, large.publicKey)).recipients.length, 9);
assert.equal((await lib.finishLaunchTransactions(c, launcher.publicKey, large.publicKey, nineIds, nineBps)).length, 0);
await send(await externalCurveBuy(trader.publicKey, large.publicKey, 1_000_000_000n), [trader]);
console.log("PASS nine GitHub recipients finalize, resume idempotently and receive fees", await assertDistribution(large.publicKey));

await c.confirmTransaction(await c.requestAirdrop(launcher.publicKey, 100_000_000_000), "confirmed");
for (let i=0; i<5; i++) {
  if ((await sdk.fetchBondingCurve(large.publicKey)).complete) break;
  await send((await lib.buyTransaction(c, launcher.publicKey, large.publicKey, 25_000_000_000n)).tx, [launcher]);
}
assert.equal((await sdk.fetchBondingCurve(large.publicKey)).complete, true);
const migrateNine = await PUMP_SDK.migrateInstruction({ withdrawAuthority: (await sdk.fetchGlobal()).withdrawAuthority, mint: large.publicKey, user: launcher.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID });
await send(await transaction(launcher.publicKey, [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), migrateNine]), [launcher]);
await send((await externalPoolBuy(trader.publicKey, large.publicKey, 1_000_000_000n)).tx, [trader]);
console.log("PASS nine GitHub recipients receive modern pool fees within packet limit", await assertDistribution(large.publicKey));
