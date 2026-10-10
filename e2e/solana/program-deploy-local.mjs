// Real upgradeable loader tests. Every key here is disposable local-validator-only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";

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
const wallet = {
  publicKey: admin.publicKey,
  signTransaction: async (tx) => { tx.partialSign(admin); return Transaction.from(tx.serialize()); },
  signAllTransactions: async (txs) => txs.map((tx) => { tx.partialSign(admin); return Transaction.from(tx.serialize()); }),
};
const quote = await lib.quoteProgramDeployment(c, admin.publicKey, artifact);
assert.ok(quote.sufficientBalance);
assert.equal(quote.writeTransactions, Math.ceil(artifact.bytes.length / lib.WRITE_CHUNK_SIZE));
assert.equal(quote.finalCostLamports, quote.lockedRentLamports + quote.transactionFeesLamports);
assert.ok(quote.requiredLamports > quote.finalCostLamports);
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
assert.equal(quote.requiredLamports, quote.finalCostLamports + quote.walletRentLamports + quote.recoveryFeeLamports);

let savedBuffer;
let signingBatches = 0;
const initialAdminBalance = BigInt(await c.getBalance(admin.publicKey));
let confirmationDropped = false;
const lastSignatures = [];
// Real transaction succeeds on the validator, then its confirmation transport disconnects.
const mobileConnection = new Proxy(c, { get(target, key) {
  if (key === "confirmTransaction") return async (...args) => {
    const result = await target.confirmTransaction(...args);
    if (!confirmationDropped) { confirmationDropped = true; throw new Error("Mobile confirmation connection lost"); }
    return result;
  };
  const value = Reflect.get(target, key, target);
  return typeof value === "function" ? value.bind(target) : value;
} });
await assert.rejects(lib.deployEscrowProgram({ connection: mobileConnection, onTransaction: (signature) => lastSignatures.push(signature), wallet: { ...wallet, signAllTransactions: async (txs) => {
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
const singleWallet = { publicKey: admin.publicKey, signTransaction: async (tx) => {
  // Before every new approval, the previous write must already be confirmed on chain.
  if (singleApprovals > 0) {
    const current = await lib.inspectDeploymentBuffer(c, new PublicKey(savedBuffer), artifact);
    assert.ok(current.writtenBytes > interrupted.writtenBytes + (singleApprovals - 1) * lib.WRITE_CHUNK_SIZE);
  }
  singleApprovals++;
  return wallet.signTransaction(tx);
}, signAllTransactions: async () => { assert.fail("single signing must not invoke wallet batch signing"); } };
const result = await lib.deployEscrowProgram({ connection: c, wallet: singleWallet, writeBatchSize: 1, artifact, resumeBuffer: new PublicKey(savedBuffer), onProgress: (progress) => { if (progress.phase === "writing") resumedBytes = Math.max(resumedBytes, progress.writtenBytes); } });
assert.equal(resumedBytes, artifact.bytes.length);
assert.equal(singleApprovals, interrupted.remainingChunks + 1);
assert.equal(await lib.inspectDeployedProgram(c, new PublicKey(result.programId), artifact), true);
assert.ok((await c.getAccountInfo(new PublicKey(result.programId))).executable);
assert.equal(initialAdminBalance - BigInt(await c.getBalance(admin.publicKey)), quote.finalCostLamports, "actual completed deployment costs exactly the quoted rents and fees; buffer rent is recycled");
assert.equal(BigInt(await c.getBalance(admin.publicKey)), quote.walletRentLamports + quote.recoveryFeeLamports);
console.log("PASS single-transaction mobile signing, lost-confirmation recovery, exact budget and verified program", result.programId);
// Refill only for the independent cancellation/refund scenario.
await c.confirmTransaction(await c.requestAirdrop(admin.publicKey, 1_000_000_000), "confirmed");

let refundable;
await assert.rejects(lib.deployEscrowProgram({ connection: c, wallet: { ...wallet, signAllTransactions: async () => { throw new Error("Stop before writes"); } }, artifact, onBufferCreated: (address) => { refundable = address; } }), /Stop before writes/);
const info = await lib.inspectDeploymentBuffer(c, new PublicKey(refundable), artifact);
const before = BigInt(await c.getBalance(admin.publicKey));
await lib.closeDeploymentBuffer({ connection: c, wallet, buffer: new PublicKey(refundable) });
const after = BigInt(await c.getBalance(admin.publicKey));
assert.equal(await c.getAccountInfo(new PublicKey(refundable)), null);
assert.equal(after - before, info.lamports - quote.recoveryFeeLamports);
await assert.rejects(lib.closeDeploymentBuffer({ connection: c, wallet, buffer: new PublicKey(result.programId) }), /buffer/);
console.log("PASS admin-only close returns all buffer rent minus actual transaction fee");


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
} }, program: deployed, artifact, confirmedProgramId: deployed.toBase58() }), /wallet changed/);
assert.equal(await lib.inspectDeployedProgram(c, deployed, artifact), true);
await assert.rejects(lib.quoteUnusedProgramRefund(c, SystemProgram.programId, artifact), /not an active verified/);
const beforeProgramRefund = BigInt(await c.getBalance(admin.publicKey));
const closeSignature = await lib.closeUnusedProgram({ connection: c, wallet, program: deployed, artifact, confirmedProgramId: deployed.toBase58() });
const closeReceipt = await c.getTransaction(closeSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
assert.ok(closeReceipt?.meta && !closeReceipt.meta.err);
assert.equal(BigInt(await c.getBalance(admin.publicKey)) - beforeProgramRefund, refundQuote.refundLamports - BigInt(closeReceipt.meta.fee));
assert.equal(await c.getAccountInfo(lib.programDataAddress(deployed)), null);
assert.equal(BigInt((await c.getAccountInfo(deployed)).lamports), refundQuote.retainedProgramLamports);
assert.equal(await lib.inspectDeployedProgram(c, deployed, artifact), false);
await assert.rejects(lib.quoteUnusedProgramRefund(c, deployed, artifact), /not an active verified/);
console.log("PASS unused program closure: only admin receives ProgramData rent, exact fee, address rent retained, program cannot run");

const second = await lib.deployEscrowProgram({ connection: c, wallet, artifact });
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
