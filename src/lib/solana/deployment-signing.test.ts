import assert from "node:assert/strict";
import test from "node:test";
import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { assertDeploymentMessage } from "./deployment-signing.ts";
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

test("refund recipient, upload bytes, transfers, blockhash and account privileges remain immutable", () => {
  const mutations = [
    (tx: Transaction) => { tx.instructions[0].keys[1].pubkey = attacker; },
    (tx: Transaction) => { tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: attacker, lamports: 1 })); },
    (tx: Transaction) => { tx.recentBlockhash = attacker.toBase58(); },
    (tx: Transaction) => { tx.feePayer = attacker; },
    (tx: Transaction) => { tx.instructions[0].keys[0].isWritable = false; },
    (tx: Transaction) => { tx.instructions[0].data[0] = 1; },
    (tx: Transaction) => { tx.instructions.unshift(...budget(), ...budget()); },
    (tx: Transaction) => { tx.instructions.unshift(new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [], data: Buffer.from([1, 0, 0, 0, 0]) })); },
  ];
  for (const mutate of mutations) { const tx = base(); const before = tx.serializeMessage(); mutate(tx); assert.throws(() => assertDeploymentMessage(before, tx), /Wallet transaction blocked/); }
});
