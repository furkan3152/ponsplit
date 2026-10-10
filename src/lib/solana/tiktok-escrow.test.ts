import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey, SystemProgram, type AccountInfo } from "@solana/web3.js";
import {
  CREATOR_VAULT_SIZE,
  activateCreatorInstruction,
  bindCreatorInstruction,
  claimCreatorInstruction,
  creatorVault,
  creatorVaultClaimable,
  decodeCreatorVault,
  initCreatorVaultInstruction,
  normalizeCreatorHandle,
  type EscrowConfig,
} from "./tiktok-escrow";

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const config: EscrowConfig = { program: key(1), verifier: key(2) };
const beneficiary = key(3);
const identityHash = new Uint8Array(32).fill(7);
const handle = "real.creator";
const address = creatorVault(handle, config.program, config.verifier);

function account(verified = false): AccountInfo<Buffer> {
  const data = Buffer.alloc(CREATOR_VAULT_SIZE);
  const [, bump] = PublicKey.findProgramAddressSync([Buffer.from("creator"), config.verifier.toBuffer(), Buffer.from(handle)], config.program);
  data.write("TIKVAULT");
  data[8] = bump;
  data[9] = handle.length;
  data.write(handle, 10);
  config.verifier.toBuffer().copy(data, 34);
  if (verified) {
    beneficiary.toBuffer().copy(data, 66);
    Buffer.from(identityHash).copy(data, 98);
    data.writeBigUInt64LE(BigInt(123), 130);
  }
  return { owner: config.program, executable: false, lamports: 10_000, rentEpoch: 0, data };
}

test("vault handles normalize consistently and the verifier is an immutable address seed", () => {
  assert.equal(normalizeCreatorHandle(" @Real.Creator "), handle);
  assert.equal(normalizeCreatorHandle("https://www.tiktok.com/@Real.Creator"), handle);
  assert.ok(creatorVault(" @Real.Creator ", config.program, config.verifier).equals(address));
  assert.ok(!creatorVault(handle, config.program, key(9)).equals(address));
  for (const invalid of ["", "@", "creator.", "crea-tor", "a".repeat(25), "你好", "@@creator"]) {
    assert.throws(() => creatorVault(invalid, config.program, config.verifier));
  }
  assert.throws(() => creatorVault(handle, null, config.verifier), /not configured/);
  assert.throws(() => creatorVault(handle, config.program, null), /not configured/);
});

test("instruction bytes and signer privileges match the on-chain escrow ABI", () => {
  const init = initCreatorVaultInstruction(beneficiary, handle, config);
  assert.ok(init.programId.equals(config.program));
  assert.deepEqual(init.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]), [[true, true], [false, true], [false, false]]);
  assert.ok(init.keys[1].pubkey.equals(address));
  assert.ok(init.keys[2].pubkey.equals(SystemProgram.programId));
  assert.deepEqual(init.data, Buffer.concat([Buffer.from([0, handle.length]), Buffer.from(handle), config.verifier.toBuffer()]));
  const bind = bindCreatorInstruction(handle, beneficiary, identityHash, config);
  assert.deepEqual(bind.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]), [[true, false], [true, false], [false, true]]);
  assert.ok(bind.keys[0].pubkey.equals(config.verifier));
  assert.ok(bind.keys[1].pubkey.equals(beneficiary));
  assert.deepEqual(bind.data, Buffer.concat([Buffer.from([1]), Buffer.from(identityHash)]));
  const activate = activateCreatorInstruction(handle, beneficiary, identityHash, config);
  assert.deepEqual(activate.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]), [[false, false], [true, false], [false, true]]);
  assert.deepEqual(activate.data, bind.data);
  const claim = claimCreatorInstruction(handle, beneficiary, config);
  assert.deepEqual(claim.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]), [[true, true], [false, true]]);
  assert.ok(claim.keys[0].pubkey.equals(beneficiary));
  assert.ok(claim.keys[1].pubkey.equals(address));
  assert.deepEqual(claim.data, Buffer.from([2]));
  assert.throws(() => bindCreatorInstruction(handle, beneficiary, new Uint8Array(32), config));
  assert.throws(() => bindCreatorInstruction(handle, beneficiary, new Uint8Array(31), config));
  assert.throws(() => bindCreatorInstruction(handle, SystemProgram.programId, identityHash, config));
  assert.throws(() => bindCreatorInstruction(handle, config.verifier, identityHash, config));
  assert.throws(() => claimCreatorInstruction(handle, config.verifier, config));
});

test("decoder authenticates the owner, verifier, canonical PDA and complete layout", () => {
  const state = decodeCreatorVault(account(true), address, config);
  assert.ok(state);
  assert.equal(state.handle, handle);
  assert.ok(state.verifier.equals(config.verifier));
  assert.ok(state.beneficiary?.equals(beneficiary));
  assert.deepEqual(state.identityHash, identityHash);
  assert.equal(state.totalClaimed, BigInt(123));
  assert.equal(state.approved, false);
  assert.equal(state.verified, true);
  assert.equal(decodeCreatorVault(account(), address, config)?.beneficiary, null);
  assert.equal(decodeCreatorVault(account(), key(8), config), null);
  assert.equal(decodeCreatorVault(account(), address, { ...config, verifier: key(8) }), null);
  assert.equal(decodeCreatorVault({ ...account(), owner: SystemProgram.programId }, address, config), null);
  assert.equal(decodeCreatorVault({ ...account(), executable: true }, address, config), null);
  for (const change of [
    (data: Buffer) => { data[0] = 0; },
    (data: Buffer) => { data[8] ^= 1; },
    (data: Buffer) => { data[9] = 25; },
    (data: Buffer) => { data[10] = "R".charCodeAt(0); },
    (data: Buffer) => { data[10] = 255; },
    (data: Buffer) => { data[33] = 1; },
    (data: Buffer) => { data[98] = 1; },
    (data: Buffer) => { data[130] = 1; },
  ]) {
    const info = account();
    change(info.data);
    assert.equal(decodeCreatorVault(info, address, config), null);
  }
  const incomplete = account(true);
  incomplete.data.fill(0, 98, 130);
  assert.equal(decodeCreatorVault(incomplete, address, config), null);
  const authorityBeneficiary = account(true);
  config.verifier.toBuffer().copy(authorityBeneficiary.data, 66);
  assert.equal(decodeCreatorVault(authorityBeneficiary, address, config), null);
  assert.equal(decodeCreatorVault({ ...account(), data: Buffer.alloc(CREATOR_VAULT_SIZE + 1) }, address, config), null);
});

test("manual approval exposes its fixed beneficiary and identity hash while activation is pending", () => {
  const info = account(true);
  info.data.write("TIKAPPRV");
  info.data.writeBigUInt64LE(BigInt(0), 130);
  const state = decodeCreatorVault(info, address, config);
  assert.ok(state?.approved);
  assert.equal(state.verified, false);
  assert.ok(state.beneficiary?.equals(beneficiary));
  assert.deepEqual(state.identityHash, identityHash);
  info.data.writeBigUInt64LE(BigInt(1), 130);
  assert.equal(decodeCreatorVault(info, address, config), null);
  const unbound = account();
  unbound.data.write("TIKAPPRV");
  assert.equal(decodeCreatorVault(unbound, address, config), null);
});

test("balances reserve rent and expose only the permanently bound beneficiary", async () => {
  const info = account(true);
  const connection = {
    getAccountInfo: async (key: PublicKey) => { assert.ok(key.equals(address)); return info; },
    getMinimumBalanceForRentExemption: async (size: number) => { assert.equal(size, CREATOR_VAULT_SIZE); return 2_000; },
  };
  const balance = await creatorVaultClaimable(connection, handle, config);
  assert.deepEqual(balance, { account: address.toBase58(), claimable: BigInt(8_000), exists: true, beneficiary: beneficiary.toBase58(), totalClaimed: BigInt(123), identityHash, approved: false, verified: true });
  info.lamports = 1_000;
  assert.equal((await creatorVaultClaimable(connection, handle, config)).claimable, BigInt(0));
  info.lamports = Number.MAX_SAFE_INTEGER + 1;
  await assert.rejects(creatorVaultClaimable(connection, handle, config), /unsafe lamport/);
});

test("missing and prefunded vaults are uninitialized; foreign or corrupt accounts fail closed", async () => {
  let info: AccountInfo<Buffer> | null = null;
  const connection = {
    getAccountInfo: async () => info,
    getMinimumBalanceForRentExemption: async () => 2_000,
  };
  assert.deepEqual(await creatorVaultClaimable(connection, handle, config), { account: address.toBase58(), claimable: BigInt(0), exists: false, beneficiary: null, totalClaimed: BigInt(0), identityHash: new Uint8Array(32), approved: false, verified: false });
  info = { ...account(), owner: SystemProgram.programId, data: Buffer.alloc(0) };
  assert.deepEqual(await creatorVaultClaimable(connection, handle, config), { account: address.toBase58(), claimable: BigInt(8_000), exists: false, beneficiary: null, totalClaimed: BigInt(0), identityHash: new Uint8Array(32), approved: false, verified: false });
  info = { ...account(), owner: key(9) };
  await assert.rejects(creatorVaultClaimable(connection, handle, config), /invalid/);
  info = account();
  info.data[0] = 0;
  await assert.rejects(creatorVaultClaimable(connection, handle, config), /invalid/);
});
