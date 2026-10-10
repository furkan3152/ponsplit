import assert from "node:assert/strict";
import test from "node:test";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { assertVersionedMessage, checkedVersionedSignature } from "./versioned-signing.ts";

// Disposable signing keys used only for message validation; never funded or sent.
const owner = Keypair.generate();
const recipient = Keypair.generate().publicKey;
const other = Keypair.generate();
const oldHash = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const freshHash = new PublicKey(new Uint8Array(32).fill(8)).toBase58();
const budget = (units: number, microLamports: number) => [
  ComputeBudgetProgram.setComputeUnitLimit({ units }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
];
const transfer = () => SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: recipient, lamports: 42 });
const build = (instructions: TransactionInstruction[] = [transfer()], blockhash = oldHash, payer = owner.publicKey) => new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message());

test("v0 hash refresh and a bounded wallet fee preserve the verified owner signature", async () => {
  const expected = build().message.serialize();
  const returned = build([...budget(25000, 1000), transfer()], freshHash);
  returned.sign([owner]);
  const signature = Uint8Array.from(returned.signatures[0]);
  const checked = await checkedVersionedSignature(expected, returned);
  assert.equal(checked.message.recentBlockhash, freshHash);
  assert.deepEqual(checked.signatures[0], signature);
  assert.notEqual(checked, returned);
  returned.message.recentBlockhash = oldHash;
  assert.equal(checked.message.recentBlockhash, freshHash, "later adapter mutations cannot change the checked wire snapshot");
});

test("v0 original pump priority fees remain allowed while any higher fee is blocked", () => {
  const expected = build([...budget(400000, 50000), transfer()]).message.serialize();
  assert.doesNotThrow(() => assertVersionedMessage(expected, build([...budget(400000, 50000), transfer()], freshHash)));
  assert.doesNotThrow(() => assertVersionedMessage(expected, build([...budget(200000, 100000), transfer()], freshHash)));
  assert.throws(() => assertVersionedMessage(expected, build([...budget(400000, 50001), transfer()])), /20000 lamport limit/);
  const plain = build().message.serialize();
  assert.throws(() => assertVersionedMessage(plain, build([...budget(25000, 200001), transfer()])), /5000 lamport limit/);
});

test("v0 price-only pump transaction uses its instruction-based default CU allowance", () => {
  const expected = build([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }), transfer()]).message.serialize();
  assert.doesNotThrow(() => assertVersionedMessage(expected, build([...budget(200000, 50000), transfer()])));
  assert.throws(() => assertVersionedMessage(expected, build([...budget(400000, 50000), transfer()])), /10000 lamport limit/);
});

test("v0 exact recipients, transfer values, data, privileges, signers and instruction ordering are enforced", () => {
  const instruction = new TransactionInstruction({ programId: recipient, keys: [{ pubkey: owner.publicKey, isSigner: true, isWritable: true }, { pubkey: other.publicKey, isSigner: false, isWritable: true }], data: Buffer.from([1, 80, 20]) });
  const expected = build([instruction, transfer()]).message.serialize();
  const variants = [
    build([instruction, SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: other.publicKey, lamports: 42 })]),
    build([instruction, SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: recipient, lamports: 43 })]),
    build([instruction, transfer(), SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: other.publicKey, lamports: 1 })]),
    build([new TransactionInstruction({ ...instruction, data: Buffer.from([1, 20, 80]) }), transfer()]),
    build([new TransactionInstruction({ ...instruction, keys: instruction.keys.map(key => key.pubkey.equals(other.publicKey) ? { ...key, isWritable: false } : key) }), transfer()]),
    build([instruction, transfer()], oldHash, other.publicKey),
    build([transfer(), instruction]),
  ];
  for (const returned of variants) assert.throws(() => assertVersionedMessage(expected, returned), /Wallet transaction blocked/);
});

test("v0 fee instructions cannot add account access, duplicate settings or unsupported operations", () => {
  const expected = build().message.serialize();
  const invalid = [
    [...budget(25000, 1000), ...budget(25000, 1000), transfer()],
    [new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [{ pubkey: recipient, isSigner: false, isWritable: true }], data: Buffer.from([2, 1, 0, 0, 0]) }), transfer()],
    [new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [], data: Buffer.from([1, 0, 0, 0, 0]) }), transfer()],
    [...budget(1400001, 1), transfer()],
    [...budget(0, 1), transfer()],
  ];
  for (const instructions of invalid) assert.throws(() => assertVersionedMessage(expected, build(instructions)), /Wallet transaction blocked/);
});

test("v0 refreshed mint co-signature is added only after validating the wallet's exact signature", async () => {
  const mint = Keypair.generate();
  const instruction = SystemProgram.createAccount({ fromPubkey: owner.publicKey, newAccountPubkey: mint.publicKey, lamports: 1000, space: 82, programId: SystemProgram.programId });
  const returned = build([instruction]);
  returned.sign([mint]);
  const expected = Uint8Array.from(returned.message.serialize());
  const oldMintSignature = Uint8Array.from(returned.signatures[1]);
  returned.message.recentBlockhash = freshHash;
  returned.sign([owner]);
  const ownerSignature = Uint8Array.from(returned.signatures[0]);
  const checked = await checkedVersionedSignature(expected, returned, [mint]);
  assert.deepEqual(checked.signatures[0], ownerSignature);
  assert.notDeepEqual(checked.signatures[1], oldMintSignature);
  await checkedVersionedSignature(checked.message.serialize(), checked);
  await assert.rejects(checkedVersionedSignature(expected, returned), /signature verification failed/);
  await assert.rejects(checkedVersionedSignature(expected, returned, [owner]), /unexpected local co-signer/);
  await assert.rejects(checkedVersionedSignature(expected, returned, [other]), /unexpected local co-signer/);
  returned.signatures[0][0] ^= 1;
  await assert.rejects(checkedVersionedSignature(expected, returned, [mint]), /signature verification failed/);
});

test("v0 missing signatures and address lookup changes are blocked", async () => {
  const expected = build().message.serialize();
  await assert.rejects(checkedVersionedSignature(expected, build()), /required wallet signature is missing/);
  const lookup = build();
  if (lookup.message.version !== 0) throw new Error("test requires v0");
  lookup.message.addressTableLookups.push({ accountKey: other.publicKey, readonlyIndexes: [], writableIndexes: [] });
  assert.throws(() => assertVersionedMessage(expected, lookup), /address lookup table/);
});

test("v0 verification works in mobile environments without WebCrypto Ed25519", async () => {
  const returned = build();
  returned.sign([owner]);
  const expected = returned.message.serialize();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  try {
    await checkedVersionedSignature(expected, returned);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
  }
});

test("v0 strict verification rejects small-order public keys and noncanonical signature scalars", async () => {
  const identity = new PublicKey(Uint8Array.from([1, ...new Uint8Array(31)]));
  const forged = build([SystemProgram.transfer({ fromPubkey: identity, toPubkey: recipient, lamports: 42 })], oldHash, identity);
  forged.signatures[0] = Uint8Array.from([1, ...new Uint8Array(63)]);
  await assert.rejects(checkedVersionedSignature(forged.message.serialize(), forged), /signature verification failed/);
  const noncanonical = build();
  noncanonical.sign([owner]);
  noncanonical.signatures[0].fill(255, 32);
  await assert.rejects(checkedVersionedSignature(noncanonical.message.serialize(), noncanonical), /signature verification failed/);
});
