// Real upgradeable loader tests. Every key here is disposable local-validator-only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";

const c = new Connection(process.env.RPC || "http://127.0.0.1:8909", "confirmed");
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(c.rpcEndpoint).hostname)) throw new Error("Disposable deployment keys may be used only on a local validator.");
const admin = Keypair.generate(), attacker = Keypair.generate();
process.env.NEXT_PUBLIC_TIKSPLIT_ADMIN_WALLET = admin.publicKey.toBase58();
await build({ entryPoints: ["src/lib/solana/program-deploy.ts"], outfile: "e2e/solana/.build/program-deploy.cjs", bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "warning" });
const require = createRequire(import.meta.url);
const lib = require("./.build/program-deploy.cjs");
const artifact = { bytes: readFileSync("public/programs/tiktok-escrow.so"), manifest: lib.ESCROW_ARTIFACT_MANIFEST };
for (const who of [admin, attacker]) {
  const signature = await c.requestAirdrop(who.publicKey, 5_000_000_000);
  await c.confirmTransaction(signature, "confirmed");
}
let hashRefreshes = 0, coSignatureRefreshes = 0, signatureConfirmations = 0;
function isUploadWrite(tx) {
  return tx.instructions.some(ix => ix.programId.equals(lib.UPGRADEABLE_LOADER) && ix.data.readUInt32LE(0) === 1);
}
function assertBoundedUpload(tx, { units = 25000, microLamports = 1000n } = {}) {
  assert.equal(tx.instructions.length, 3, "uploads contain exactly two fee settings and one loader write");
  const [limit, price, write] = tx.instructions;
  assert.ok(limit.programId.equals(ComputeBudgetProgram.programId));
  assert.equal(limit.data[0], 2);
  assert.equal(limit.data.readUInt32LE(1), units);
  assert.ok(price.programId.equals(ComputeBudgetProgram.programId));
  assert.equal(price.data[0], 3);
  assert.equal(price.data.readBigUInt64LE(1), microLamports);
  assert.ok(write.programId.equals(lib.UPGRADEABLE_LOADER));
  assert.equal(write.data.readUInt32LE(0), 1);
  assert.ok(!tx.instructions.some(ix => ix.programId.equals(SystemProgram.programId)), "uploading must never create/fund an account or transfer SOL");
  assert.ok(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232, "explicit budgets must fit the Solana packet limit with a full chunk");
}
function replaceWalletFee(tx) {
  tx.instructions = tx.instructions.filter(ix => !ix.programId.equals(ComputeBudgetProgram.programId));
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 10000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
}
async function okxStyleSign(tx) {
  const original = tx.recentBlockhash;
  // Reproduce the reported wallet behavior with real validator blockhashes, including
  // in-place mutation, untrusted expiry metadata, and now-stale local partial signatures.
  for (let attempts = 0; tx.recentBlockhash === original; attempts++) {
    assert.ok(attempts < 80, "validator must produce a fresh blockhash");
    tx.recentBlockhash = (await c.getLatestBlockhash("processed")).blockhash;
    if (tx.recentBlockhash === original) await new Promise(resolve => setTimeout(resolve, 50));
  }
  hashRefreshes++;
  if (tx.signatures.some(s => s.signature && !s.publicKey.equals(admin.publicKey))) coSignatureRefreshes++;
  tx.lastValidBlockHeight = 1;
  tx.partialSign(admin);
  assert.ok(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232, "wallet mutation must preserve the packet limit");
  return Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}
const wallet = {
  publicKey: admin.publicKey,
  signTransaction: okxStyleSign,
  signAllTransactions: async (txs) => Promise.all(txs.map(okxStyleSign)),
};
const checkedConnection = new Proxy(c, { get(target, key) {
  if (key === "confirmTransaction") return async (strategy, ...rest) => {
    assert.equal(typeof strategy, "string", "refreshed hashes must never use the old or wallet-supplied block-height expiry");
    signatureConfirmations++;
    return target.confirmTransaction(strategy, ...rest);
  };
  const value = Reflect.get(target, key, target);
  return typeof value === "function" ? value.bind(target) : value;
} });
const quote = await lib.quoteProgramDeployment(c, admin.publicKey, artifact);
assert.ok(quote.sufficientBalance);
assert.equal(quote.writeTransactions, Math.ceil(artifact.bytes.length / lib.WRITE_CHUNK_SIZE));
assert.equal(quote.finalCostLamports, quote.lockedRentLamports + quote.transactionFeesLamports);
assert.ok(quote.requiredLamports > quote.finalCostLamports);
assert.equal(quote.writeFeeLamports, 5025n, "the quote includes the explicit 25-lamport upload priority fee");
assert.equal(lib.DEFAULT_UPLOAD_SIGNING_BATCH, 8);
const quotedWrite = new Transaction({ feePayer: admin.publicKey, ...await c.getLatestBlockhash("confirmed") }).add(...lib.createBufferWriteTransaction(attacker.publicKey, admin.publicKey, 0, artifact.bytes.subarray(0, lib.WRITE_CHUNK_SIZE)).instructions);
assertBoundedUpload(quotedWrite);
assert.equal(BigInt((await c.getFeeForMessage(quotedWrite.compileMessage(), "confirmed")).value), quote.writeFeeLamports, "the exported write builder and live fee quote agree");
console.log("PASS real RPC rent/fee quote", { bytes: quote.binaryBytes, transactions: quote.totalTransactions, finalCostLamports: quote.finalCostLamports.toString(), requiredLamports: quote.requiredLamports.toString() });

// Prove deployment with only the advertised budget, not a generously funded test wallet.
const trimLifetime = await c.getLatestBlockhash("confirmed");
const trim = new Transaction({ feePayer: admin.publicKey, ...trimLifetime }).add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: attacker.publicKey, lamports: 1 }));
const trimFee = (await c.getFeeForMessage(trim.compileMessage(), "confirmed")).value;
assert.notEqual(trimFee, null);
const spare = BigInt(await c.getBalance(admin.publicKey)) - quote.requiredLamports - BigInt(trimFee);
trim.instructions[0] = SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: attacker.publicKey, lamports: spare });
trim.sign(admin);
const trimSignature = await c.sendRawTransaction(trim.serialize());
await c.confirmTransaction({ signature: trimSignature, ...trimLifetime }, "confirmed");
assert.equal(BigInt(await c.getBalance(admin.publicKey)), quote.requiredLamports);
assert.equal(quote.requiredLamports, quote.finalCostLamports + quote.walletRentLamports + quote.recoveryFeeLamports + quote.walletFeeReserveLamports);

let savedBuffer;
let signingBatches = 0;
const initialAdminBalance = BigInt(await c.getBalance(admin.publicKey));
let confirmationDropped = false;
const lastSignatures = [];
// Real transaction succeeds on the validator, then its confirmation transport disconnects.
const mobileConnection = new Proxy(checkedConnection, { get(target, key) {
  if (key === "confirmTransaction") return async (...args) => {
    const result = await target.confirmTransaction(...args);
    if (!confirmationDropped) { confirmationDropped = true; throw new Error("Mobile confirmation connection lost"); }
    return result;
  };
  const value = Reflect.get(target, key, target);
  return typeof value === "function" ? value.bind(target) : value;
} });
await assert.rejects(lib.deployEscrowProgram({ connection: mobileConnection, writeBatchSize: 4, onTransaction: (signature) => lastSignatures.push(signature), wallet: { ...wallet, signAllTransactions: async (txs) => {
  if (++signingBatches === 2) throw new Error("Intentional interruption after first write batch");
  return wallet.signAllTransactions(txs);
} }, artifact, onBufferCreated: (address) => { savedBuffer = address; } }), /Intentional interruption/);
assert.ok(savedBuffer);
assert.equal(confirmationDropped, true);
assert.equal(lastSignatures.length, 5, "buffer and four writes preserve signed transaction IDs");
const interrupted = await lib.inspectDeploymentBuffer(c, new PublicKey(savedBuffer), artifact);
assert.ok(interrupted.writtenBytes > 0 && !interrupted.complete);
const bufferBalance = interrupted.lamports;
// Loader itself rejects a different authority, in addition to the client admin gate.
const stolenClose = new Transaction().add(lib.closeBufferInstruction(new PublicKey(savedBuffer), attacker.publicKey));
await assert.rejects(sendAndConfirmTransaction(c, stolenClose, [attacker]));
assert.equal(BigInt((await c.getAccountInfo(new PublicKey(savedBuffer))).lamports), bufferBalance);
console.log("PASS interrupted writes resumable; unauthorized loader refund rejected");

let resumedBytes = 0;
let singleApprovals = 0;
let walletAddedFees = 0n;
const singleWallet = { publicKey: admin.publicKey, signTransaction: async (tx) => {
  // Before every new approval, the previous write must already be confirmed on chain.
  if (singleApprovals > 0) {
    const current = await lib.inspectDeploymentBuffer(c, new PublicKey(savedBuffer), artifact);
    assert.ok(current.writtenBytes > interrupted.writtenBytes + (singleApprovals - 1) * lib.WRITE_CHUNK_SIZE);
  }
  singleApprovals++;
  if (isUploadWrite(tx)) {
    assertBoundedUpload(tx);
    replaceWalletFee(tx);
    assertBoundedUpload(tx, { units: 10000, microLamports: 100000n });
    walletAddedFees += 975n;
  }
  return wallet.signTransaction(tx);
}, signAllTransactions: async () => { assert.fail("single signing must not invoke wallet batch signing"); } };
const result = await lib.deployEscrowProgram({ connection: checkedConnection, wallet: singleWallet, writeBatchSize: 1, artifact, resumeBuffer: new PublicKey(savedBuffer), onProgress: (progress) => { if (progress.phase === "writing") resumedBytes = Math.max(resumedBytes, progress.writtenBytes); } });
assert.equal(resumedBytes, artifact.bytes.length);
assert.equal(singleApprovals, interrupted.remainingChunks + 1);
assert.equal(await lib.inspectDeployedProgram(c, new PublicKey(result.programId), artifact), true);
assert.ok((await c.getAccountInfo(new PublicKey(result.programId))).executable);
assert.equal(initialAdminBalance - BigInt(await c.getBalance(admin.publicKey)), quote.finalCostLamports + walletAddedFees, "actual completed deployment costs exactly the quoted rents and fees; buffer rent is recycled");
assert.equal(BigInt(await c.getBalance(admin.publicKey)), quote.walletRentLamports + quote.recoveryFeeLamports + quote.walletFeeReserveLamports - walletAddedFees);
assert.equal(signatureConfirmations, quote.totalTransactions);
assert.equal(coSignatureRefreshes, 2, "both buffer creation and final program deployment survive refreshed blockhashes");
console.log("PASS wallet-refreshed blockhashes, local co-signatures, single mobile signing, lost-confirmation recovery, exact budget and verified program", result.programId);
// Refill only for the independent cancellation/refund scenario.
await c.confirmTransaction(await c.requestAirdrop(admin.publicKey, 1_000_000_000), "confirmed");

let refundable;
await assert.rejects(lib.deployEscrowProgram({ connection: checkedConnection, wallet: { ...wallet, signAllTransactions: async () => { throw new Error("Stop before writes"); } }, artifact, onBufferCreated: (address) => { refundable = address; } }), /Stop before writes/);
const info = await lib.inspectDeploymentBuffer(c, new PublicKey(refundable), artifact);
const before = BigInt(await c.getBalance(admin.publicKey));
let tamperedBatchSent = 0;
await assert.rejects(lib.deployEscrowProgram({ connection: checkedConnection, artifact, writeBatchSize: lib.MAX_UPLOAD_SIGNING_BATCH, resumeBuffer: new PublicKey(refundable), onTransaction: () => { tamperedBatchSent++; }, wallet: { ...wallet, signAllTransactions: async txs => {
  assert.equal(txs.length, quote.writeTransactions, "fast mode requests the full upload together");
  txs.at(-1).add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: attacker.publicKey, lamports: 1 }));
  return wallet.signAllTransactions(txs);
} } }), /Wallet transaction blocked/);
assert.equal(tamperedBatchSent, 0, "the entire batch must be validated before its first send");
assert.equal(BigInt(await c.getBalance(admin.publicKey)), before);
assert.equal((await lib.inspectDeploymentBuffer(c, new PublicKey(refundable), artifact)).writtenBytes, 0);
console.log("PASS tampered final write rejects the whole batch without broadcasting or charging");
await assert.rejects(lib.closeDeploymentBuffer({ connection: c, wallet: { ...wallet, signTransaction: async tx => {
  tx.add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: attacker.publicKey, lamports: 1 }));
  return wallet.signTransaction(tx);
} }, buffer: new PublicKey(refundable) }), /Wallet transaction blocked/);
await assert.rejects(lib.closeDeploymentBuffer({ connection: checkedConnection, wallet: { ...wallet, signTransaction: async tx => {
  tx.recentBlockhash = SystemProgram.programId.toBase58();
  tx.sign(admin);
  return tx;
} }, buffer: new PublicKey(refundable) }), /[Bb]lockhash not found/);
assert.equal(BigInt(await c.getBalance(admin.publicKey)), before, "invalid/expired wallet hash fails preflight without charging fees");
assert.equal((await lib.inspectDeploymentBuffer(c, new PublicKey(refundable), artifact)).lamports, info.lamports);
await lib.closeDeploymentBuffer({ connection: checkedConnection, wallet: { ...wallet, signTransaction: async tx => {
  replaceWalletFee(tx);
  return wallet.signTransaction(tx);
} }, buffer: new PublicKey(refundable) });
const after = BigInt(await c.getBalance(admin.publicKey));
assert.equal(await c.getAccountInfo(new PublicKey(refundable)), null);
assert.equal(after - before, info.lamports - quote.recoveryFeeLamports - 1000n);
await assert.rejects(lib.closeDeploymentBuffer({ connection: c, wallet, buffer: new PublicKey(result.programId) }), /buffer/);
console.log("PASS refreshed hash and bounded priority fee accepted for refund; hidden transfer and expired hash rejected without payment");


// Close only an unused deployment, with all refunds fixed to the admin.
const deployed = new PublicKey(result.programId);
const refundQuote = await lib.quoteUnusedProgramRefund(c, deployed, artifact);
assert.equal(refundQuote.refundLamports, BigInt((await c.getAccountInfo(lib.programDataAddress(deployed))).lamports));
assert.equal(refundQuote.retainedProgramLamports, BigInt((await c.getAccountInfo(deployed)).lamports));
await assert.rejects(sendAndConfirmTransaction(c, new Transaction().add(lib.closeProgramInstruction(deployed, attacker.publicKey)), [attacker]));
assert.equal(await lib.inspectDeployedProgram(c, deployed, artifact), true);
await assert.rejects(lib.closeUnusedProgram({ connection: c, wallet: { ...wallet, signTransaction: async (tx) => {
  tx.instructions[0].keys[1].pubkey = attacker.publicKey;
  return wallet.signTransaction(tx);
} }, program: deployed, artifact, confirmedProgramId: deployed.toBase58() }), /Wallet transaction blocked/);
assert.equal(await lib.inspectDeployedProgram(c, deployed, artifact), true);
await assert.rejects(lib.quoteUnusedProgramRefund(c, SystemProgram.programId, artifact), /not an active verified/);
const beforeProgramRefund = BigInt(await c.getBalance(admin.publicKey));
const closeSignature = await lib.closeUnusedProgram({ connection: checkedConnection, wallet, program: deployed, artifact, confirmedProgramId: deployed.toBase58() });
const closeReceipt = await c.getTransaction(closeSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
assert.ok(closeReceipt?.meta && !closeReceipt.meta.err);
assert.equal(BigInt(await c.getBalance(admin.publicKey)) - beforeProgramRefund, refundQuote.refundLamports - BigInt(closeReceipt.meta.fee));
assert.equal(await c.getAccountInfo(lib.programDataAddress(deployed)), null);
assert.equal(BigInt((await c.getAccountInfo(deployed)).lamports), refundQuote.retainedProgramLamports);
assert.equal(await lib.inspectDeployedProgram(c, deployed, artifact), false);
await assert.rejects(lib.quoteUnusedProgramRefund(c, deployed, artifact), /not an active verified/);
console.log("PASS unused program closure: only admin receives ProgramData rent, exact fee, address rent retained, program cannot run");

// Model a mobile wallet that rejects oversized signing queues. The default path must
// complete with small batches while preserving every write and the exact quoted cost.
const defaultBalance = BigInt(await c.getBalance(admin.publicKey));
const defaultQuote = await lib.quoteProgramDeployment(c, admin.publicKey, artifact);
let defaultSingleRequests = 0;
const defaultBatchSizes = [];
const defaultWriteSignatures = [];
let defaultPhase = "checking";
const compatible = await lib.deployEscrowProgram({ connection: checkedConnection, artifact,
  onProgress: progress => { defaultPhase = progress.phase; },
  onTransaction: signature => { if (defaultPhase === "writing") defaultWriteSignatures.push(signature); },
  wallet: { ...wallet,
    signTransaction: async tx => { defaultSingleRequests++; assert.ok(!isUploadWrite(tx)); return wallet.signTransaction(tx); },
    signAllTransactions: async txs => {
      assert.ok(txs.length <= 8, "a restrictive mobile wallet must never receive an oversized default batch");
      defaultBatchSizes.push(txs.length);
      for (const tx of txs) assertBoundedUpload(tx);
      const signed = await wallet.signAllTransactions(txs);
      for (const tx of signed) assertBoundedUpload(tx);
      return signed;
    },
  },
});
assert.equal(defaultSingleRequests, 2);
assert.equal(defaultBatchSizes.length, Math.ceil(defaultQuote.writeTransactions / 8));
assert.equal(defaultBatchSizes.reduce((sum, count) => sum + count, 0), defaultQuote.writeTransactions);
assert.equal(defaultWriteSignatures.length, defaultQuote.writeTransactions);
for (const signature of [defaultWriteSignatures[0], defaultWriteSignatures.at(-1)]) {
  const receipt = await c.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  assert.ok(receipt?.meta && !receipt.meta.err);
  assert.equal(BigInt(receipt.meta.fee), defaultQuote.writeFeeLamports, "real first/last uploads charge the quoted fee");
}
assert.equal(defaultBalance - BigInt(await c.getBalance(admin.publicKey)), defaultQuote.finalCostLamports, "the default small-batch deployment costs exactly its quote");
assert.equal(await lib.inspectDeployedProgram(c, new PublicKey(compatible.programId), artifact), true);
console.log("PASS default mobile deployment: batches of eight, explicit bounded fees, no upload transfers, exact real fees and complete verified readback", defaultBatchSizes);

let fastSingleRequests = 0, fastBatchRequests = 0, activeConfirmations = 0, maxConfirmations = 0;
const fastConnection = new Proxy(checkedConnection, { get(target, key) {
  if (key === "confirmTransaction") return async (...args) => {
    activeConfirmations++;
    maxConfirmations = Math.max(maxConfirmations, activeConfirmations);
    try { return await target.confirmTransaction(...args); }
    finally { activeConfirmations--; }
  };
  const value = Reflect.get(target, key, target);
  return typeof value === "function" ? value.bind(target) : value;
} });
const second = await lib.deployEscrowProgram({ connection: fastConnection, artifact, writeBatchSize: lib.MAX_UPLOAD_SIGNING_BATCH, wallet: { ...wallet,
  signTransaction: async tx => { fastSingleRequests++; return wallet.signTransaction(tx); },
  signAllTransactions: async txs => { fastBatchRequests++; assert.equal(txs.length, quote.writeTransactions); return wallet.signAllTransactions(txs); },
} });
assert.equal(fastSingleRequests, 2, "only create-buffer and final deployment ask individually");
assert.equal(fastBatchRequests, 1, "all 71 writes share one wallet API approval request");
assert.ok(maxConfirmations > 1 && maxConfirmations <= 3);
assert.equal(activeConfirmations, 0);
console.log("PASS fast deployment: one 71-write approval request, bounded parallel confirmation and verified readback");
const secondProgram = new PublicKey(second.programId);
// Loader v3 intentionally forbids closing in the deployment slot.
const deploymentSlot = Number((await c.getAccountInfo(lib.programDataAddress(secondProgram), "confirmed")).data.readBigUInt64LE(4));
for (let tries = 0; await c.getSlot("confirmed") <= deploymentSlot; tries++) {
  assert.ok(tries < 100, "validator must advance beyond the deployment slot");
  await new Promise((resolve) => setTimeout(resolve, 100));
}
let walletPromptReached = false;
const raceHandle = Buffer.from("rent.protection");
const [vault] = PublicKey.findProgramAddressSync([Buffer.from("creator"), admin.publicKey.toBuffer(), raceHandle], secondProgram);
const initVault = new TransactionInstruction({ programId: secondProgram, keys: [
  { pubkey: admin.publicKey, isSigner: true, isWritable: true },
  { pubkey: vault, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
], data: Buffer.concat([Buffer.from([0, raceHandle.length]), raceHandle, admin.publicKey.toBuffer()]) });
await assert.rejects(lib.closeUnusedProgram({ connection: c, wallet: { ...wallet, signTransaction: async (tx) => {
  walletPromptReached = true;
  // A creator vault appears while the close-wallet prompt is open.
  await sendAndConfirmTransaction(c, new Transaction().add(initVault), [admin]);
  return wallet.signTransaction(tx);
} }, program: secondProgram, artifact, confirmedProgramId: second.programId }), /owns creator or other accounts/);
assert.ok(walletPromptReached);
assert.equal(await lib.inspectDeployedProgram(c, secondProgram, artifact), true);
await assert.rejects(lib.closeUnusedProgram({ connection: c, wallet: { ...wallet, signTransaction: async () => { assert.fail("an existing vault must block before signing"); } }, program: secondProgram, artifact, confirmedProgramId: second.programId }), /owns creator or other accounts/);
if (process.env.NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID) {
  await assert.rejects(lib.quoteUnusedProgramRefund(c, new PublicKey(process.env.NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID), artifact), /configured escrow program/);
}
console.log("PASS existing empty creator vault and accounts created during wallet approval block closure; configured program is protected");
assert.ok(hashRefreshes > 140 && signatureConfirmations > 140);
console.log("PASS full loader regression with wallet-refreshed hashes", { hashRefreshes, coSignatureRefreshes, signatureConfirmations });
