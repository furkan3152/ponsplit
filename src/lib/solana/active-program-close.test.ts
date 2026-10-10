import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PublicKey, SystemProgram, type AccountInfo, type Connection } from "@solana/web3.js";
import { ADMIN_WALLET, MAINNET_GENESIS_HASH } from "../admin-config";
import { ESCROW_PROGRAM_ID, VERIFIER } from "../tiktok-config";
import {
  ESCROW_ARTIFACT_MANIFEST, UPGRADEABLE_LOADER, programDataAddress,
  closeActiveProgram, quoteActiveProgramRefund, quoteUnusedProgramRefund,
  type ProgramArtifact,
} from "./program-deploy";

const program = ESCROW_PROGRAM_ID!;
const artifact: ProgramArtifact = { bytes: readFileSync(new URL("../../../public/programs/tiktok-escrow.so", import.meta.url)), manifest: ESCROW_ARTIFACT_MANIFEST };
const rent = 1_351_280;

function fixture() {
  const programData = programDataAddress(program);
  const programBytes = Buffer.alloc(36);
  programBytes.writeUInt32LE(2);
  programData.toBuffer().copy(programBytes, 4);
  const dataBytes = Buffer.alloc(45 + artifact.bytes.length);
  dataBytes.writeUInt32LE(3);
  dataBytes.writeBigUInt64LE(123n, 4);
  dataBytes[12] = 1;
  ADMIN_WALLET.toBuffer().copy(dataBytes, 13);
  Buffer.from(artifact.bytes).copy(dataBytes, 45);
  const info = (data: Buffer, lamports: number, owner = UPGRADEABLE_LOADER, executable = false): AccountInfo<Buffer> => ({ data, lamports, owner, executable, rentEpoch: 0 });
  const programInfo = info(programBytes, 833_120, UPGRADEABLE_LOADER, true);
  const dataInfo = info(dataBytes, 323_723_000);
  const name = Buffer.from("mascot");
  const [vault, bump] = PublicKey.findProgramAddressSync([Buffer.from("creator"), VERIFIER!.toBuffer(), name], program);
  const vaultBytes = Buffer.alloc(138);
  Buffer.from("TIKVAULT").copy(vaultBytes);
  vaultBytes[8] = bump; vaultBytes[9] = name.length;
  name.copy(vaultBytes, 10); VERIFIER!.toBuffer().copy(vaultBytes, 34);
  const vaultInfo = info(vaultBytes, rent + 2_375_808, program);
  const otherAddress = new PublicKey(new Uint8Array(32).fill(7));
  const otherInfo = info(Buffer.from([1, 2, 3]), 99, program);
  const owned = [{ pubkey: vault, account: vaultInfo }, { pubkey: otherAddress, account: otherInfo }];
  const byAddress = new Map([[program.toBase58(), programInfo], [programData.toBase58(), dataInfo], ...owned.map(({ pubkey, account }) => [pubkey.toBase58(), account] as const)]);
  const connection = {
    rpcEndpoint: "http://127.0.0.1:8899",
    getGenesisHash: async () => MAINNET_GENESIS_HASH,
    getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(key => byAddress.get(key.toBase58()) ?? null),
    getProgramAccounts: async (_program: PublicKey, config: { dataSlice: unknown }) => {
      assert.deepEqual(config.dataSlice, { offset: 0, length: 0 }, "browser proxy permits only the narrow ownership scan");
      return owned.map(({ pubkey, account }) => ({ pubkey, account: { ...account, data: Buffer.alloc(0) } }));
    },
    getMinimumBalanceForRentExemption: async () => rent,
    getLatestBlockhash: async () => ({ blockhash: SystemProgram.programId.toBase58(), lastValidBlockHeight: 100 }),
    getFeeForMessage: async () => ({ value: 5000 }),
  } as unknown as Connection;
  return { connection, dataInfo, vaultInfo, otherInfo, owned };
}

test("active shutdown quote separates refundable program rent from affected creator funds", async () => {
  const { connection } = fixture();
  const quote = await quoteActiveProgramRefund(connection, program, artifact);
  assert.equal(quote.refundLamports, 323_723_000n);
  assert.equal(quote.retainedProgramLamports, 833_120n);
  assert.equal(quote.feeLamports, 10_000n);
  assert.equal(quote.affectedAccountCount, 2);
  assert.equal(quote.affectedLamports, BigInt(rent + 2_375_808 + 99));
  assert.equal(quote.affectedCreatorVaultCount, 1);
  assert.equal(quote.affectedCreatorFundsLamports, 2_375_808n);
  assert.match(quote.affectedAccountsHash, /^[a-f0-9]{64}$/);
  await assert.rejects(quoteUnusedProgramRefund(connection, program, artifact), /configured escrow program/, "unused recovery retains its original safety rule");
});

test("review hash is order independent and detects balances, account bytes and program changes", async () => {
  const state = fixture();
  const first = await quoteActiveProgramRefund(state.connection, program, artifact);
  state.owned.reverse();
  assert.equal((await quoteActiveProgramRefund(state.connection, program, artifact)).affectedAccountsHash, first.affectedAccountsHash);
  state.vaultInfo.lamports++;
  const funded = await quoteActiveProgramRefund(state.connection, program, artifact);
  assert.notEqual(funded.affectedAccountsHash, first.affectedAccountsHash);
  state.otherInfo.data[0] ^= 1;
  const changed = await quoteActiveProgramRefund(state.connection, program, artifact);
  assert.notEqual(changed.affectedAccountsHash, funded.affectedAccountsHash);
  state.dataInfo.data.writeBigUInt64LE(124n, 4);
  assert.notEqual((await quoteActiveProgramRefund(state.connection, program, artifact)).affectedAccountsHash, changed.affectedAccountsHash);
});

test("active closure requires admin, exact typed ID, explicit creator-loss acknowledgement and reviewed snapshot before signing", async () => {
  const wallet = { publicKey: ADMIN_WALLET, signTransaction: async () => { assert.fail("invalid confirmation must never reach wallet signing"); } };
  const options = { connection: null! as Connection, wallet, program, artifact, confirmedProgramId: program.toBase58(), acknowledgedCreatorFundsLoss: true, reviewedAffectedAccountsHash: "a".repeat(64) };
  await assert.rejects(closeActiveProgram({ ...options, wallet: { ...wallet, publicKey: SystemProgram.programId } }), /configured admin/);
  await assert.rejects(closeActiveProgram({ ...options, confirmedProgramId: "" }), /exact program ID/);
  await assert.rejects(closeActiveProgram({ ...options, acknowledgedCreatorFundsLoss: false }), /existing and future creator funds/);
  await assert.rejects(closeActiveProgram({ ...options, reviewedAffectedAccountsHash: "" }), /Inspect the affected accounts/);
  const state = fixture();
  const quote = await quoteActiveProgramRefund(state.connection, program, artifact);
  state.vaultInfo.lamports++;
  await assert.rejects(closeActiveProgram({ ...options, connection: state.connection, reviewedAffectedAccountsHash: quote.affectedAccountsHash }), /accounts changed/);
});

test("active quote refuses changed authority, artifact, foreign owner and wrong configured program", async () => {
  const state = fixture();
  await assert.rejects(quoteActiveProgramRefund(state.connection, SystemProgram.programId, artifact), /exact configured/);
  state.dataInfo.data[13] ^= 1;
  await assert.rejects(quoteActiveProgramRefund(state.connection, program, artifact), /admin upgrade authority/);
  state.dataInfo.data[13] ^= 1;
  state.dataInfo.data[45 + artifact.bytes.length - 1] ^= 1;
  await assert.rejects(quoteActiveProgramRefund(state.connection, program, artifact), /active verified/);
  state.dataInfo.data[45 + artifact.bytes.length - 1] ^= 1;
  state.otherInfo.owner = SystemProgram.programId;
  await assert.rejects(quoteActiveProgramRefund(state.connection, program, artifact), /owned by another program/);
});

test("mainnet active quote checks current server configuration instead of trusting a stale browser", async (t) => {
  const state = fixture();
  const connection = { ...state.connection, rpcEndpoint: "https://api.mainnet-beta.solana.com" } as unknown as Connection;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ configuration: { escrowProgram: { address: SystemProgram.programId.toBase58() } } })));
  await assert.rejects(quoteActiveProgramRefund(connection, program, artifact), /program changed/);
});
