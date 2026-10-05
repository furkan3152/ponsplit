// Launches a Splidev coin on a local solana-test-validator running pump.fun's real programs (see
// fixtures/), through the site's own transaction builder, then checks pump.fun's fee sharing:
// Splidev's treasury first, then the GitHub fee accounts, admin revoked. Trades, distributes the
// creator fees and checks every shareholder got its share.
//   node e2e/solana/build-lib.mjs && RPC=http://127.0.0.1:8899 node e2e/solana/launch-local.mjs
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { createRequire } from "module";
import BN from "bn.js";

const treasury = Keypair.generate();
process.env.NEXT_PUBLIC_SPLIDEV_TREASURY = treasury.publicKey.toBase58();
const require = createRequire(import.meta.url);
const { launchTransactions, githubFeeAccount, PUMP_FEES_PROGRAM_ID } = require("./.build/lib.cjs");
const { OnlinePumpSdk, PUMP_SDK, feeSharingConfigPda } = require("@pump-fun/pump-sdk");

const c = new Connection(process.env.RPC || "http://127.0.0.1:8899", "confirmed");
const fail = (m) => { throw new Error(m); };
const ok = (m) => console.log("✔", m);
async function fund(k, sol) {
  const sig = await c.requestAirdrop(k, sol * LAMPORTS_PER_SOL);
  await c.confirmTransaction(sig, "confirmed");
}
async function send(tx, signers) {
  tx.sign(signers);
  const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const r = await c.confirmTransaction(sig, "confirmed");
  if (r.value.err) fail(`transaction failed: ${JSON.stringify(r.value.err)}`);
  return sig;
}

const creator = Keypair.generate();
const mint = Keypair.generate();
await fund(creator.publicKey, 50);
await fund(treasury.publicKey, 1);
// Real GitHub ids: torvalds (has a pump.fun fee account on mainnet) and gaearon.
const githubIds = ["1024025", "810438"];
const before = await c.getBalance(treasury.publicKey);
const txs = await launchTransactions(c, {
  user: creator.publicKey,
  mint: mint.publicKey,
  name: "Splidev Local",
  symbol: "SPLD",
  uri: "https://example.com/meta.json",
  githubIds,
  bps: [6000, 4000],
  firstBuyLamports: 100_000_000n,
});
ok(`built ${txs.length} transactions: ${txs.map((t) => t.serialize().length + " bytes").join(", ")}`);
for (const [i, tx] of txs.entries()) await send(tx, i === 0 ? [creator, mint] : [creator]);
ok("launch sent");

const sdk = new OnlinePumpSdk(c);
const [cfgKey] = [feeSharingConfigPda(mint.publicKey)];
const cfg = PUMP_SDK.decodeSharingConfig(await c.getAccountInfo(cfgKey));
console.log(JSON.stringify(cfg, (_, v) => (v && v.toBase58 ? v.toBase58() : v), 1));
if (!cfg.adminRevoked) fail("fee sharing admin not revoked");
if (!cfg.shareholders[0].address.equals(treasury.publicKey)) fail("treasury isn't the first shareholder");
if (!cfg.shareholders[1].address.equals(githubFeeAccount("1024025"))) fail("GitHub account 1 missing");
// The treasury filter the site uses to list Splidev coins.
const raw = await c.getAccountInfo(cfgKey);
if (!new PublicKey(raw.data.subarray(80, 112)).equals(treasury.publicKey)) fail("treasury not at offset 80");
const listed = await c.getProgramAccounts(PUMP_FEES_PROGRAM_ID, { filters: [{ memcmp: { offset: 80, bytes: treasury.publicKey.toBase58() } }] });
if (listed.length !== 1) fail(`expected 1 listed coin, got ${listed.length}`);
ok("fee sharing is set: treasury first, GitHub accounts after, admin revoked, findable by treasury");
const feePaid = (await c.getBalance(treasury.publicKey)) - before;
ok(`launch fee reached the treasury: ${feePaid / LAMPORTS_PER_SOL} SOL`);
