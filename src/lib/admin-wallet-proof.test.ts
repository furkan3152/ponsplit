import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";

// Test-only authority; no production admin private key is read or stored.
const pair = generateKeyPairSync("ed25519");
const wallet = new PublicKey(pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
process.env.NEXT_PUBLIC_TIKSPLIT_ADMIN_WALLET = wallet.toBase58();
const { ADMIN_WALLET_PROOF_MILLISECONDS, createAdminWalletChallenge, verifyAdminWalletProof, isAdminWalletProofValid } = await import("./admin-wallet-proof");
const origin = "https://admin.example";
const signed = (message: string) => Uint8Array.from(sign(null, Buffer.from(message), pair.privateKey));

test("local admin proof verifies the exact wallet and stays in memory for at most 15 minutes", async () => {
  const challenge = createAdminWalletChallenge(origin);
  assert.equal(challenge.expiresAt - challenge.issuedAt, ADMIN_WALLET_PROOF_MILLISECONDS);
  assert.match(challenge.nonce, /^[a-f0-9]{64}$/);
  assert.notEqual(challenge.nonce, createAdminWalletChallenge(origin).nonce);
  const proof = await verifyAdminWalletProof(challenge, wallet, signed(challenge.message), origin);
  assert.equal(isAdminWalletProofValid(proof, wallet, origin), true);
  assert.equal(isAdminWalletProofValid({ ...proof }, wallet, origin), false);
  assert.equal(isAdminWalletProofValid(proof, PublicKey.default, origin), false);
  assert.equal(isAdminWalletProofValid(proof, wallet, "https://another.example"), false);
  assert.ok(Object.isFrozen(proof));
  assert.ok(Object.isFrozen(challenge));
  await assert.rejects(() => verifyAdminWalletProof(challenge, wallet, signed(challenge.message), origin), /fresh/);
});

test("local challenge rejects forged objects, wrong context, invalid signatures, and concurrent replays", async () => {
  const challenge = createAdminWalletChallenge(origin);
  await assert.rejects(() => verifyAdminWalletProof({ ...challenge }, wallet, signed(challenge.message), origin), /fresh/);
  await assert.rejects(() => verifyAdminWalletProof(challenge, PublicKey.default, signed(challenge.message), origin), /exact configured/);
  await assert.rejects(() => verifyAdminWalletProof(challenge, wallet, signed(challenge.message), "https://evil.example"), /fresh/);
  const otherPurpose = signed(challenge.message.replace("TikSplit local admin controls v1", "TikSplit admin sign-in"));
  await assert.rejects(() => verifyAdminWalletProof(challenge, wallet, otherPurpose, origin), /signature/);
  const next = createAdminWalletChallenge(origin);
  const results = await Promise.allSettled([verifyAdminWalletProof(next, wallet, signed(next.message), origin), verifyAdminWalletProof(next, wallet, signed(next.message), origin)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("local proof rejects expired challenges and expired unlocked controls", async (t) => {
  const original = Date.now;
  t.after(() => { Date.now = original; });
  const now = original();
  Date.now = () => now;
  const challenge = createAdminWalletChallenge(origin);
  const proof = await verifyAdminWalletProof(challenge, wallet, signed(challenge.message), origin);
  const pending = createAdminWalletChallenge(origin);
  Date.now = () => now + ADMIN_WALLET_PROOF_MILLISECONDS;
  assert.equal(isAdminWalletProofValid(proof, wallet, origin), false);
  await assert.rejects(() => verifyAdminWalletProof(pending, wallet, signed(pending.message), origin), /fresh/);
  assert.throws(() => createAdminWalletChallenge("http://admin.example"), /HTTPS/);
});
