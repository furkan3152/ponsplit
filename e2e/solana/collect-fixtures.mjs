// Collects the real mainnet state a local solana-test-validator needs to run pump.fun as Splidev uses
// it: every account the launch, trade and fee-sharing instructions touch that already exists on
// mainnet (pump's globals, fee configs, ...), plus the list of programs to dump. Writes
// <out>/accounts/<pubkey>.json (solana-test-validator --account format) and <out>/programs.txt.
// Run where mainnet is reachable (the solana-fixtures workflow).
import { mkdirSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

const require = createRequire(import.meta.url);
const { OnlinePumpSdk, PUMP_SDK, Platform } = require("@pump-fun/pump-sdk");
const amm = require("@pump-fun/pump-swap-sdk");

const out = process.argv[2] || "fixtures";
mkdirSync(`${out}/accounts`, { recursive: true });
const c = new Connection(process.env.RPC || "https://api.mainnet-beta.solana.com", "confirmed");
const user = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const online = new OnlinePumpSdk(c);
const global = await online.fetchGlobal();

const ixs = [];
ixs.push(await PUMP_SDK.createV2Instruction({ mint, name: "x", symbol: "x", uri: "x", creator: user, user, mayhemMode: false }));
ixs.push(...(await PUMP_SDK.createV2AndBuyInstructions({ global, mint, name: "x", symbol: "x", uri: "x", creator: user, user, amount: new BN(1), solAmount: new BN(1), mayhemMode: false })));
ixs.push(await PUMP_SDK.createSocialFeePda({ payer: user, userId: "1", platform: Platform.GitHub }));
ixs.push(await PUMP_SDK.createFeeSharingConfig({ creator: user, mint, pool: null }));
ixs.push(await PUMP_SDK.updateFeeSharesV2({ authority: user, mint, currentShareholders: [user], newShareholders: [{ address: user, shareBps: 10_000 }], quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID }));
const keys = new Map();
for (const ix of ixs) {
  keys.set(ix.programId.toBase58(), true);
  for (const k of ix.keys) keys.set(k.pubkey.toBase58(), true);
}
// Every address pump's global config names (fee recipients are picked at random per trade).
for (const v of Object.values(global)) for (const k of [v].flat()) if (k instanceof PublicKey && !k.equals(PublicKey.default)) keys.set(k.toBase58(), true);
// pump.fun's pool program (graduation and pool trades): its global and fee configs and every address they name.
const ammGlobal = await new amm.OnlinePumpAmmSdk(c).fetchGlobalConfigAccount();
for (const v of Object.values(ammGlobal)) for (const k of [v].flat()) if (k instanceof PublicKey && !k.equals(PublicKey.default)) keys.set(k.toBase58(), true);
for (const k of [amm.GLOBAL_CONFIG_PDA, amm.PUMP_AMM_FEE_CONFIG_PDA, amm.GLOBAL_VOLUME_ACCUMULATOR_PDA]) keys.set(k.toBase58(), true);
// pump's migration instruction (a coin leaving the curve for its pool).
ixs.push(await PUMP_SDK.migrateInstruction({ withdrawAuthority: global.withdrawAuthority, mint, user, tokenProgram: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") }));
for (const ix of ixs) for (const k of ix.keys) keys.set(k.pubkey.toBase58(), true);
// Programs the flows reach through CPI.
for (const p of [
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // pump
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", // pump amm
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ", // pump fees
  "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e", // mayhem
]) keys.set(p, true);

const list = [...keys.keys()].map((k) => new PublicKey(k));
const programs = [];
for (let i = 0; i < list.length; i += 100) {
  const infos = await c.getMultipleAccountsInfo(list.slice(i, i + 100));
  infos.forEach((info, j) => {
    const key = list[i + j].toBase58();
    if (!info) return;
    if (info.executable) {
      if (!info.owner.equals(new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))) return; // builtins ship with the validator
      programs.push(key);
      return;
    }
    if (key === SystemProgram.programId.toBase58()) return;
    writeFileSync(`${out}/accounts/${key}.json`, JSON.stringify({ pubkey: key, account: { lamports: info.lamports, data: [info.data.toString("base64"), "base64"], owner: info.owner.toBase58(), executable: false, rentEpoch: 0, space: info.data.length } }));
    console.log("account", key, info.owner.toBase58(), info.data.length);
  });
}
writeFileSync(`${out}/programs.txt`, programs.join("\n") + "\n");
console.log("programs", programs);
