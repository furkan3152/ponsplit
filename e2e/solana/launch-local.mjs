// Launches a Splidev coin on a local solana-test-validator running pump.fun's real programs (see
// fixtures/), through the site's own transaction builder, then checks pump.fun's fee sharing:
// Splidev's treasury first, then the GitHub fee accounts, admin revoked. Trades, distributes the
// creator fees and checks every shareholder got its share.
//   node e2e/solana/build-lib.mjs && RPC=http://127.0.0.1:8899 node e2e/solana/launch-local.mjs
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { createRequire } from "module";
import BN from "bn.js";

const treasury = Keypair.generate();
process.env.NEXT_PUBLIC_SPLIDEV_TREASURY = treasury.publicKey.toBase58();
const require = createRequire(import.meta.url);
const { launchTransactions, createTransaction, TX_BYTES_LIMIT, buyTransaction, sellTransaction, quoteBuy, quoteSell, distributeTransaction, githubFeeAccount, listCoins, readCoin, githubClaimable, recentTrades, PUMP_FEES_PROGRAM_ID } = require("./.build/lib.cjs");
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
const coins = await listCoins(c);
const coin = coins.find((x) => x.token === mint.publicKey.toBase58());
if (coins.length !== 1 || !coin) fail(`the site's coin list found ${coins.length} coins`);
if (coin.name !== "Splidev Local" || coin.symbol !== "SPLD" || coin.platformBps !== 1000) fail(`unexpected coin ${JSON.stringify(coin, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
if (coin.recipients.map((r) => r.githubId).join() !== githubIds.join() || coin.recipients.map((r) => r.shareBps).join() !== "5400,3600") fail(`unexpected recipients ${JSON.stringify(coin.recipients)}`);
if (!(coin.price > 0) || !(coin.progress > 0.1)) fail(`no price or progress after the first buy (${coin.progress}%)`);
const { getAssociatedTokenAddressSync: ataOf } = require("@solana/spl-token");
const firstBought = BigInt((await c.getTokenAccountBalance(ataOf(mint.publicKey, creator.publicKey, false, TOKEN_2022_PROGRAM_ID))).value.amount);
if (firstBought < 1_000_000_000_000n) fail(`the 0.1 SOL first buy got only ${firstBought} raw tokens`);
ok(`the first buy got ${Number(firstBought) / 1e6} tokens`);
if (!(await readCoin(c, mint.publicKey))) fail("readCoin didn't find the coin");
if (await readCoin(c, Keypair.generate().publicKey)) fail("readCoin found a coin that doesn't exist");
ok(`the site lists it: $${coin.symbol}, ${coin.recipients.length} GitHub accounts, price ${coin.price.toExponential(3)} SOL, ${coin.progress.toFixed(2)}% of the curve`);
const feePaid = (await c.getBalance(treasury.publicKey)) - before;
ok(`launch fee reached the treasury: ${feePaid / LAMPORTS_PER_SOL} SOL`);

// ── Trades on the curve, then pump.fun's distribution pays every shareholder ─────────────────
const traders = [Keypair.generate(), Keypair.generate()];
for (const t of traders) await fund(t.publicKey, 20);
for (const [i, t] of traders.entries()) {
  const quoted = await quoteBuy(c, mint.publicKey, BigInt((i + 1) * 2) * BigInt(LAMPORTS_PER_SOL));
  const { tx, tokens } = await buyTransaction(c, t.publicKey, mint.publicKey, BigInt((i + 1) * 2) * BigInt(LAMPORTS_PER_SOL));
  await send(tx, [t]);
  if (quoted !== tokens) fail(`quoteBuy said ${quoted}, the transaction was built for ${tokens}`);
  ok(`trader ${i + 1} bought ${Number(tokens) / 1e6} tokens (quote matched)`);
}
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");
const ata = getAssociatedTokenAddressSync(mint.publicKey, traders[0].publicKey, false, TOKEN_2022_PROGRAM_ID);
const held = BigInt((await c.getTokenAccountBalance(ata)).value.amount);
const sellQuote = await quoteSell(c, mint.publicKey, held / 2n);
const { tx: sellTx, lamports: got } = await sellTransaction(c, traders[0].publicKey, mint.publicKey, held / 2n);
if (sellQuote !== got) fail(`quoteSell said ${sellQuote}, the sell was built for ${got}`);
const solBefore = await c.getBalance(traders[0].publicKey);
await send(sellTx, [traders[0]]);
const solGot = (await c.getBalance(traders[0].publicKey)) - solBefore;
if (Math.abs(solGot - Number(got)) > 200_000) fail(`the sell paid ${solGot} lamports, quoted ${got} (fees aside)`);
ok(`trader 1 sold half for ~${Number(got) / LAMPORTS_PER_SOL} SOL`);

const trades = await recentTrades(c, mint.publicKey, false);
const kinds = trades.map((t) => t.kind).join(",");
if (kinds !== "sell,buy,buy,buy") fail(`the trade history reads ${kinds}`);
if (trades.some((t) => !(t.price > 0) || t.creatorFee <= 0n || t.sol <= 0n)) fail("a trade without price, SOL or creator fee");
ok(`trade history: ${trades.length} trades (first buy, 2 buys, 1 sell), creator fees ${trades.map((t) => t.creatorFee).join("/")} lamports`);
const holders = cfg.shareholders.map((h) => h.address);
const balancesBefore = await Promise.all(holders.map((h) => c.getBalance(h)));
const payer = Keypair.generate();
await fund(payer.publicKey, 1);
await send(await distributeTransaction(c, payer.publicKey, mint.publicKey), [payer]);
const gains = (await Promise.all(holders.map((h) => c.getBalance(h)))).map((b, i) => b - balancesBefore[i]);
console.log("distributed (lamports):", gains.join(", "));
const total = gains.reduce((a, b) => a + b, 0);
if (total <= 0) fail("nothing was distributed");
for (const [i, g] of gains.entries()) {
  const expected = (total * cfg.shareholders[i].shareBps) / 10_000;
  if (Math.abs(g - expected) > 2) fail(`shareholder ${i} got ${g}, expected about ${expected}`);
}
ok(`creator fees distributed by share: Splidev ${gains[0]}, GitHub ${gains.slice(1).join(" / ")} lamports`);
const claim = await githubClaimable(c, "1024025");
if (claim.claimable < BigInt(gains[1])) fail(`GitHub 1024025 shows ${claim.claimable} claimable, expected at least ${gains[1]}`);
ok(`the claim page sees ${Number(claim.claimable) / LAMPORTS_PER_SOL} SOL waiting for GitHub user 1024025 on pump.fun`);

// The longest launch the site allows (32-character name, 10-character ticker, a metadata link as
// long as a Vercel Blob one) with a first buy still fits in one transaction and lands.
const long = Keypair.generate();
const longTx = await createTransaction(c, {
  user: creator.publicKey,
  mint: long.publicKey,
  name: "N".repeat(32),
  symbol: "T".repeat(10),
  uri: "https://abcdefghijklmnop.public.blob.vercel-storage.com/m/0123456789abcdef0123.json",
  githubIds,
  bps: [6000, 4000],
  firstBuyLamports: 100_000_000n,
});
if (longTx.serialize().length > TX_BYTES_LIMIT) fail(`the longest launch is ${longTx.serialize().length} bytes`);
await send(longTx, [creator, long]);
ok(`the longest launch fits (${longTx.serialize().length} bytes) and lands`);
