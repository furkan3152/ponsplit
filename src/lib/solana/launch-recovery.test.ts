import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Keypair, PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { ACCOUNT_SIZE, ExtensionType, MintLayout, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { pack } from "@solana/spl-token-metadata";
import { MAINNET_GENESIS_HASH } from "../admin-config";
import { PUMP_PROGRAM_ID } from "./pump";
import { fetchRecoveryMetadata, recoverTikTokLaunch, recoveryMetadataFields, recoveryMintMetadata } from "./launch-recovery";

const mint = Keypair.generate().publicKey;
const launcher = Keypair.generate().publicKey;
const details = { name: "Recovery Coin", symbol: "REC", tiktokHandle: "@real.creator", launcherBps: 0, platformBps: 2000 };
const json = JSON.stringify(details);
const uri = `https://unit.public.blob.vercel-storage.com/m/${createHash("sha256").update(json).digest("hex").slice(0, 16)}`;

function mintInfo(metadataMint = mint): AccountInfo<Buffer> {
  const metadata = Buffer.from(pack({ mint: metadataMint, name: details.name, symbol: details.symbol, uri, additionalMetadata: [] }));
  const data = Buffer.alloc(ACCOUNT_SIZE + 1 + 4 + metadata.length);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 1n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data);
  data[ACCOUNT_SIZE] = 1;
  data.writeUInt16LE(ExtensionType.TokenMetadata, ACCOUNT_SIZE + 1);
  data.writeUInt16LE(metadata.length, ACCOUNT_SIZE + 3);
  metadata.copy(data, ACCOUNT_SIZE + 5);
  return { data, owner: TOKEN_2022_PROGRAM_ID, executable: false, lamports: 1, rentEpoch: 0 };
}

test("restoration reads authenticated Token-2022 mint metadata and rejects foreign pointers", () => {
  assert.deepEqual(recoveryMintMetadata(mint, mintInfo()), { name: details.name, symbol: details.symbol, metadataUri: uri, url: uri });
  assert.throws(() => recoveryMintMetadata(mint, null), /not found/);
  assert.throws(() => recoveryMintMetadata(mint, { ...mintInfo(), executable: true }), /not found/);
  assert.throws(() => recoveryMintMetadata(mint, { ...mintInfo(), owner: Keypair.generate().publicKey }));
  assert.throws(() => recoveryMintMetadata(mint, mintInfo(Keypair.generate().publicKey)), /validated/);
});

test("restored public details match on-chain identity and enforce the original valid fee policy", () => {
  assert.deepEqual(recoveryMetadataFields(json, details), { handle: "real.creator", launcherBps: 0, platformBps: 2000 });
  for (const patch of [{ name: "Other" }, { symbol: "OTHER" }, { tiktokHandle: "invalid-handle" }, { launcherBps: 100 }, { launcherBps: "0" }, { platformBps: 1 }, { platformBps: "2000" }]) {
    assert.throws(() => recoveryMetadataFields(JSON.stringify({ ...details, ...patch }), details));
  }
});

test("metadata reads are bounded, omit credentials and reject changed content-addressed Blob JSON", async () => {
  const fetcher = async (_input: unknown, init?: RequestInit) => {
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.referrerPolicy, "no-referrer");
    assert.ok(init?.signal);
    return new Response(json);
  };
  assert.equal(await fetchRecoveryMetadata(uri, fetcher as typeof fetch), json);
  await assert.rejects(() => fetchRecoveryMetadata(uri, (async () => new Response(JSON.stringify({ ...details, tiktokHandle: "attacker" }))) as typeof fetch), /changed/);
  await assert.rejects(() => fetchRecoveryMetadata(uri, (async () => new Response("x".repeat(32 * 1024 + 1))) as typeof fetch), /size limit/);
  await assert.rejects(() => fetchRecoveryMetadata(uri, (async () => new Response("", { status: 500 })) as typeof fetch), /unavailable/);
});

test("recovery authenticates the original pump curve owner before returning a record and never signs", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(json));
  const info = mintInfo();
  const curve = Buffer.alloc(125);
  Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]).copy(curve);
  launcher.toBuffer().copy(curve, 49);
  const curveInfo = { ...info, data: curve, owner: PUMP_PROGRAM_ID };
  const connection = {
    getGenesisHash: async () => MAINNET_GENESIS_HASH,
    getAccountInfo: async (key: PublicKey) => key.equals(mint) ? info : curveInfo,
    getMultipleAccountsInfo: async () => [info, null],
  } as unknown as Connection;
  const recovered = await recoverTikTokLaunch(connection, mint.toBase58(), launcher);
  assert.equal(recovered.state, "needs-split");
  assert.equal(recovered.launch.mint, mint.toBase58());
  assert.equal(recovered.launch.handle, "real.creator");
  assert.equal(recovered.launch.restored, true);
  await assert.rejects(() => recoverTikTokLaunch(connection, mint.toBase58(), Keypair.generate().publicKey), /creator does not match/);
  connection.getGenesisHash = async () => "devnet";
  await assert.rejects(() => recoverTikTokLaunch(connection, mint.toBase58(), launcher), /mainnet/);
});
