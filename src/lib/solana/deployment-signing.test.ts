import assert from "node:assert/strict";
import test from "node:test";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { assertDeploymentMessage, checkedDeploymentSignature } from "./deployment-signing.ts";
import { closeBufferInstruction, writeBufferInstruction } from "./program-deploy.ts";
const payer = new PublicKey(new Uint8Array(32).fill(1));
const buffer = new PublicKey(new Uint8Array(32).fill(2));
const attacker = new PublicKey(new Uint8Array(32).fill(3));
const base = () => new Transaction({ feePayer: payer, recentBlockhash: SystemProgram.programId.toBase58() }).add(closeBufferInstruction(buffer, payer));
const budget = () => [ComputeBudgetProgram.setComputeUnitLimit({ units: 10000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 })];

test("wallet fee instructions are accepted only within the bounded priority fee", () => {
  const tx = base(), snapshot = tx.serializeMessage();
  tx.instructions.unshift(...budget());
  assert.doesNotThrow(() => assertDeploymentMessage(snapshot, tx));
  const write = new Transaction({ feePayer: payer, recentBlockhash: SystemProgram.programId.toBase58() }).add(writeBufferInstruction(buffer, payer, 0, new Uint8Array(900)));
  const expected = write.serializeMessage();
  write.instructions.unshift(...budget());
  assert.doesNotThrow(() => assertDeploymentMessage(expected, write));
  assert.ok(write.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232);
  tx.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500001 });
  assert.throws(() => assertDeploymentMessage(snapshot, tx), /exceeds/);
});

test("refund recipient, upload bytes, transfers and account privileges remain immutable even with a new hash", () => {
  const mutations = [
    (tx: Transaction) => { tx.instructions[0].keys[1].pubkey = attacker; },
    (tx: Transaction) => { tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: attacker, lamports: 1 })); },
    (tx: Transaction) => { tx.feePayer = attacker; },
    (tx: Transaction) => { tx.instructions[0].keys[0].isWritable = false; },
    (tx: Transaction) => { tx.instructions[0].data[0] = 1; },
    (tx: Transaction) => { tx.instructions.unshift(...budget(), ...budget()); },
    (tx: Transaction) => { tx.instructions.unshift(new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [], data: Buffer.from([1, 0, 0, 0, 0]) })); },
  ];
  for (const mutate of mutations) { const tx = base(); const before = tx.serializeMessage(); tx.recentBlockhash = attacker.toBase58(); mutate(tx); assert.throws(() => assertDeploymentMessage(before, tx), /Wallet transaction blocked/); }
});

test("wallet-refreshed blockhash keeps the valid owner signature but discards the old expiry", () => {
  // Disposable signing keys, never used on mainnet.
  const owner = Keypair.generate();
  const tx = new Transaction({ feePayer: owner.publicKey, blockhash: payer.toBase58(), lastValidBlockHeight: 900 })
    .add(closeBufferInstruction(buffer, owner.publicKey));
  const expected = tx.serializeMessage();
  tx.recentBlockhash = attacker.toBase58();
  tx.lastValidBlockHeight = 1; // An adapter can mutate the original input in-place.
  tx.instructions.unshift(...budget());
  tx.sign(owner);
  const ownerSignature = Buffer.from(tx.signature!);
  const checked = checkedDeploymentSignature(expected, tx, 900);
  assert.equal(checked.recentBlockhash, attacker.toBase58());
  assert.equal(checked.lastValidBlockHeight, undefined);
  assert.deepEqual(checked.signature, ownerSignature);
  assert.ok(checked.verifySignatures());
  assert.notEqual(checked, tx);
  tx.instructions[2].data[0] = 42;
  assert.ok(checked.verifySignatures(), "later adapter changes cannot mutate the verified snapshot");
});

test("an unchanged hash uses only the captured RPC expiry, not wallet metadata", () => {
  const owner = Keypair.generate();
  const tx = new Transaction({ feePayer: owner.publicKey, blockhash: payer.toBase58(), lastValidBlockHeight: 900 })
    .add(closeBufferInstruction(buffer, owner.publicKey));
  const expected = tx.serializeMessage();
  tx.lastValidBlockHeight = 1;
  tx.sign(owner);
  assert.equal(checkedDeploymentSignature(expected, tx, 900).lastValidBlockHeight, 900);
});

test("a refreshed program/buffer creation is co-signed only after the owner's exact approval is verified", () => {
  const owner = Keypair.generate(), temporary = Keypair.generate();
  const tx = new Transaction({ feePayer: owner.publicKey, blockhash: payer.toBase58(), lastValidBlockHeight: 900 })
    .add(SystemProgram.createAccount({ fromPubkey: owner.publicKey, newAccountPubkey: temporary.publicKey, lamports: 1000, space: 36, programId: SystemProgram.programId }));
  tx.partialSign(temporary);
  const expected = tx.serializeMessage();
  const staleTemporarySignature = Buffer.from(tx.signatures.find(s => s.publicKey.equals(temporary.publicKey))!.signature!);
  tx.recentBlockhash = attacker.toBase58();
  tx.instructions.unshift(...budget());
  tx.partialSign(owner);
  assert.equal(tx.verifySignatures(), false, "the wallet's refresh invalidated the initial program signature");
  const ownerSignature = Buffer.from(tx.signature!);
  const checked = checkedDeploymentSignature(expected, tx, 900, [temporary]);
  assert.ok(checked.verifySignatures());
  assert.deepEqual(checked.signature, ownerSignature, "never replace the owner's signature");
  assert.notDeepEqual(checked.signatures.find(s => s.publicKey.equals(temporary.publicKey))!.signature, staleTemporarySignature);
  assert.equal(checked.lastValidBlockHeight, undefined);
  const badSignature = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  badSignature.signature![0] ^= 1;
  assert.throws(() => checkedDeploymentSignature(expected, badSignature, 900, [temporary]), /Signature verification failed/);
  badSignature.signatures.find(s => s.publicKey.equals(owner.publicKey))!.signature = null;
  assert.throws(() => checkedDeploymentSignature(expected, badSignature, 900, [temporary]), /wallet did not sign/);
  const extraTransfer = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  extraTransfer.add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: attacker, lamports: 1 }));
  extraTransfer.partialSign(owner);
  assert.throws(() => checkedDeploymentSignature(expected, extraTransfer, 900, [temporary]), /Wallet transaction blocked/);
  assert.throws(() => checkedDeploymentSignature(expected, tx, 900, [owner]), /Unexpected deployment co-signer/);
});
