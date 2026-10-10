// Real upgradeable loader tests. Every key here is disposable local-validator-only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

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

let savedBuffer;
let signingBatches = 0;
const initialAdminBalance = BigInt(await c.getBalance(admin.publicKey));
await assert.rejects(lib.deployEscrowProgram({ connection: c, wallet: { ...wallet, signAllTransactions: async (txs) => {
  if (++signingBatches === 2) throw new Error("Intentional interruption after first write batch");
  return wallet.signAllTransactions(txs);
} }, artifact, onBufferCreated: (address) => { savedBuffer = address; } }), /Intentional interruption/);
assert.ok(savedBuffer);
const interrupted = await lib.inspectDeploymentBuffer(c, new PublicKey(savedBuffer), artifact);
assert.ok(interrupted.writtenBytes > 0 && !interrupted.complete);
const bufferBalance = interrupted.lamports;
// Loader itself rejects a different authority, in addition to the client admin gate.
const stolenClose = new Transaction().add(lib.closeBufferInstruction(new PublicKey(savedBuffer), attacker.publicKey));
await assert.rejects(sendAndConfirmTransaction(c, stolenClose, [attacker]));
assert.equal(BigInt((await c.getAccountInfo(new PublicKey(savedBuffer))).lamports), bufferBalance);
console.log("PASS interrupted writes resumable; unauthorized loader refund rejected");

let resumedBytes = 0;
const result = await lib.deployEscrowProgram({ connection: c, wallet, artifact, resumeBuffer: new PublicKey(savedBuffer), onProgress: (progress) => { if (progress.phase === "writing") resumedBytes = Math.max(resumedBytes, progress.writtenBytes); } });
assert.equal(resumedBytes, artifact.bytes.length);
assert.equal(await lib.inspectDeployedProgram(c, new PublicKey(result.programId), artifact), true);
assert.ok((await c.getAccountInfo(new PublicKey(result.programId))).executable);
assert.equal(initialAdminBalance - BigInt(await c.getBalance(admin.publicKey)), quote.finalCostLamports, "actual completed deployment costs exactly the quoted rents and fees; buffer rent is recycled");
console.log("PASS real program deployment + binary readback + admin upgrade authority", result.programId);

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
