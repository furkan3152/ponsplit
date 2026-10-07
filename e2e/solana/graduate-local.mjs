// A Splitdev coin leaves pump.fun's curve for its pool on a local validator with pump.fun's real
// programs: buys until the curve completes, pump.fun's (permissionless) migration, then buys and
// sells on the pool through the site's builders, and the pool's creator fees reach the GitHub accounts.
//   node e2e/solana/build-lib.mjs && RPC=http://127.0.0.1:8899 node e2e/solana/graduate-local.mjs
import { Connection, Keypair, LAMPORTS_PER_SOL, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { createRequire } from "module";

const treasury = Keypair.generate();
process.env.NEXT_PUBLIC_SPLIDEV_TREASURY = treasury.publicKey.toBase58();
const require = createRequire(import.meta.url);
const lib = require("./.build/lib.cjs");
const { OnlinePumpSdk, PUMP_SDK, feeSharingConfigPda } = require("@pump-fun/pump-sdk");

const c = new Connection(process.env.RPC || "http://127.0.0.1:8899", "confirmed");
const fail = (m) => { throw new Error(m); };
const ok = (m) => console.log("✔", m);
async function fund(k, sol) {
  await c.confirmTransaction(await c.requestAirdrop(k, sol * LAMPORTS_PER_SOL), "confirmed");
}
async function send(tx, signers) {
  tx.sign(signers);
  const sig = await c.sendRawTransaction(tx.serialize());
  const r = await c.confirmTransaction(sig, "confirmed");
  if (r.value.err) fail(`transaction failed: ${JSON.stringify(r.value.err)}`);
}

const creator = Keypair.generate();
const whale = Keypair.generate();
const mint = Keypair.generate();
await fund(creator.publicKey, 5);
await fund(whale.publicKey, 200);
// Launched in two parts, as when the split step fails and the creator finishes it later.
const input = { user: creator.publicKey, mint: mint.publicKey, name: "Splitdev Grad", symbol: "GRAD", uri: "https://example.com/g.json", githubIds: ["1024025", "810438"], bps: [5000, 5000], firstBuyLamports: 0n };
await send(await lib.createTransaction(c, input), [creator, mint]);
if (await lib.readCoin(c, mint.publicKey)) fail("a coin without its split is listed");
for (const tx of await lib.finishLaunchTransactions(c, creator.publicKey, mint.publicKey, input.githubIds, input.bps)) await send(tx, [creator]);
if (!(await lib.readCoin(c, mint.publicKey))) fail("the finished launch isn't listed");
ok("launched in two parts (create, then the split), listed only once the split is set");

const sdk = new OnlinePumpSdk(c);
for (let i = 0; i < 30; i++) {
  const curve = await sdk.fetchBondingCurve(mint.publicKey);
  if (curve.complete) break;
  const { tx } = await lib.buyTransaction(c, whale.publicKey, mint.publicKey, 10n * BigInt(LAMPORTS_PER_SOL), 5000);
  await send(tx, [whale]);
}
const curve = await sdk.fetchBondingCurve(mint.publicKey);
if (!curve.complete) fail("the curve didn't complete");
ok("the curve completed");

const global = await sdk.fetchGlobal();
const migrate = await PUMP_SDK.migrateInstruction({ withdrawAuthority: global.withdrawAuthority, mint: mint.publicKey, user: whale.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID });
const { blockhash } = await c.getLatestBlockhash();
await send(new VersionedTransaction(new TransactionMessage({ payerKey: whale.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), migrate] }).compileToV0Message()), [whale]);
ok("pump.fun migrated it to its pool");

const coin = await lib.readCoin(c, mint.publicKey);
if (!coin?.graduated || !(coin.price > 0)) fail(`after migration the site reads ${JSON.stringify(coin, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
ok(`the site reads the pool: price ${coin.price.toExponential(3)} SOL, ${coin.liquiditySol.toFixed(2)} SOL liquidity`);

const trader = Keypair.generate();
await fund(trader.publicKey, 20);
const { tx: buy, tokens } = await lib.buyTransaction(c, trader.publicKey, mint.publicKey, 5n * BigInt(LAMPORTS_PER_SOL));
await send(buy, [trader]);
const ata = getAssociatedTokenAddressSync(mint.publicKey, trader.publicKey, false, TOKEN_2022_PROGRAM_ID);
const held = BigInt((await c.getTokenAccountBalance(ata)).value.amount);
if (held < (tokens * 98n) / 100n) fail(`the pool buy got ${held}, quoted ${tokens}`);
ok(`bought ${Number(held) / 1e6} tokens on the pool`);
const { tx: sell } = await lib.sellTransaction(c, trader.publicKey, mint.publicKey, held / 2n);
await send(sell, [trader]);
ok("sold half on the pool");

const poolTrades = (await lib.recentTrades(c, mint.publicKey, true)).filter((t) => t.venue === "pool");
if (poolTrades.map((t) => t.kind).join() !== "sell,buy" || poolTrades.some((t) => !(t.price > 0))) fail(`pool trade history reads ${JSON.stringify(poolTrades, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
ok(`the pool's trades read back: ${poolTrades.map((t) => `${t.kind} @ ${t.price.toExponential(3)}`).join(", ")}`);
const cfg = PUMP_SDK.decodeSharingConfig(await c.getAccountInfo(feeSharingConfigPda(mint.publicKey)));
const holders = cfg.shareholders.map((h) => h.address);
const before = await Promise.all(holders.map((h) => c.getBalance(h)));
const payer = Keypair.generate();
await fund(payer.publicKey, 1);
await send(await lib.distributeTransaction(c, payer.publicKey, mint.publicKey), [payer]);
const gains = (await Promise.all(holders.map((h) => c.getBalance(h)))).map((b, i) => b - before[i]);
console.log("distributed after graduation (lamports):", gains.join(", "));
if (gains.slice(1).some((g) => g <= 0)) fail("a GitHub account got nothing from the pool's fees");
ok("the pool's creator fees reached Splitdev and both GitHub accounts");
