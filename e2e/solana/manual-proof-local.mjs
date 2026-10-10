// Native pump.fun + signed video-proof lifecycle on a real LOCAL validator. No actual identity claim.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ComputeBudgetProgram, Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const connection = new Connection(process.env.RPC || "http://127.0.0.1:8899", "confirmed");
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection.rpcEndpoint).hostname)) throw new Error("Disposable proof-test keys require a local validator.");
if (!process.env.NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID) throw new Error("Set the public local escrow program address.");
const admin = Keypair.generate(), owner = Keypair.generate(), attacker = Keypair.generate(), launcher = Keypair.generate(), mint = Keypair.generate();
process.env.NEXT_PUBLIC_TIKSPLIT_ADMIN_WALLET = admin.publicKey.toBase58();
process.env.NEXT_PUBLIC_SPLIDEV_TREASURY = admin.publicKey.toBase58();
process.env.NEXT_PUBLIC_TIKSPLIT_VERIFIER = admin.publicKey.toBase58();
const require = createRequire(import.meta.url);
const lib = require("./.build/lib.cjs");
const handle = "video.local";

async function tx(payer, instructions) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  return { transaction: new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message()), blockhash, lastValidBlockHeight };
}
async function send(payer, instructions) {
  const built = await tx(payer, instructions);
  built.transaction.sign([payer]);
  const signature = await connection.sendRawTransaction(built.transaction.serialize());
  assert.equal((await connection.confirmTransaction({ signature, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight }, "confirmed")).value.err, null);
  return signature;
}
async function rejects(payer, instructions) {
  const built = await tx(payer, instructions);
  built.transaction.sign([payer]);
  assert.ok((await connection.simulateTransaction(built.transaction, { sigVerify: true })).value.err, "unauthorized or stale proof instruction must fail");
}
for (const wallet of [admin, owner, attacker, launcher]) {
  const signature = await connection.requestAirdrop(wallet.publicKey, 20_000_000_000);
  await connection.confirmTransaction(signature, "confirmed");
}
const create = await lib.createTransaction(connection, { user: launcher.publicKey, mint: mint.publicKey, name: "Manual Video Local", symbol: "VID", uri: "https://example.com/local-video.json", firstBuyLamports: 100_000_000n });
create.sign([launcher, mint]);
await connection.confirmTransaction(await connection.sendRawTransaction(create.serialize()), "confirmed");
for (const finalize of await lib.finishTikTokLaunchTransactions(connection, launcher.publicKey, mint.publicKey, handle, 0)) {
  finalize.sign([launcher]);
  const signature = await connection.sendRawTransaction(finalize.serialize());
  assert.equal((await connection.confirmTransaction(signature, "confirmed")).value.err, null);
}
const trade = await lib.buyTransaction(connection, launcher.publicKey, mint.publicKey, 1_000_000_000n);
trade.tx.sign([launcher]);
await connection.confirmTransaction(await connection.sendRawTransaction(trade.tx.serialize()), "confirmed");
const adminBefore = BigInt(await connection.getBalance(admin.publicKey));
const distribute = await lib.distributeTransaction(connection, launcher.publicKey, mint.publicKey);
distribute.sign([launcher]);
await connection.confirmTransaction(await connection.sendRawTransaction(distribute.serialize()), "confirmed");
const fees = await lib.creatorVaultClaimable(connection, handle);
const platformReceived = BigInt(await connection.getBalance(admin.publicKey)) - adminBefore;
assert.ok(fees.claimable > 0n && platformReceived > 0n);
assert.ok(fees.claimable >= platformReceived * 4n && fees.claimable <= platformReceived * 4n + 5n);
assert.equal(fees.verified, false);
await rejects(attacker, [lib.claimCreatorInstruction(handle, attacker.publicKey)]);
console.log("PASS: actual pump.fun 20/80 distribution to admin and locked creator vault");

const nonce = lib.generateCreatorProofNonce();
// A third party can fund any PDA: both the reader and native initializer must remain usable.
await send(attacker, [SystemProgram.transfer({ fromPubkey: attacker.publicKey, toPubkey: lib.creatorProof(handle, owner.publicKey), lamports: await connection.getMinimumBalanceForRentExemption(0) })]);
assert.equal(await lib.readCreatorProof(connection, handle, owner.publicKey), null);
await send(owner, [lib.requestCreatorProofInstruction(handle, owner.publicKey, nonce)]);
const pending = await lib.readCreatorProof(connection, handle, owner.publicKey);
assert.ok(pending && pending.videoId === null && pending.beneficiary.equals(owner.publicKey));
const code = lib.proofChallenge(pending);
const copiedCode = lib.proofChallenge({ ...pending, beneficiary: attacker.publicKey });
assert.notEqual(code, copiedCode, "copying a public nonce cannot copy another wallet's caption code");
assert.ok(code.includes(owner.publicKey.toBase58()) && code.includes(handle));
const wrongAttacher = lib.attachCreatorProofVideoInstruction(handle, owner.publicKey, "1234567890123456789");
wrongAttacher.keys[0].pubkey = attacker.publicKey;
await rejects(attacker, [wrongAttacher]);
await send(owner, [lib.attachCreatorProofVideoInstruction(handle, owner.publicKey, "1234567890123456789")]);
const reviewed = await lib.readCreatorProof(connection, handle, owner.publicKey);
const hash = await lib.creatorProofHash(reviewed);
const wrongAuthority = lib.approveCreatorProofInstruction(handle, owner.publicKey, hash);
wrongAuthority.keys[0].pubkey = attacker.publicKey;
await rejects(attacker, [wrongAuthority]);
console.log("PASS: wallet-bound public code, signed video attachment and admin-only approval");

// The admin signature must pin the exact request reviewed before opening the wallet.
await send(owner, [lib.attachCreatorProofVideoInstruction(handle, owner.publicKey, "2234567890123456789")]);
await rejects(admin, [lib.approveCreatorProofInstruction(handle, owner.publicKey, hash)]);
await send(owner, [lib.cancelCreatorProofInstruction(handle, owner.publicKey)]);
await send(owner, [lib.requestCreatorProofInstruction(handle, owner.publicKey, lib.generateCreatorProofNonce()), lib.attachCreatorProofVideoInstruction(handle, owner.publicKey, "1234567890123456789")]);
await rejects(admin, [lib.approveCreatorProofInstruction(handle, owner.publicKey, hash)]);
const current = await lib.readCreatorProof(connection, handle, owner.publicKey);
const currentHash = await lib.creatorProofHash(current);
const refundableRent = BigInt((await connection.getAccountInfo(lib.creatorProof(handle, owner.publicKey))).lamports);
const ownerBeforeApproval = BigInt(await connection.getBalance(owner.publicKey));
await send(admin, [lib.approveCreatorProofInstruction(handle, owner.publicKey, currentHash)]);
assert.equal(await lib.readCreatorProof(connection, handle, owner.publicKey), null);
assert.equal(BigInt(await connection.getBalance(owner.publicKey)) - ownerBeforeApproval, refundableRent);
const approved = await lib.creatorVaultClaimable(connection, handle);
assert.equal(approved.approved, true);
assert.equal(approved.verified, false);
assert.equal(approved.beneficiary, owner.publicKey.toBase58());
assert.equal((await lib.listCoins(connection)).find(x => x.token === mint.publicKey.toBase58()).recipients[0].verified, false);
await rejects(owner, [lib.claimCreatorInstruction(handle, owner.publicKey)]);
await rejects(attacker, [lib.activateCreatorInstruction(handle, attacker.publicKey, approved.identityHash)]);
const wrongIdentity = Uint8Array.from(approved.identityHash); wrongIdentity[0] ^= 1;
await rejects(owner, [lib.activateCreatorInstruction(handle, owner.publicKey, wrongIdentity)]);
console.log("PASS: stale video/nonce approvals rejected, approval refunds request rent, pending approval cannot claim");

const ownerBeforeClaim = BigInt(await connection.getBalance(owner.publicKey));
const receipt = await send(owner, [lib.activateCreatorInstruction(handle, owner.publicKey, approved.identityHash), lib.claimCreatorInstruction(handle, owner.publicKey)]);
const onchain = await connection.getTransaction(receipt, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
const active = await lib.creatorVaultClaimable(connection, handle);
assert.equal(active.verified, true);
assert.equal(active.approved, false);
assert.equal(active.claimable, 0n);
assert.equal(active.totalClaimed, approved.claimable);
assert.equal(BigInt(await connection.getBalance(owner.publicKey)) - ownerBeforeClaim, approved.claimable - BigInt(onchain.meta.fee));
const adminClaim = lib.claimCreatorInstruction(handle, owner.publicKey); adminClaim.keys[0].pubkey = admin.publicKey;
await rejects(admin, [adminClaim]);
await rejects(attacker, [lib.requestCreatorProofInstruction(handle, attacker.publicKey, lib.generateCreatorProofNonce())]);
console.log("PASS: only approved creator activates and claims, exact money ledger, admin cannot claim creator funds");

const cancelHandle = "cancel.local";
await send(attacker, [SystemProgram.transfer({ fromPubkey: attacker.publicKey, toPubkey: lib.creatorProof(cancelHandle, owner.publicKey), lamports: 3_000_000 })]);
assert.equal(await lib.readCreatorProof(connection, cancelHandle, owner.publicKey), null);
await send(owner, [lib.initCreatorVaultInstruction(owner.publicKey, cancelHandle), lib.requestCreatorProofInstruction(cancelHandle, owner.publicKey, lib.generateCreatorProofNonce())]);
const cancelAddress = lib.creatorProof(cancelHandle, owner.publicKey);
const cancelRent = BigInt((await connection.getAccountInfo(cancelAddress)).lamports);
assert.equal(cancelRent, 3_000_000n, "overfunded proof keeps every refundable lamport");
const wrongCanceler = lib.cancelCreatorProofInstruction(cancelHandle, owner.publicKey);
wrongCanceler.keys[0].pubkey = attacker.publicKey;
await rejects(attacker, [wrongCanceler]);
const beforeCancel = BigInt(await connection.getBalance(owner.publicKey));
const cancelReceipt = await send(owner, [lib.cancelCreatorProofInstruction(cancelHandle, owner.publicKey)]);
const cancelTransaction = await connection.getTransaction(cancelReceipt, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
assert.equal(await connection.getAccountInfo(cancelAddress), null);
assert.equal(BigInt(await connection.getBalance(owner.publicKey)) - beforeCancel, cancelRent - BigInt(cancelTransaction.meta.fee));
console.log("PASS: prefunded proof PDAs stay usable; only creator cancels and recovers all rent minus actual fee");

// Wallets may refresh a blockhash and select a bounded priority fee while signing.
// Exercise the production checker and exact signed-ID sender against real accounts.
async function refreshedWalletTransaction(payer, instructions, { originalTransaction, ephemeralSigners = [], units = 100_000 } = {}) {
  const built = originalTransaction
    ? { transaction: originalTransaction, blockhash: originalTransaction.message.recentBlockhash }
    : await tx(payer, instructions);
  if (ephemeralSigners.length) built.transaction.sign(ephemeralSigners);
  const expectedMessage = Uint8Array.from(built.transaction.message.serialize());
  let freshHash = built.blockhash;
  for (let attempt = 0; freshHash === built.blockhash; attempt++) {
    assert.ok(attempt < 80, "the real validator must produce a fresh blockhash");
    freshHash = (await connection.getLatestBlockhash("processed")).blockhash;
    if (freshHash === built.blockhash) await new Promise(resolve => setTimeout(resolve, 50));
  }
  const returned = new VersionedTransaction(new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: freshHash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
      ...instructions,
    ],
  }).compileToV0Message());
  for (const signer of ephemeralSigners) {
    const previousIndex = built.transaction.message.staticAccountKeys.findIndex(key => key.equals(signer.publicKey));
    const nextIndex = returned.message.staticAccountKeys.findIndex(key => key.equals(signer.publicKey));
    // Copy the old partial signature to reproduce a wallet refreshing the hash
    // while retaining the now-invalid local mint signature.
    returned.signatures[nextIndex] = Uint8Array.from(built.transaction.signatures[previousIndex]);
  }
  returned.sign([payer]);
  const checked = await lib.checkedVersionedSignature(expectedMessage, returned, ephemeralSigners);
  for (const signer of ephemeralSigners) {
    const index = returned.message.staticAccountKeys.findIndex(key => key.equals(signer.publicKey));
    assert.notDeepEqual(checked.signatures[index], returned.signatures[index], "the stale local signature must be refreshed after verifying the wallet signature");
  }
  let savedSignature;
  const signature = await lib.sendCheckedVersionedTransaction(connection, checked, id => { savedSignature = id; });
  assert.equal(signature, savedSignature, "the exact wallet-signed ID is recorded before sending and confirmed afterward");
  return signature;
}

const mobileHandle = "mobile.local";
await refreshedWalletTransaction(owner, [
  lib.initCreatorVaultInstruction(owner.publicKey, mobileHandle),
  lib.requestCreatorProofInstruction(mobileHandle, owner.publicKey, lib.generateCreatorProofNonce()),
  lib.attachCreatorProofVideoInstruction(mobileHandle, owner.publicKey, "1234567890123456789"),
]);
const mobileProof = await lib.readCreatorProof(connection, mobileHandle, owner.publicKey);
assert.ok(mobileProof?.beneficiary.equals(owner.publicKey));
const expectedApproval = lib.approveCreatorProofInstruction(mobileHandle, owner.publicKey, await lib.creatorProofHash(mobileProof));
const expected = await tx(admin, [expectedApproval]);
const expectedMessage = Uint8Array.from(expected.transaction.message.serialize());
const changedApproval = lib.approveCreatorProofInstruction(mobileHandle, owner.publicKey, await lib.creatorProofHash(mobileProof));
changedApproval.keys[3].pubkey = attacker.publicKey;
const malicious = await tx(admin, [changedApproval]);
malicious.transaction.sign([admin]);
const ownerBeforeMutation = BigInt(await connection.getBalance(owner.publicKey));
const adminBeforeMutation = BigInt(await connection.getBalance(admin.publicKey));
await assert.rejects(lib.checkedVersionedSignature(expectedMessage, malicious.transaction), /Wallet transaction blocked/);
assert.equal(BigInt(await connection.getBalance(owner.publicKey)), ownerBeforeMutation);
assert.equal(BigInt(await connection.getBalance(admin.publicKey)), adminBeforeMutation);
assert.equal((await lib.creatorVaultClaimable(connection, mobileHandle)).beneficiary, null);

const mobileRent = BigInt((await connection.getAccountInfo(lib.creatorProof(mobileHandle, owner.publicKey))).lamports);
const mobileBeforeCancel = BigInt(await connection.getBalance(owner.publicKey));
const mobileCancelSignature = await refreshedWalletTransaction(owner, [lib.cancelCreatorProofInstruction(mobileHandle, owner.publicKey)]);
const mobileCancelReceipt = await connection.getTransaction(mobileCancelSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
assert.equal(mobileCancelReceipt.meta.fee, 6_000, "the bounded wallet priority fee is charged exactly once");
assert.equal(BigInt(await connection.getBalance(owner.publicKey)) - mobileBeforeCancel, mobileRent - BigInt(mobileCancelReceipt.meta.fee));
assert.equal(await lib.readCreatorProof(connection, mobileHandle, owner.publicKey), null);
console.log("PASS: refreshed wallet blockhash and bounded fee, changed beneficiary blocked before broadcast, exact signed-ID refund");

// Actual pump.fun mint creation requires both the wallet and a temporary mint
// signature. The production checker refreshes only the latter after hash changes.
const mobileMint = Keypair.generate();
const mobileUri = "https://example.com/mobile-local.json";
const withoutCompute = transaction => TransactionMessage.decompile(transaction.message).instructions.filter(ix => !ix.programId.equals(ComputeBudgetProgram.programId));
const originalCreate = await lib.createTikTokTransaction(connection, {
  user: owner.publicKey, mint: mobileMint.publicKey, name: "Mobile Native Test", symbol: "MOB", uri: mobileUri,
});
await refreshedWalletTransaction(owner, withoutCompute(originalCreate), { originalTransaction: originalCreate, ephemeralSigners: [mobileMint], units: 400_000 });
assert.ok((await connection.getAccountInfo(mobileMint.publicKey)).owner.equals(require("@solana/spl-token").TOKEN_2022_PROGRAM_ID));
for (const finalize of await lib.finishTikTokLaunchTransactions(connection, owner.publicKey, mobileMint.publicKey, mobileHandle, 0)) {
  await refreshedWalletTransaction(owner, withoutCompute(finalize), { originalTransaction: finalize, units: 400_000 });
}
assert.equal(await lib.tikTokLaunchState(connection, mobileMint.publicKey, { handle: mobileHandle, launcher: owner.publicKey, launcherBps: 0, metadataUri: mobileUri }), "done");
const mobileBuy = await lib.buyTransaction(connection, owner.publicKey, mobileMint.publicKey, 10_000_000n);
await refreshedWalletTransaction(owner, withoutCompute(mobileBuy.tx), { originalTransaction: mobileBuy.tx, units: 400_000 });
const { OnlinePumpSdk } = require("@pump-fun/pump-sdk");
assert.ok((await new OnlinePumpSdk(connection).fetchBondingCurve(mobileMint.publicKey)).realQuoteReserves.gtn(0));
console.log("PASS: actual native mint co-signature refreshed, permanent split finalized and 0.01 SOL buy confirmed via checked wallet IDs");
