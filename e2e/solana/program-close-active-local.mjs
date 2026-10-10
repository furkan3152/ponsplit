// Real loader closure of a configured, used escrow. Every key and SOL balance is
// disposable, local-validator-only. This test starts and stops its own validator.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction } from "@solana/web3.js";

const port = Number(process.env.ACTIVE_CLOSE_RPC_PORT || 8919);
assert.ok(Number.isInteger(port) && port >= 1024 && port < 64000, "use a valid dedicated local RPC port");
const c = new Connection(`http://127.0.0.1:${port}`, "confirmed");
const admin = Keypair.generate(), attacker = Keypair.generate(), creator = Keypair.generate();
const program = Keypair.generate().publicKey;
process.env.NEXT_PUBLIC_TIKSPLIT_ADMIN_WALLET = admin.publicKey.toBase58();
process.env.NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID = program.toBase58();
await build({ entryPoints: ["src/lib/solana/program-deploy.ts"], outfile: "e2e/solana/.build/program-close-active.cjs", bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "warning" });
const require = createRequire(import.meta.url);
const lib = require("./.build/program-close-active.cjs");
const artifact = { bytes: readFileSync("public/programs/tiktok-escrow.so"), manifest: lib.ESCROW_ARTIFACT_MANIFEST };
const work = mkdtempSync(join(tmpdir(), "tiksplit-close-active-"));
const logPath = join(work, "validator.log");
const log = openSync(logPath, "w");
const validator = spawn(process.env.SOLANA_TEST_VALIDATOR || "solana-test-validator", [
  "--ledger", join(work, "ledger"), "--reset", "--quiet", "--bind-address", "127.0.0.1",
  "--rpc-port", String(port), "--faucet-port", String(port + 2), "--gossip-port", String(port + 3),
  "--dynamic-port-range", `${port + 1000}-${port + 1100}`,
  "--upgradeable-program", program.toBase58(), "public/programs/tiktok-escrow.so", admin.publicKey.toBase58(),
], { stdio: ["ignore", log, log] });
let spawnError;
validator.on("error", error => { spawnError = error; });
const stopped = new Promise(resolve => validator.once("close", resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let broadcasts = 0;
let walletApprovals = 0;
const wallet = { publicKey: admin.publicKey, signTransaction: async transaction => {
  walletApprovals++;
  transaction.partialSign(admin);
  return transaction;
} };
const onSent = () => { broadcasts++; };
function initialize(handle) {
  const name = Buffer.from(handle);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("creator"), admin.publicKey.toBuffer(), name], program);
  const instruction = new TransactionInstruction({ programId: program, keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data: Buffer.concat([Buffer.from([0, name.length]), name, admin.publicKey.toBuffer()]) });
  return { vault, instruction };
}
const primary = initialize("shutdown.creator");
async function currentQuote() { return lib.quoteActiveProgramRefund(c, program, artifact); }
async function close(quote, overrides = {}) {
  return lib.closeActiveProgram({ connection: c, wallet, program, artifact,
    confirmedProgramId: program.toBase58(), acknowledgedCreatorFundsLoss: true,
    reviewedAffectedAccountsHash: quote.affectedAccountsHash, onSent, ...overrides });
}
async function assertLive() {
  assert.equal(await lib.inspectDeployedProgram(c, program, artifact), true);
  const transaction = new TransactionMessage({ payerKey: admin.publicKey,
    recentBlockhash: (await c.getLatestBlockhash("confirmed")).blockhash,
    instructions: [primary.instruction],
  }).compileToV0Message();
  assert.equal((await c.simulateTransaction(new VersionedTransaction(transaction), { commitment: "confirmed", sigVerify: false })).value.err, null, "escrow remains callable after a rejected closure");
}

try {
  for (let attempts = 0; ; attempts++) {
    if (spawnError) throw spawnError;
    if (validator.exitCode !== null) throw new Error(`Validator exited: ${readFileSync(logPath, "utf8")}`);
    try { await c.getVersion(); break; } catch {
      assert.ok(attempts < 120, `validator must start; log: ${logPath}`);
      await delay(250);
    }
  }
  assert.equal(await lib.inspectDeployedProgram(c, program, artifact), true, "genesis program must match the shipped artifact and disposable upgrade authority");
  for (const key of [admin, attacker, creator]) await c.confirmTransaction(await c.requestAirdrop(key.publicKey, 2_000_000_000), "confirmed");
  await sendAndConfirmTransaction(c, new Transaction().add(primary.instruction,
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: primary.vault, lamports: 2_375_808 })), [admin]);
  const other = Keypair.generate();
  const otherRent = await c.getMinimumBalanceForRentExemption(9);
  await sendAndConfirmTransaction(c, new Transaction().add(SystemProgram.createAccount({
    fromPubkey: admin.publicKey, newAccountPubkey: other.publicKey, lamports: otherRent + 987,
    space: 9, programId: program,
  })), [admin, other]);
  const vaultRent = BigInt(await c.getMinimumBalanceForRentExemption(138));
  const initialQuote = await currentQuote();
  assert.equal(initialQuote.programId, program.toBase58());
  assert.equal(initialQuote.programData, lib.programDataAddress(program).toBase58());
  assert.equal(initialQuote.refundLamports, BigInt((await c.getAccountInfo(lib.programDataAddress(program))).lamports));
  assert.equal(initialQuote.retainedProgramLamports, BigInt((await c.getAccountInfo(program)).lamports));
  assert.equal(initialQuote.affectedAccountCount, 2, "all owned accounts are disclosed, including non-vault data");
  assert.equal(initialQuote.affectedCreatorVaultCount, 1);
  assert.equal(initialQuote.affectedCreatorFundsLamports, 2_375_808n, "creator funds exclude rent and unrelated account balances");
  assert.equal(initialQuote.affectedLamports, vaultRent + 2_375_808n + BigInt(otherRent) + 987n);
  assert.match(initialQuote.affectedAccountsHash, /^[a-f0-9]{64}$/);
  assert.equal((await currentQuote()).affectedAccountsHash, initialQuote.affectedAccountsHash, "stable account state has a stable review fingerprint");
  await assert.rejects(lib.quoteUnusedProgramRefund(c, program, artifact), /configured escrow program/);
  await assert.rejects(lib.closeUnusedProgram({ connection: c, wallet, program, artifact, confirmedProgramId: program.toBase58() }), /configured escrow program/);
  console.log("PASS active quote discloses owned accounts, rent and creator funds; unused-program guard remains intact");

  const protectedBalance = await c.getBalance(admin.publicKey);
  const promptsBefore = walletApprovals;
  await assert.rejects(close(initialQuote, { wallet: { publicKey: attacker.publicKey, signTransaction: async () => assert.fail("wrong admin must not prompt") } }), /admin/i);
  await assert.rejects(close(initialQuote, { acknowledgedCreatorFundsLoss: false }), /acknowledge|confirm/i);
  await assert.rejects(close(initialQuote, { confirmedProgramId: attacker.publicKey.toBase58() }), /exact program ID/i);
  await assert.rejects(close(initialQuote, { reviewedAffectedAccountsHash: "" }), /review|changed|inspect|fingerprint/i);
  await assert.rejects(close(initialQuote, { reviewedAffectedAccountsHash: "0".repeat(64) }), /review|changed|inspect|fingerprint/i);
  await assert.rejects(lib.quoteActiveProgramRefund(c, attacker.publicKey, artifact), /configured|active verified/i);
  assert.equal(walletApprovals, promptsBefore, "all missing attestations and stale reviews are blocked before wallet signing");
  await assert.rejects(sendAndConfirmTransaction(c, new Transaction().add(lib.closeProgramInstruction(program, attacker.publicKey)), [attacker]));
  assert.equal(await c.getBalance(admin.publicKey), protectedBalance);
  assert.equal(broadcasts, 0);
  await assertLive();
  console.log("PASS wrong admin, missing acknowledgement, mismatched ID/review and unauthorized loader close are rejected");

  const secondary = initialize("shutdown.second");
  await assert.rejects(close(initialQuote, { wallet: { ...wallet, signTransaction: async transaction => {
    await sendAndConfirmTransaction(c, new Transaction().add(secondary.instruction), [admin]);
    return wallet.signTransaction(transaction);
  } } }), /review|changed|inspect|fingerprint/i);
  assert.equal(broadcasts, 0);
  await assertLive();
  const accountChangedQuote = await currentQuote();
  assert.equal(accountChangedQuote.affectedAccountCount, 3);
  assert.equal(accountChangedQuote.affectedCreatorVaultCount, 2);
  assert.notEqual(accountChangedQuote.affectedAccountsHash, initialQuote.affectedAccountsHash);
  await assert.rejects(close(accountChangedQuote, { wallet: { ...wallet, signTransaction: async transaction => {
    await sendAndConfirmTransaction(c, new Transaction().add(SystemProgram.transfer({ fromPubkey: attacker.publicKey, toPubkey: primary.vault, lamports: 13_579 })), [attacker]);
    return wallet.signTransaction(transaction);
  } } }), /review|changed|inspect|fingerprint/i);
  assert.equal(broadcasts, 0);
  await assertLive();
  const fundedQuote = await currentQuote();
  assert.equal(fundedQuote.affectedCreatorFundsLamports, 2_389_387n);
  assert.notEqual(fundedQuote.affectedAccountsHash, accountChangedQuote.affectedAccountsHash);
  console.log("PASS creator account creation and fee arrival during wallet approval invalidate review without broadcasting closure");

  // A beneficiary bind changes only account data. This must also invalidate the
  // reviewed snapshot, even when the account list and all balances are identical.
  const binding = new TransactionInstruction({ programId: program, keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: false },
    { pubkey: creator.publicKey, isSigner: true, isWritable: false },
    { pubkey: primary.vault, isSigner: false, isWritable: true },
  ], data: Buffer.concat([Buffer.from([1]), Buffer.alloc(32, 7)]) });
  await assert.rejects(close(fundedQuote, { wallet: { ...wallet, signTransaction: async transaction => {
    await sendAndConfirmTransaction(c, new Transaction().add(binding), [admin, creator]);
    return wallet.signTransaction(transaction);
  } } }), /review|changed|inspect|fingerprint/i);
  const finalQuote = await currentQuote();
  assert.equal(finalQuote.affectedLamports, fundedQuote.affectedLamports);
  assert.equal(finalQuote.affectedCreatorFundsLamports, fundedQuote.affectedCreatorFundsLamports);
  assert.notEqual(finalQuote.affectedAccountsHash, fundedQuote.affectedAccountsHash);
  assert.equal(broadcasts, 0);
  await assertLive();
  const beforeTamper = await c.getBalance(admin.publicKey);
  await assert.rejects(close(finalQuote, { wallet: { ...wallet, signTransaction: async transaction => {
    const instruction = transaction.instructions.find(ix => ix.programId.equals(lib.UPGRADEABLE_LOADER));
    instruction.keys[1].pubkey = attacker.publicKey;
    return wallet.signTransaction(transaction);
  } } }), /Wallet transaction blocked/);
  assert.equal(await c.getBalance(admin.publicKey), beforeTamper);
  assert.equal(broadcasts, 0);
  await assertLive();
  console.log("PASS beneficiary changes invalidate review; wallet cannot redirect the ProgramData refund");

  const claim = new TransactionInstruction({ programId: program, keys: [
    { pubkey: creator.publicKey, isSigner: true, isWritable: true },
    { pubkey: primary.vault, isSigner: false, isWritable: true },
  ], data: Buffer.from([2]) });
  async function simulateClaim() {
    const message = new TransactionMessage({ payerKey: creator.publicKey,
      recentBlockhash: (await c.getLatestBlockhash("confirmed")).blockhash,
      instructions: [claim],
    }).compileToV0Message();
    return c.simulateTransaction(new VersionedTransaction(message), { commitment: "confirmed", sigVerify: false });
  }
  assert.equal((await simulateClaim()).value.err, null, "verified creator can claim before program closure");
  const snapshots = await c.getMultipleAccountsInfo([primary.vault, secondary.vault, other.publicKey]);
  const adminBefore = BigInt(await c.getBalance(admin.publicKey));
  const creatorBefore = await c.getBalance(creator.publicKey);
  const attackerBefore = await c.getBalance(attacker.publicKey);
  const signature = await close(finalQuote);
  const receipt = await c.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  assert.ok(receipt?.meta && !receipt.meta.err, "closure must actually confirm on the validator");
  assert.equal(broadcasts, 1, "only the explicitly approved closure is broadcast");
  assert.equal(BigInt(await c.getBalance(admin.publicKey)) - adminBefore, finalQuote.refundLamports - BigInt(receipt.meta.fee));
  assert.equal(await c.getBalance(creator.publicKey), creatorBefore);
  assert.equal(await c.getBalance(attacker.publicKey), attackerBefore);
  assert.equal(await c.getAccountInfo(lib.programDataAddress(program)), null);
  assert.equal(BigInt((await c.getAccountInfo(program)).lamports), finalQuote.retainedProgramLamports);
  const remaining = await c.getMultipleAccountsInfo([primary.vault, secondary.vault, other.publicKey]);
  remaining.forEach((account, index) => {
    assert.ok(account && snapshots[index]);
    assert.equal(account.lamports, snapshots[index].lamports, "closure does not recover or transfer owned account funds");
    assert.deepEqual(account.data, snapshots[index].data);
    assert.ok(account.owner.equals(program));
  });
  assert.equal(await lib.inspectDeployedProgram(c, program, artifact), false);
  await assert.rejects(currentQuote(), /not an active verified/i);
  const stoppedClaim = await simulateClaim();
  assert.notEqual(stoppedClaim.value.err, null, "the formerly authorized creator claim cannot execute after program closure");
  console.log("PASS explicit active closure: exact ProgramData refund minus real fee to admin; address rent and creator funds remain; escrow execution stops", {
    refundLamports: finalQuote.refundLamports.toString(), feeLamports: String(receipt.meta.fee),
    retainedProgramLamports: finalQuote.retainedProgramLamports.toString(),
    strandedCreatorFundsLamports: finalQuote.affectedCreatorFundsLamports.toString(),
  });
} catch (error) {
  console.error(`Local validator log: ${logPath}`);
  throw error;
} finally {
  // web3.js has no public Connection.dispose(). Stop its confirmation websocket
  // before terminating the test-owned server so its reconnect loop cannot linger.
  c._rpcWebSocket.setAutoReconnect(false);
  c._rpcWebSocket.close();
  validator.kill("SIGTERM");
  const forceStop = setTimeout(() => validator.kill("SIGKILL"), 5000);
  await stopped;
  clearTimeout(forceStop);
  closeSync(log);
}
