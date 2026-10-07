// Simulates a Splitdev launch on Solana mainnet (nothing is sent, no key is used): pump.fun create_v2
// (+ an optional first buy), one pump.fun GitHub fee account per recipient, and pump.fun's permanent
// fee sharing with Splitdev's treasury first. Prints each transaction's size and the simulation logs.
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createRequire } from "module";
import BN from "bn.js";
// The pump SDK's ESM build doesn't load under Node; its CommonJS build does.
const { OnlinePumpSdk, PUMP_SDK, Platform, socialFeePda } = createRequire(import.meta.url)("@pump-fun/pump-sdk");

const c = new Connection(process.env.RPC, "confirmed");
const TREASURY = new PublicKey(process.env.TREASURY || "11111111111111111111111111111112");
const GITHUB_IDS = (process.env.GITHUB_IDS || "1024025,810438").split(",");
// A funded wallet to pay in the simulation (signatures aren't checked).
// A well-funded plain wallet (an exchange's) as the simulated payer; override with PAYER.
const payer = new PublicKey(process.env.PAYER || "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
console.log("payer", payer.toBase58(), (await c.getBalance(payer)) / 1e9, "SOL");
const mint = Keypair.generate().publicKey;
const online = new OnlinePumpSdk(c);
const global = await online.fetchGlobal();

const firstBuySol = new BN(process.env.FIRST_BUY_LAMPORTS || "0");
const create = firstBuySol.gtn(0)
  ? await PUMP_SDK.createV2AndBuyInstructions({ global, mint, name: "Splitdev Sim", symbol: "SIM", uri: "https://example.com/m.json", creator: payer, user: payer, amount: new BN(1_000_000), solAmount: firstBuySol, mayhemMode: false })
  : [await PUMP_SDK.createV2Instruction({ mint, name: "Splitdev Sim", symbol: "SIM", uri: "https://example.com/m.json", creator: payer, user: payer, mayhemMode: false })];

const socials = [];
for (const id of GITHUB_IDS) {
  const pda = socialFeePda(id, Platform.GitHub);
  const exists = Boolean(await c.getAccountInfo(pda));
  console.log("github", id, pda.toBase58(), exists ? "exists" : "new");
  if (!exists) socials.push(await PUMP_SDK.createSocialFeePda({ payer, userId: id, platform: Platform.GitHub }));
}
const sharingCfg = await PUMP_SDK.createFeeSharingConfig({ creator: payer, mint, pool: null });
const recipients = GITHUB_IDS.map((id) => socialFeePda(id, Platform.GitHub));
const platformBps = 1000;
const each = Math.floor((10_000 - platformBps) / recipients.length);
const shares = [{ address: TREASURY, shareBps: platformBps }, ...recipients.map((a, i) => ({ address: a, shareBps: each + (i === 0 ? 10_000 - platformBps - each * recipients.length : 0) }))];
const update = await PUMP_SDK.updateFeeSharesV2({ authority: payer, mint, currentShareholders: [payer], newShareholders: shares, quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID });
const fee = SystemProgram.transfer({ fromPubkey: payer, toPubkey: TREASURY, lamports: 10_000_000 });
const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })];

const { blockhash } = await c.getLatestBlockhash();
function build(ixs) {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  let size;
  try { size = tx.serialize().length; } catch (e) { size = "too big: " + e.message; }
  return { tx, size, keys: msg.staticAccountKeys.length, signers: msg.header.numRequiredSignatures };
}
async function sim(label, ixs) {
  const b = build(ixs);
  console.log(`\n== ${label}: ${b.size} bytes, ${b.keys} accounts, ${b.signers} signers`);
  if (typeof b.size !== "number") return;
  const r = await c.simulateTransaction(b.tx, { sigVerify: false, replaceRecentBlockhash: true });
  console.log("err", JSON.stringify(r.value.err), "units", r.value.unitsConsumed);
  console.log((r.value.logs || []).slice(-25).join("\n"));
}
await sim("all in one", [...budget, fee, ...create, ...socials, sharingCfg, update]);
await sim("tx1 fee+create", [...budget, fee, ...create]);
console.log("\ntx2 sizes (needs tx1 on chain):", build([...budget, ...socials, sharingCfg, update]).size);
