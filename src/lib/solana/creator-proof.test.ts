import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Keypair, PublicKey, SystemProgram, type AccountInfo } from "@solana/web3.js";
import {
  CREATOR_PROOF_SIZE, CREATOR_PROOF_LIFETIME_SECONDS, approveCreatorProofInstruction,
  attachCreatorProofVideoInstruction, cancelCreatorProofInstruction, creatorProof,
  creatorProofHash, decodeCreatorProof, generateCreatorProofNonce, listCreatorProofs,
  parseTikTokProofVideo, proofChallenge, readCreatorProof, requestCreatorProofInstruction,
} from "./creator-proof";

const config = { program: Keypair.generate().publicKey, verifier: Keypair.generate().publicKey };
const beneficiary = Keypair.generate().publicKey;
const handle = "test.creator";
const nonce = new Uint8Array(16).fill(9);
const videoId = "7291234567890123456";

function fixture(createdAt = BigInt(Math.floor(Date.now() / 1000))) {
  const address = creatorProof(handle, beneficiary, config.program, config.verifier);
  const [, bump] = PublicKey.findProgramAddressSync([Buffer.from("proof"), config.verifier.toBuffer(), Buffer.from(handle), beneficiary.toBuffer()], config.program);
  const data = Buffer.alloc(CREATOR_PROOF_SIZE);
  Buffer.from("TIKPROOF").copy(data);
  data[8] = bump;
  data[9] = handle.length;
  Buffer.from(handle).copy(data, 10);
  config.verifier.toBuffer().copy(data, 34);
  beneficiary.toBuffer().copy(data, 66);
  Buffer.from(nonce).copy(data, 98);
  data.writeBigInt64LE(createdAt, 114);
  data[122] = videoId.length;
  Buffer.from(videoId).copy(data, 123);
  const info: AccountInfo<Buffer> = { owner: config.program, executable: false, data, lamports: 123, rentEpoch: 0 };
  return { address, info };
}

test("proof instructions preserve exact signer authority and bind approval to the reviewed snapshot hash", async () => {
  const request = requestCreatorProofInstruction("@Test.Creator", beneficiary, nonce, config);
  assert.equal(request.programId.toBase58(), config.program.toBase58());
  assert.deepEqual(request.data, Buffer.concat([Buffer.from([3, handle.length]), Buffer.from(handle), Buffer.from(nonce)]));
  assert.deepEqual(request.keys.map((key) => [key.isSigner, key.isWritable]), [[true, true], [false, true], [false, false], [false, false], [false, false]]);
  assert.ok(request.keys[3].pubkey.equals(config.verifier));
  assert.ok(request.keys[4].pubkey.equals(SystemProgram.programId));
  const attach = attachCreatorProofVideoInstruction(handle, beneficiary, videoId, config);
  assert.deepEqual(attach.data, Buffer.concat([Buffer.from([4, videoId.length]), Buffer.from(videoId)]));
  assert.deepEqual(attach.keys.map((key) => [key.isSigner, key.isWritable]), [[true, false], [false, true]]);
  const { info, address } = fixture();
  const proof = decodeCreatorProof(info, address, config)!;
  const hash = await creatorProofHash(proof);
  assert.deepEqual(Buffer.from(hash), createHash("sha256").update(info.data).digest());
  const approve = approveCreatorProofInstruction(handle, beneficiary, hash, config);
  assert.deepEqual(approve.data, Buffer.concat([Buffer.from([5]), Buffer.from(hash)]));
  assert.equal(approve.data.length, 33);
  assert.deepEqual(approve.keys.map((key) => [key.isSigner, key.isWritable]), [[true, false], [false, true], [false, true], [false, true]]);
  assert.ok(approve.keys[0].pubkey.equals(config.verifier));
  assert.ok(approve.keys[3].pubkey.equals(beneficiary));
  const cancel = cancelCreatorProofInstruction(handle, beneficiary, config);
  assert.deepEqual(cancel.data, Buffer.from([6]));
  assert.deepEqual(cancel.keys.map((key) => [key.isSigner, key.isWritable]), [[true, true], [false, true]]);
  assert.throws(() => requestCreatorProofInstruction(handle, config.verifier, nonce, config), /distinct/);
  assert.throws(() => requestCreatorProofInstruction(handle, beneficiary, new Uint8Array(16), config), /nonce/);
  assert.throws(() => approveCreatorProofInstruction(handle, beneficiary, new Uint8Array(32), config), /reviewed/);
});

test("caption challenge binds full beneficiary wallet and handle so public nonce copying cannot impersonate ownership", () => {
  const proof = { handle, beneficiary, nonce };
  const code = proofChallenge(proof);
  assert.equal(code, `TIK-${handle}-${beneficiary.toBase58()}-${"09".repeat(16)}`);
  const attacker = Keypair.generate().publicKey;
  assert.notEqual(proofChallenge({ ...proof, beneficiary: attacker }), code);
  assert.notEqual(proofChallenge({ ...proof, handle: "other.creator" }), code);
  assert.notEqual(proofChallenge({ ...proof, nonce: new Uint8Array(16).fill(10) }), code);
  assert.match(code, new RegExp(beneficiary.toBase58()));
  assert.equal(generateCreatorProofNonce().length, 16);
  assert.notDeepEqual(generateCreatorProofNonce(), generateCreatorProofNonce());
});

test("video URL accepts only the exact original account and canonical positive TikTok video ID", () => {
  assert.deepEqual(parseTikTokProofVideo(`https://www.tiktok.com/@Test.Creator/video/${videoId}`, handle), { videoId, url: `https://www.tiktok.com/@${handle}/video/${videoId}` });
  assert.deepEqual(parseTikTokProofVideo(`https://www.tiktok.com/@${handle}/video/${videoId}?_r=1&_t=tracking`, handle), { videoId, url: `https://www.tiktok.com/@${handle}/video/${videoId}` });
  for (const url of [
    `https://www.tiktok.com/@other.creator/video/${videoId}`,
    `https://www.tiktok.com/@${handle}/video/${videoId}#caption`,
    `http://www.tiktok.com/@${handle}/video/${videoId}`,
    `https://www.tiktok.com.evil.example/@${handle}/video/${videoId}`,
    `https://www.tiktok.com@evil.example/@${handle}/video/${videoId}`,
    `https://vm.tiktok.com/short-link`,
    `https://www.tiktok.com/%40${handle}/video/${videoId}`,
    `https://www.tiktok.com/@${handle}/video/0123`,
    `https://www.tiktok.com/@${handle}/video/0`,
    `https://www.tiktok.com/@${handle}/video/${"1".repeat(21)}`,
  ]) assert.throws(() => parseTikTokProofVideo(url, handle), undefined, url);
  for (const id of ["0", "001", "", "abc", "1".repeat(21)]) assert.throws(() => attachCreatorProofVideoInstruction(handle, beneficiary, id, config));
});

test("proof decoder validates owner, canonical PDA, verifier, nonzero nonce, ASCII padding and expiry", () => {
  const { info, address } = fixture();
  const proof = decodeCreatorProof(info, address, config)!;
  assert.equal(proof.account, address.toBase58());
  assert.equal(proof.handle, handle);
  assert.equal(proof.videoId, videoId);
  assert.equal(proof.expiresAt, proof.createdAt + CREATOR_PROOF_LIFETIME_SECONDS);
  assert.equal(proof.expired, false);
  assert.ok(Object.isFrozen(proof));
  assert.equal(decodeCreatorProof({ ...info, executable: true }, address, config), null);
  assert.equal(decodeCreatorProof({ ...info, owner: SystemProgram.programId }, address, config), null);
  assert.equal(decodeCreatorProof(info, Keypair.generate().publicKey, config), null);
  const bad = (mutate: (bytes: Buffer) => void) => { const data = Buffer.from(info.data); mutate(data); assert.equal(decodeCreatorProof({ ...info, data }, address, config), null); };
  bad((data) => { data[0] ^= 1; });
  bad((data) => { data[8] ^= 1; });
  bad((data) => { data[9] = 25; });
  bad((data) => { data[10 + handle.length] = 1; });
  bad((data) => { data[10] |= 128; });
  bad((data) => { data[34] ^= 1; });
  bad((data) => { config.verifier.toBuffer().copy(data, 66); });
  bad((data) => { data.fill(0, 98, 114); });
  bad((data) => { data.writeBigInt64LE(-1n, 114); });
  bad((data) => { data.writeBigInt64LE((1n << 63n) - 1n, 114); });
  bad((data) => { data[122] = 21; });
  bad((data) => { data[123] = 48; });
  bad((data) => { data[123] |= 128; });
  bad((data) => { data[142] = 1; });
  const expired = fixture(BigInt(Math.floor(Date.now() / 1000)) - CREATOR_PROOF_LIFETIME_SECONDS);
  assert.equal(decodeCreatorProof(expired.info, expired.address, config)?.expired, true);
  const snapshot = Uint8Array.from(proof.data);
  info.data[98] ^= 1;
  assert.deepEqual(proof.data, snapshot);
});

test("proof reads propagate RPC failure and reject malformed listed accounts instead of presenting valid evidence", async () => {
  const { info, address } = fixture();
  const empty = { getAccountInfo: async () => null };
  assert.equal(await readCreatorProof(empty, handle, beneficiary, config), null);
  const prefunded: AccountInfo<Buffer> = { owner: SystemProgram.programId, executable: false, data: Buffer.alloc(0), lamports: 50_000, rentEpoch: 0 };
  assert.equal(await readCreatorProof({ getAccountInfo: async () => prefunded }, handle, beneficiary, config), null);
  for (const malformed of [
    { ...prefunded, executable: true },
    { ...prefunded, data: Buffer.from([1]) },
    { ...prefunded, owner: Keypair.generate().publicKey },
  ]) await assert.rejects(() => readCreatorProof({ getAccountInfo: async () => malformed }, handle, beneficiary, config), /validated/);
  const read = { getAccountInfo: async () => info };
  assert.equal((await readCreatorProof(read, handle, beneficiary, config))?.account, address.toBase58());
  await assert.rejects(() => readCreatorProof({ getAccountInfo: async () => { throw new Error("RPC unavailable"); } }, handle, beneficiary, config), /RPC/);
  const listed = { getProgramAccounts: async () => [{ pubkey: address, account: info }] };
  assert.equal((await listCreatorProofs(listed, config)).length, 1);
  info.data[0] ^= 1;
  await assert.rejects(() => listCreatorProofs(listed, config), /validated/);
});
