import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PublicKey, SystemProgram, Transaction, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  ESCROW_ARTIFACT_MANIFEST, UPGRADEABLE_LOADER, WRITE_CHUNK_SIZE, MAX_ARTIFACT_BYTES,
  initializeBufferInstruction, writeBufferInstruction, deployProgramInstruction, closeBufferInstruction,
  programDataAddress, validateEscrowArtifact, deployEscrowProgram, closeDeploymentBuffer, assertDeploymentNetwork,
  type ProgramArtifact,
} from "./program-deploy";
import { ADMIN_WALLET } from "../admin-config";

const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const buffer = key(1), program = key(2), authority = key(3);
const artifact: ProgramArtifact = { bytes: readFileSync(new URL("../../../public/programs/tiktok-escrow.so", import.meta.url)), manifest: ESCROW_ARTIFACT_MANIFEST };

test("public SBF artifact is hash-pinned to the compiled frontend and source manifest", async () => {
  await validateEscrowArtifact(artifact);
  const bytes = Uint8Array.from(artifact.bytes);
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(validateEscrowArtifact({ ...artifact, bytes }), /integrity/);
  await assert.rejects(validateEscrowArtifact({ ...artifact, bytes: artifact.bytes.subarray(0, artifact.bytes.length - 1) }), /integrity/);
  await assert.rejects(validateEscrowArtifact({ ...artifact, manifest: { ...artifact.manifest, sha256: "0".repeat(64) } }), /integrity/);
  await assert.rejects(validateEscrowArtifact({ ...artifact, manifest: { ...artifact.manifest, sourceSha256: "0".repeat(64) } }), /integrity/);
});

test("upgradeable-loader instruction ABI preserves admin buffer/deploy/close authority", () => {
  const init = initializeBufferInstruction(buffer, authority);
  assert.ok(init.programId.equals(UPGRADEABLE_LOADER));
  assert.deepEqual(init.data, Buffer.alloc(4));
  assert.deepEqual(init.keys.map(({ isWritable, isSigner }) => [isWritable, isSigner]), [[true, false], [false, false]]);
  const write = writeBufferInstruction(buffer, authority, 123, Uint8Array.from([4, 5, 6]));
  assert.equal(write.data.readUInt32LE(0), 1);
  assert.equal(write.data.readUInt32LE(4), 123);
  assert.equal(write.data.readBigUInt64LE(8), BigInt(3));
  assert.deepEqual(write.data.subarray(16), Buffer.from([4, 5, 6]));
  assert.deepEqual(write.keys.map(({ isWritable, isSigner }) => [isWritable, isSigner]), [[true, false], [false, true]]);
  const deploy = deployProgramInstruction(program, buffer, authority, artifact.bytes.length);
  assert.equal(deploy.data.readUInt32LE(0), 2);
  assert.equal(deploy.data.readBigUInt64LE(4), BigInt(artifact.bytes.length));
  assert.ok(deploy.keys[1].pubkey.equals(programDataAddress(program)));
  assert.ok(deploy.keys[2].pubkey.equals(program));
  assert.ok(deploy.keys[3].pubkey.equals(buffer));
  assert.ok(deploy.keys[4].pubkey.equals(SYSVAR_RENT_PUBKEY));
  assert.ok(deploy.keys[5].pubkey.equals(SYSVAR_CLOCK_PUBKEY));
  assert.ok(deploy.keys[6].pubkey.equals(SystemProgram.programId));
  assert.ok(deploy.keys[0].pubkey.equals(authority) && deploy.keys[0].isSigner);
  assert.ok(deploy.keys[7].pubkey.equals(authority) && deploy.keys[7].isSigner);
  const close = closeBufferInstruction(buffer, authority);
  assert.equal(close.data.readUInt32LE(0), 5);
  assert.ok(close.keys[1].pubkey.equals(authority) && close.keys[1].isWritable);
  assert.ok(close.keys[2].pubkey.equals(authority) && close.keys[2].isSigner);
});

test("write/deploy builders enforce packet and artifact bounds", () => {
  const tx = new Transaction({ feePayer: authority, recentBlockhash: SystemProgram.programId.toBase58() }).add(writeBufferInstruction(buffer, authority, 0, new Uint8Array(WRITE_CHUNK_SIZE)));
  assert.ok(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232);
  for (const [offset, size] of [[-1, 1], [0, 0], [0, WRITE_CHUNK_SIZE + 1], [MAX_ARTIFACT_BYTES, 1], [0.5, 1]]) {
    assert.throws(() => writeBufferInstruction(buffer, authority, offset, new Uint8Array(size)));
  }
  for (const size of [0, artifact.bytes.length - 1, MAX_ARTIFACT_BYTES + 1, NaN]) assert.throws(() => deployProgramInstruction(program, buffer, authority, size));
  assert.throws(() => closeBufferInstruction(authority, authority));
});

test("non-admin wallets are rejected before RPC access, signing, or artifact deployment", async () => {
  const unauthorized = ADMIN_WALLET.equals(authority) ? program : authority;
  const wallet = { publicKey: unauthorized, signTransaction: async () => { assert.fail("unauthorized wallet must not be asked to sign"); } };
  // No RPC double is needed: authorization must reject before dereferencing connection.
  await assert.rejects(deployEscrowProgram({ connection: null!, wallet, artifact }), /configured admin/);
  await assert.rejects(closeDeploymentBuffer({ connection: null!, wallet, buffer }), /configured admin/);
});

test("deployment network accepts the complete mainnet genesis hash and rejects a truncated identifier", async () => {
  // Full hash read from the official mainnet RPC, independent of application constants.
  const rpc = { rpcEndpoint: "https://api.mainnet-beta.solana.com", getGenesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" };
  await assertDeploymentNetwork(rpc as never);
  rpc.getGenesisHash = async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  await assert.rejects(assertDeploymentNetwork(rpc as never), /mainnet/);
  rpc.getGenesisHash = async () => SystemProgram.programId.toBase58();
  await assert.rejects(assertDeploymentNetwork(rpc as never), /mainnet/);
});
