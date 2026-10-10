import bs58 from "bs58";
import { checkedDeploymentSignature, MAX_WALLET_PRIORITY_FEE_LAMPORTS } from "./deployment-signing";
import { sendUploadQueue } from "./deployment-upload";
export { MAX_WALLET_PRIORITY_FEE_LAMPORTS } from "./deployment-signing";
import {
  ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY,
  Transaction, TransactionInstruction, VersionedTransaction,
  type AccountInfo, type Connection,
} from "@solana/web3.js";
import { ADMIN_WALLET, MAINNET_GENESIS_HASH } from "../admin-config";
import { ESCROW_PROGRAM_ID } from "../tiktok-config";
import { CREATOR_VAULT_SIZE, decodeCreatorVault } from "./tiktok-escrow";
import artifactManifest from "../../../public/programs/tiktok-escrow.manifest.json";

const manifest = Object.freeze({ ...artifactManifest, sourceFiles: Object.freeze([...artifactManifest.sourceFiles]) });

export const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export const BUFFER_HEADER_SIZE = 37;
export const PROGRAM_ACCOUNT_SIZE = 36;
export const PROGRAM_DATA_HEADER_SIZE = 45;
export const WRITE_CHUNK_SIZE = 900;
export const DEFAULT_UPLOAD_SIGNING_BATCH = 8;
export const MAX_UPLOAD_SIGNING_BATCH = 80;
export const WRITE_COMPUTE_UNIT_LIMIT = 25_000;
export const WRITE_COMPUTE_UNIT_PRICE = 1_000;
export const MAX_ARTIFACT_BYTES = 256 * 1024;
export const ESCROW_ARTIFACT_MANIFEST = manifest;

export type ProgramArtifact = { bytes: Uint8Array; manifest: typeof manifest };
export type DeployWallet = {
  publicKey: PublicKey | null;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  signAllTransactions?: (transactions: Transaction[]) => Promise<Transaction[]>;
};
export type DeploymentQuote = {
  binaryBytes: number; maxDataLen: number; writeTransactions: number; totalTransactions: number;
  walletFeeReserveLamports: bigint; walletRentLamports: bigint; bufferRentLamports: bigint; programRentLamports: bigint; programDataRentLamports: bigint;
  lockedRentLamports: bigint; transactionFeesLamports: bigint; recoveryFeeLamports: bigint;
  createFeeLamports: bigint; writeFeeLamports: bigint; deployFeeLamports: bigint;
  requiredLamports: bigint; finalCostLamports: bigint; balanceLamports: bigint; sufficientBalance: boolean;
};
export type DeployProgress = {
  phase: "checking" | "creating-buffer" | "awaiting-upload-approval" | "writing" | "simulating" | "deploying" | "complete";
  buffer: string | null; writtenBytes: number; totalBytes: number; programId?: string; signature?: string;
  approvalTransactions?: number; approvalBatch?: number; approvalBatches?: number;
};
export type DeploymentBuffer = { buffer: string; writtenBytes: number; complete: boolean; lamports: bigint; remainingChunks: number };
export type DeployResult = { programId: string; buffer: string; signature: string };
export type ProgramRefundQuote = {
  programId: string; programData: string; refundLamports: bigint;
  retainedProgramLamports: bigint; feeLamports: bigint;
};
export type ActiveProgramRefundQuote = ProgramRefundQuote & {
  affectedAccountCount: number;
  /** All program-owned balances, including account rent. These are not refunded. */
  affectedLamports: bigint;
  affectedCreatorVaultCount: number;
  /** Existing creator funds above their vaults' rent reserve. These are not refunded. */
  affectedCreatorFundsLamports: bigint;
  affectedAccountsHash: string;
};

const exact = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("RPC returned an unsafe lamport amount.");
  return BigInt(n);
};
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const tag = (value: number) => { const data = Buffer.alloc(4); data.writeUInt32LE(value); return data; };
const u64 = (value: number) => { const data = Buffer.alloc(8); data.writeBigUInt64LE(BigInt(value)); return data; };

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The expected hash comes from the frontend bundle, not an untrusted fetched manifest. */
export async function validateEscrowArtifact(artifact: ProgramArtifact): Promise<void> {
  const bytes = artifact.bytes;
  if (bytes.length < 64 || bytes.length > MAX_ARTIFACT_BYTES || bytes.length !== manifest.byteLength
    || !equal(bytes.subarray(0, 4), Uint8Array.from([127, 69, 76, 70])) || bytes[4] !== 2 || bytes[5] !== 1
    || artifact.manifest.sha256 !== manifest.sha256 || artifact.manifest.sourceSha256 !== manifest.sourceSha256
    || artifact.manifest.byteLength !== manifest.byteLength || artifact.manifest.version !== manifest.version
    || await sha256(bytes) !== manifest.sha256) {
    throw new Error("The escrow program artifact failed its size, source or SHA256 integrity check.");
  }
}

export async function loadEscrowArtifact(): Promise<ProgramArtifact> {
  const response = await fetch(`/programs/tiktok-escrow.so?v=${manifest.sha256}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || Number(response.headers.get("content-length") || 0) > MAX_ARTIFACT_BYTES) throw new Error("The escrow program artifact could not be loaded.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The escrow program artifact is empty.");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ARTIFACT_BYTES) { await reader.cancel(); throw new Error("The escrow program artifact exceeds the size limit."); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const artifact = { bytes, manifest };
  await validateEscrowArtifact(artifact);
  return artifact;
}

function admin(wallet: DeployWallet): PublicKey {
  if (!wallet.publicKey?.equals(ADMIN_WALLET)) throw new Error("Only the configured admin wallet may deploy or recover program funds.");
  return wallet.publicKey;
}

/** External RPCs must be mainnet. Exact loopback endpoints are reserved for local validator tests. */
export async function assertDeploymentNetwork(connection: Connection): Promise<void> {
  const endpoint = new URL(connection.rpcEndpoint);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (!loopback && await connection.getGenesisHash() !== MAINNET_GENESIS_HASH) throw new Error("Program deployment requires Solana mainnet.");
}

export function programDataAddress(program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([program.toBuffer()], UPGRADEABLE_LOADER)[0];
}

export function initializeBufferInstruction(buffer: PublicKey, authority: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: UPGRADEABLE_LOADER, keys: [
    { pubkey: buffer, isWritable: true, isSigner: false },
    { pubkey: authority, isWritable: false, isSigner: false },
  ], data: tag(0) });
}

export function writeBufferInstruction(buffer: PublicKey, authority: PublicKey, offset: number, bytes: Uint8Array): TransactionInstruction {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_ARTIFACT_BYTES || bytes.length < 1 || bytes.length > WRITE_CHUNK_SIZE || offset + bytes.length > MAX_ARTIFACT_BYTES) throw new Error("Invalid program write range.");
  const start = Buffer.alloc(4); start.writeUInt32LE(offset);
  return new TransactionInstruction({ programId: UPGRADEABLE_LOADER, keys: [
    { pubkey: buffer, isWritable: true, isSigner: false },
    { pubkey: authority, isWritable: false, isSigner: true },
  ], data: Buffer.concat([tag(1), start, u64(bytes.length), Buffer.from(bytes)]) });
}

/** Explicit, small fee budget: upload writes transfer no SOL and allocate no accounts.
 * A 900-byte loader write consumes under 3,000 CU on mainnet. Keep ample headroom,
 * without leaving a mobile wallet to choose a large default for every batch item.
 * Fee quotes and actual writes must use this same builder (25 lamports priority fee).
 */
export function createBufferWriteTransaction(buffer: PublicKey, authority: PublicKey, offset: number, bytes: Uint8Array): Transaction {
  return new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: WRITE_COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: WRITE_COMPUTE_UNIT_PRICE }),
    writeBufferInstruction(buffer, authority, offset, bytes),
  );
}

export function deployProgramInstruction(program: PublicKey, buffer: PublicKey, authority: PublicKey, maxDataLen: number): TransactionInstruction {
  if (!Number.isSafeInteger(maxDataLen) || maxDataLen < manifest.byteLength || maxDataLen > MAX_ARTIFACT_BYTES) throw new Error("Invalid maximum program size.");
  return new TransactionInstruction({ programId: UPGRADEABLE_LOADER, keys: [
    { pubkey: authority, isWritable: true, isSigner: true },
    { pubkey: programDataAddress(program), isWritable: true, isSigner: false },
    { pubkey: program, isWritable: true, isSigner: false },
    { pubkey: buffer, isWritable: true, isSigner: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
    { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
    { pubkey: authority, isWritable: false, isSigner: true },
  ], data: Buffer.concat([tag(2), u64(maxDataLen)]) });
}

export function closeBufferInstruction(buffer: PublicKey, authority: PublicKey): TransactionInstruction {
  if (buffer.equals(authority)) throw new Error("Invalid deployment buffer.");
  return new TransactionInstruction({ programId: UPGRADEABLE_LOADER, keys: [
    { pubkey: buffer, isWritable: true, isSigner: false },
    { pubkey: authority, isWritable: true, isSigner: false },
    { pubkey: authority, isWritable: false, isSigner: true },
  ], data: tag(5) });
}

/** Loader v3 closes ProgramData; the small executable address account remains funded. */
export function closeProgramInstruction(program: PublicKey, authority: PublicKey): TransactionInstruction {
  if (program.equals(authority) || program.equals(SystemProgram.programId)) throw new Error("Invalid program address.");
  return new TransactionInstruction({ programId: UPGRADEABLE_LOADER, keys: [
    { pubkey: programDataAddress(program), isWritable: true, isSigner: false },
    { pubkey: authority, isWritable: true, isSigner: false },
    { pubkey: authority, isWritable: false, isSigner: true },
    { pubkey: program, isWritable: true, isSigner: false },
  ], data: tag(5) });
}

async function assertUnusedProgram(connection: Connection, program: PublicKey): Promise<void> {
  if (ESCROW_PROGRAM_ID?.equals(program)) throw new Error("The site's configured escrow program cannot be closed from this panel.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection.rpcEndpoint).hostname);
  if (!local) {
    // Also check the current server configuration: an older browser tab may be stale.
    const response = await fetch("/api/runtime-status", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Current site configuration could not be checked. Program closure is blocked.");
    const status = await response.json();
    const address = status?.configuration?.escrowProgram?.address;
    if (address !== null && (typeof address !== "string" || !address)) throw new Error("Current site configuration is invalid. Program closure is blocked.");
    if (address && new PublicKey(address).equals(program)) throw new Error("The site's configured escrow program cannot be closed from this panel.");
  }
  // No size/discriminator filters: any owned account blocks closure, even an empty vault.
  const accounts = await connection.getProgramAccounts(program, { commitment: "confirmed", dataSlice: { offset: 0, length: 0 } });
  if (accounts.length) throw new Error("This program owns creator or other accounts. Closing it could strand present or future fees and is blocked.");
}

export async function quoteUnusedProgramRefund(connection: Connection, program: PublicKey, artifact: ProgramArtifact): Promise<ProgramRefundQuote> {
  await assertDeploymentNetwork(connection);
  if (ESCROW_PROGRAM_ID?.equals(program)) throw new Error("The site's configured escrow program cannot be closed from this panel.");
  if (!await inspectDeployedProgram(connection, program, artifact)) throw new Error("This is not an active verified deployment with the configured admin upgrade authority.");
  await assertUnusedProgram(connection, program);
  const programData = programDataAddress(program);
  const [info, data, closeFee] = await Promise.all([
    connection.getAccountInfo(program, "confirmed"),
    connection.getAccountInfo(programData, "confirmed"),
    fee(connection, ADMIN_WALLET, new Transaction().add(closeProgramInstruction(program, ADMIN_WALLET))),
  ]);
  if (!info || !data) throw new Error("Program accounts changed. Inspect the deployment again.");
  return { programId: program.toBase58(), programData: programData.toBase58(), refundLamports: exact(data.lamports), retainedProgramLamports: exact(info.lamports), feeLamports: closeFee + MAX_WALLET_PRIORITY_FEE_LAMPORTS };
}

/** Explicit, irreversible cancellation of an unused deployment, never a routine fee claim.
 * RPC checks are panel safeguards, not an on-chain shutdown lock. The admin must attest that
 * this deployment has never been used/configured anywhere and must not publish it concurrently.
 */
export async function closeUnusedProgram(options: {
  connection: Connection; wallet: DeployWallet; program: PublicKey; artifact: ProgramArtifact;
  confirmedProgramId: string; onSent?: (signature: string) => void;
}): Promise<string> {
  const { connection, wallet, program, artifact } = options;
  const authority = admin(wallet);
  if (options.confirmedProgramId !== program.toBase58()) throw new Error("Type the exact program ID to confirm permanent closure.");
  await quoteUnusedProgramRefund(connection, program, artifact);
  const transaction = await prepare(connection, authority, new Transaction().add(closeProgramInstruction(program, authority)));
  await simulate(connection, transaction);
  const expected = transaction.serializeMessage();
  const expectedHeight = transaction.lastValidBlockHeight;
  const signed = checkedDeploymentSignature(expected, await wallet.signTransaction(transaction), expectedHeight);
  // Reject accounts created or a program configured/upgraded while the wallet prompt was open.
  await quoteUnusedProgramRefund(connection, program, artifact);
  return broadcast(connection, signed, options.onSent);
}

async function assertConfiguredActiveProgram(connection: Connection, program: PublicKey): Promise<void> {
  if (!ESCROW_PROGRAM_ID?.equals(program)) throw new Error("Active program closure requires the exact configured escrow program.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection.rpcEndpoint).hostname);
  if (local) return;
  const response = await fetch("/api/runtime-status", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Current site configuration could not be checked. Program closure is blocked.");
  const status = await response.json();
  if (status?.configuration?.escrowProgram?.address !== program.toBase58()) {
    throw new Error("The configured escrow program changed. Refresh the dashboard before closing it.");
  }
}

/** Read-only review for an explicitly requested shutdown of the active program.
 * Creator accounts are disclosed, not refunded. Closing their owner can make
 * existing and future creator payments permanently inaccessible.
 */
export async function quoteActiveProgramRefund(connection: Connection, program: PublicKey, artifact: ProgramArtifact): Promise<ActiveProgramRefundQuote> {
  await assertDeploymentNetwork(connection);
  await assertConfiguredActiveProgram(connection, program);
  await validateEscrowArtifact(artifact);
  const programData = programDataAddress(program);
  const [[info, data], owned, creatorRent, closeFee] = await Promise.all([
    connection.getMultipleAccountsInfo([program, programData], "confirmed"),
    connection.getProgramAccounts(program, { commitment: "confirmed", dataSlice: { offset: 0, length: 0 } }),
    connection.getMinimumBalanceForRentExemption(CREATOR_VAULT_SIZE, "confirmed"),
    fee(connection, ADMIN_WALLET, new Transaction().add(closeProgramInstruction(program, ADMIN_WALLET))),
  ]);
  if (!await matchesDeployedProgram(info, data, program, artifact)) throw new Error("This is not an active verified deployment with the configured admin upgrade authority.");
  // The browser proxy permits only a narrow zero-data ownership scan. Read the
  // discovered accounts by address to inspect creator funds and hash their state.
  const accounts: { pubkey: PublicKey; account: AccountInfo<Buffer> }[] = [];
  for (let i = 0; i < owned.length; i += 100) {
    const keys = owned.slice(i, i + 100).map(({ pubkey }) => pubkey);
    const infos = await connection.getMultipleAccountsInfo(keys, "confirmed");
    infos.forEach((account, index) => {
      if (!account) throw new Error("An affected account changed during inspection. Inspect the program again.");
      accounts.push({ pubkey: keys[index], account });
    });
  }
  const rent = exact(creatorRent);
  let affectedLamports = 0n, affectedCreatorFundsLamports = 0n, affectedCreatorVaultCount = 0;
  const snapshot = await Promise.all(accounts.map(async ({ pubkey, account }) => {
    if (!account.owner.equals(program)) throw new Error("RPC returned an account owned by another program.");
    const lamports = exact(account.lamports);
    affectedLamports += lamports;
    if (decodeCreatorVault(account, pubkey)) {
      affectedCreatorVaultCount++;
      affectedCreatorFundsLamports += lamports > rent ? lamports - rent : 0n;
    }
    return { address: pubkey.toBase58(), lamports: lamports.toString(), executable: account.executable, dataSha256: await sha256(account.data) };
  }));
  snapshot.sort((a, b) => a.address.localeCompare(b.address));
  const refundLamports = exact(data!.lamports), retainedProgramLamports = exact(info!.lamports);
  const affectedAccountsHash = await sha256(new TextEncoder().encode(JSON.stringify({
    program: program.toBase58(), refundLamports: refundLamports.toString(), retainedProgramLamports: retainedProgramLamports.toString(),
    programDataSha256: await sha256(data!.data), accounts: snapshot,
  })));
  return { programId: program.toBase58(), programData: programData.toBase58(), refundLamports, retainedProgramLamports,
    feeLamports: closeFee + MAX_WALLET_PRIORITY_FEE_LAMPORTS,
    affectedAccountCount: accounts.length, affectedLamports, affectedCreatorVaultCount, affectedCreatorFundsLamports, affectedAccountsHash };
}

/** Separate from unused-deployment recovery: requires explicit acceptance of
 * creator-fund loss and the exact account snapshot shown in the latest quote.
 * RPC rechecks narrow races; they cannot prevent a new deposit after broadcast.
 */
export async function closeActiveProgram(options: {
  connection: Connection; wallet: DeployWallet; program: PublicKey; artifact: ProgramArtifact;
  confirmedProgramId: string; acknowledgedCreatorFundsLoss: boolean; reviewedAffectedAccountsHash: string;
  onSent?: (signature: string) => void;
}): Promise<string> {
  const { connection, wallet, program, artifact } = options;
  const authority = admin(wallet);
  if (options.confirmedProgramId !== program.toBase58()) throw new Error("Type the exact program ID to confirm permanent closure.");
  if (options.acknowledgedCreatorFundsLoss !== true) throw new Error("Acknowledge that closing the active program can make existing and future creator funds permanently inaccessible.");
  if (!/^[a-f0-9]{64}$/.test(options.reviewedAffectedAccountsHash)) throw new Error("Inspect the affected accounts before closing the active program.");
  const assertReviewed = async () => {
    const current = await quoteActiveProgramRefund(connection, program, artifact);
    if (current.affectedAccountsHash !== options.reviewedAffectedAccountsHash) throw new Error("Program balances or affected creator accounts changed. Inspect again and review the new shutdown amounts.");
  };
  await assertReviewed();
  const transaction = await prepare(connection, authority, new Transaction().add(closeProgramInstruction(program, authority)));
  await simulate(connection, transaction);
  // Review checks happen after preflight and again after the wallet prompt.
  await assertReviewed();
  const expected = transaction.serializeMessage();
  const expectedHeight = transaction.lastValidBlockHeight;
  const signed = checkedDeploymentSignature(expected, await wallet.signTransaction(transaction), expectedHeight);
  await assertReviewed();
  return broadcast(connection, signed, options.onSent, "Check this shutdown transaction on Solscan before trying again. If confirmed, the program is closed; do not submit another closure.");
}

function bufferBytes(info: AccountInfo<Buffer> | null, authority: PublicKey, length: number): Uint8Array {
  if (!info || info.executable || !info.owner.equals(UPGRADEABLE_LOADER) || info.data.length !== BUFFER_HEADER_SIZE + length
    || info.data.readUInt32LE(0) !== 1 || info.data[4] !== 1 || !new PublicKey(info.data.subarray(5, 37)).equals(authority)) {
    throw new Error("Deployment buffer does not belong to the configured admin or has an invalid loader state.");
  }
  return info.data.subarray(BUFFER_HEADER_SIZE);
}

function pendingChunks(bytes: Uint8Array, artifact: ProgramArtifact): { offset: number; bytes: Uint8Array }[] {
  const pending: { offset: number; bytes: Uint8Array }[] = [];
  for (let offset = 0; offset < artifact.bytes.length; offset += WRITE_CHUNK_SIZE) {
    const chunk = artifact.bytes.subarray(offset, offset + WRITE_CHUNK_SIZE);
    if (!equal(bytes.subarray(offset, offset + chunk.length), chunk)) pending.push({ offset, bytes: chunk });
  }
  return pending;
}

export async function inspectDeploymentBuffer(connection: Connection, buffer: PublicKey, artifact: ProgramArtifact): Promise<DeploymentBuffer> {
  await assertDeploymentNetwork(connection);
  await validateEscrowArtifact(artifact);
  const info = await connection.getAccountInfo(buffer, "confirmed");
  const bytes = bufferBytes(info, ADMIN_WALLET, artifact.bytes.length);
  const pending = pendingChunks(bytes, artifact);
  const writtenBytes = artifact.bytes.length - pending.reduce((sum, chunk) => sum + chunk.bytes.length, 0);
  return { buffer: buffer.toBase58(), writtenBytes, complete: pending.length === 0, remainingChunks: pending.length, lamports: exact(info!.lamports) };
}

function createBufferTransaction(authority: PublicKey, buffer: PublicKey, length: number, lamports: number): Transaction {
  return new Transaction().add(SystemProgram.createAccount({ fromPubkey: authority, newAccountPubkey: buffer, lamports, space: BUFFER_HEADER_SIZE + length, programId: UPGRADEABLE_LOADER }), initializeBufferInstruction(buffer, authority));
}

function createProgramTransaction(authority: PublicKey, program: PublicKey, buffer: PublicKey, maxDataLen: number, lamports: number): Transaction {
  return new Transaction().add(SystemProgram.createAccount({ fromPubkey: authority, newAccountPubkey: program, lamports, space: PROGRAM_ACCOUNT_SIZE, programId: UPGRADEABLE_LOADER }), deployProgramInstruction(program, buffer, authority, maxDataLen));
}

async function prepare(connection: Connection, authority: PublicKey, transaction: Transaction): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = authority;
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  return transaction;
}

async function fee(connection: Connection, authority: PublicKey, transaction: Transaction): Promise<bigint> {
  await prepare(connection, authority, transaction);
  const result = await connection.getFeeForMessage(transaction.compileMessage(), "confirmed");
  if (result.value === null) throw new Error("RPC could not estimate the deployment transaction fee.");
  return exact(result.value);
}

export async function quoteProgramDeployment(connection: Connection, authority: PublicKey, artifact: ProgramArtifact, options: { maxDataLen?: number } = {}): Promise<DeploymentQuote> {
  if (!authority.equals(ADMIN_WALLET)) throw new Error("Only the configured admin wallet may request a deployment quote.");
  await assertDeploymentNetwork(connection);
  await validateEscrowArtifact(artifact);
  const maxDataLen = options.maxDataLen ?? artifact.bytes.length;
  // Public quote placeholders never represent generated/stored private keys.
  const buffer = PublicKey.findProgramAddressSync([Buffer.from("quote-buffer"), authority.toBuffer()], UPGRADEABLE_LOADER)[0];
  const program = PublicKey.findProgramAddressSync([Buffer.from("quote-program"), authority.toBuffer()], UPGRADEABLE_LOADER)[0];
  deployProgramInstruction(program, buffer, authority, maxDataLen);
  const [bufferRent, programRent, programDataRent, balance, walletRent] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(BUFFER_HEADER_SIZE + artifact.bytes.length, "confirmed"),
    connection.getMinimumBalanceForRentExemption(PROGRAM_ACCOUNT_SIZE, "confirmed"),
    connection.getMinimumBalanceForRentExemption(PROGRAM_DATA_HEADER_SIZE + maxDataLen, "confirmed"),
    connection.getBalance(authority, "confirmed"),
    connection.getMinimumBalanceForRentExemption(0, "confirmed"),
  ]);
  const [createFee, writeFee, deployFee, recoveryFeeLamports] = await Promise.all([
    fee(connection, authority, createBufferTransaction(authority, buffer, artifact.bytes.length, bufferRent)),
    fee(connection, authority, createBufferWriteTransaction(buffer, authority, 0, artifact.bytes.subarray(0, WRITE_CHUNK_SIZE))),
    fee(connection, authority, createProgramTransaction(authority, program, buffer, maxDataLen, programRent)),
    fee(connection, authority, new Transaction().add(closeBufferInstruction(buffer, authority))),
  ]);
  const writeTransactions = Math.ceil(artifact.bytes.length / WRITE_CHUNK_SIZE);
  const transactionFeesLamports = createFee + writeFee * BigInt(writeTransactions) + deployFee;
  const lockedRentLamports = exact(programRent) + exact(programDataRent);
  const finalCostLamports = lockedRentLamports + transactionFeesLamports;
  // Loader v3 drains the buffer into the payer BEFORE funding ProgramData.
  // Count that SOL once and retain a rent-exempt payer balance plus a recovery fee.
  const walletFeeReserveLamports = MAX_WALLET_PRIORITY_FEE_LAMPORTS * BigInt(writeTransactions + 3);
  const requiredLamports = finalCostLamports + exact(walletRent) + recoveryFeeLamports + walletFeeReserveLamports;
  return { binaryBytes: artifact.bytes.length, maxDataLen, writeTransactions, totalTransactions: writeTransactions + 2,
    walletRentLamports: exact(walletRent), bufferRentLamports: exact(bufferRent), programRentLamports: exact(programRent), programDataRentLamports: exact(programDataRent),
    lockedRentLamports, transactionFeesLamports, recoveryFeeLamports, walletFeeReserveLamports, requiredLamports, finalCostLamports,
    createFeeLamports: createFee, writeFeeLamports: writeFee, deployFeeLamports: deployFee,
    balanceLamports: exact(balance), sufficientBalance: exact(balance) >= requiredLamports };
}

/** Required wallet balance when an authenticated upload buffer is already funded. */
export function remainingDeploymentBalance(quote: DeploymentQuote, bufferLamports: bigint, remainingChunks: number): bigint {
  if (bufferLamports < 0n || !Number.isSafeInteger(remainingChunks) || remainingChunks < 0 || remainingChunks > quote.writeTransactions) throw new Error("Invalid deployment balance inputs.");
  const dataTopUp = quote.programDataRentLamports > bufferLamports ? quote.programDataRentLamports - bufferLamports : 0n;
  // The Program account is created before the loader releases buffer SOL.
  return quote.programRentLamports + dataTopUp + quote.writeFeeLamports * BigInt(remainingChunks) + quote.deployFeeLamports + quote.walletRentLamports + quote.recoveryFeeLamports + MAX_WALLET_PRIORITY_FEE_LAMPORTS * BigInt(remainingChunks + 2);
}

async function simulate(connection: Connection, transaction: Transaction): Promise<void> {
  const response = await connection.simulateTransaction(new VersionedTransaction(transaction.compileMessage()), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  if (response.value.err) throw new Error(`Program transaction simulation failed: ${JSON.stringify(response.value.err)}. ${(response.value.logs || []).slice(-4).join(" ")}`);
}


async function broadcast(connection: Connection, transaction: Transaction, onSent?: (signature: string) => void,
  recoveryHint = "Check its status and resume the saved buffer; do not create another upload."): Promise<string> {
  const bytes = transaction.serialize();
  if (!transaction.signature) throw new Error("Missing deployment transaction signature.");
  const signature = bs58.encode(transaction.signature);
  // Save the signed transaction ID BEFORE submission: a lost HTTP response must not hide it.
  onSent?.(signature);
  try {
    // Wallets may pick a newer processed hash. Preflight checks that exact signed hash and
    // every signature; confirmed reads remain the success criterion after submission.
    const returned = await connection.sendRawTransaction(bytes, { skipPreflight: false, maxRetries: 3, preflightCommitment: "processed" });
    if (returned !== signature) throw new Error("RPC returned a different transaction signature.");
    // A wallet-refreshed hash has no trusted lastValidBlockHeight. Use the SDK's bounded
    // signature confirmation in that case, never pair it with another hash's expiry.
    const response = transaction.lastValidBlockHeight === undefined
      ? await connection.confirmTransaction(signature, "confirmed")
      : await connection.confirmTransaction({ signature, blockhash: transaction.recentBlockhash!, lastValidBlockHeight: transaction.lastValidBlockHeight }, "confirmed");
    if (response.value.err) throw new Error(`Program transaction failed: ${JSON.stringify(response.value.err)}`);
  } catch (error) {
    // Mobile/websocket disconnects may happen AFTER a successful payment or write.
    // Read the exact signed transaction; never start a second payment to resolve uncertainty.
    const status = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true }).catch(() => null);
    const value = status?.value[0];
    if (value?.err) throw new Error(`Program transaction failed: ${JSON.stringify(value.err)}. Transaction: ${signature}`);
    if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") return signature;
    throw new Error(`${error instanceof Error ? error.message : String(error)} Transaction: ${signature}. ${recoveryHint}`);
  }
  return signature;
}

export async function inspectDeployedProgram(connection: Connection, program: PublicKey, artifact: ProgramArtifact): Promise<boolean> {
  await assertDeploymentNetwork(connection);
  await validateEscrowArtifact(artifact);
  const address = programDataAddress(program);
  const [info, data] = await Promise.all([connection.getAccountInfo(program, "confirmed"), connection.getAccountInfo(address, "confirmed")]);
  return matchesDeployedProgram(info, data, program, artifact);
}

async function matchesDeployedProgram(info: AccountInfo<Buffer> | null, data: AccountInfo<Buffer> | null, program: PublicKey, artifact: ProgramArtifact): Promise<boolean> {
  const address = programDataAddress(program);
  if (!info?.executable || !info.owner.equals(UPGRADEABLE_LOADER) || info.data.length !== PROGRAM_ACCOUNT_SIZE || info.data.readUInt32LE(0) !== 2 || !new PublicKey(info.data.subarray(4, 36)).equals(address)
    || !data || !data.owner.equals(UPGRADEABLE_LOADER) || data.executable
    || data.data.length < PROGRAM_DATA_HEADER_SIZE + artifact.bytes.length || data.data.length > PROGRAM_DATA_HEADER_SIZE + MAX_ARTIFACT_BYTES
    || data.data.readUInt32LE(0) !== 3 || data.data[12] !== 1 || !new PublicKey(data.data.subarray(13, 45)).equals(ADMIN_WALLET)
    || data.data.subarray(PROGRAM_DATA_HEADER_SIZE + artifact.bytes.length).some((byte) => byte !== 0)) return false;
  return await sha256(data.data.subarray(PROGRAM_DATA_HEADER_SIZE, PROGRAM_DATA_HEADER_SIZE + artifact.bytes.length)) === manifest.sha256;
}

/** Call only from an explicit admin action. Public buffer keys are safe to persist.
 * Ephemeral Keypairs stay in memory; writes/resume and close need only admin's signature.
 * Save progress.programId/signature before final confirmation for reload recovery.
 */
export async function deployEscrowProgram(options: {
  connection: Connection; wallet: DeployWallet; artifact: ProgramArtifact; resumeBuffer?: PublicKey; maxDataLen?: number;
  onProgress?: (progress: DeployProgress) => void; onBufferCreated?: (buffer: string) => void;
  onTransaction?: (signature: string) => void; writeBatchSize?: number;
}): Promise<DeployResult> {
  const { connection, wallet, onProgress } = options;
  const authority = admin(wallet);
  const requestedBatchSize = options.writeBatchSize ?? DEFAULT_UPLOAD_SIGNING_BATCH;
  if (!Number.isInteger(requestedBatchSize) || requestedBatchSize < 1 || requestedBatchSize > MAX_UPLOAD_SIGNING_BATCH) throw new Error("Invalid upload signing batch size.");
  // A wallet without batch signing must send each signed transaction immediately.
  const batchSize = wallet.signAllTransactions ? requestedBatchSize : 1;
  // Snapshot bytes: callers cannot alter chunks while a wallet approval is pending.
  const artifact = { ...options.artifact, bytes: Uint8Array.from(options.artifact.bytes) };
  let buffer: PublicKey | null = options.resumeBuffer ?? null;
  let writtenBytes = 0;
  const progress = (phase: DeployProgress["phase"], extra: Partial<DeployProgress> = {}) => onProgress?.({ phase, buffer: buffer?.toBase58() ?? null, writtenBytes, totalBytes: artifact.bytes.length, ...extra });
  progress("checking");
  const quote = await quoteProgramDeployment(connection, authority, artifact, { maxDataLen: options.maxDataLen });
  if (!buffer && !quote.sufficientBalance) throw new Error("The admin wallet does not have the SOL balance required for deployment and recovery.");
  if (!buffer) {
    const temporary = Keypair.generate();
    buffer = temporary.publicKey;
    progress("creating-buffer");
    const transaction = await prepare(connection, authority, createBufferTransaction(authority, buffer, artifact.bytes.length, Number(quote.bufferRentLamports)));
    await simulate(connection, transaction);
    transaction.partialSign(temporary);
    const expectedMessage = transaction.serializeMessage();
    const expectedHeight = transaction.lastValidBlockHeight;
    const signed = checkedDeploymentSignature(expectedMessage, await wallet.signTransaction(transaction), expectedHeight, [temporary]);
    // Store the public buffer key before sending: uncertain confirmation must not lose it.
    options.onBufferCreated?.(buffer.toBase58());
    await broadcast(connection, signed, options.onTransaction);
  }
  const info = await connection.getAccountInfo(buffer, "confirmed");
  const pending = pendingChunks(bufferBytes(info, authority, artifact.bytes.length), artifact);
  writtenBytes = artifact.bytes.length - pending.reduce((sum, chunk) => sum + chunk.bytes.length, 0);
  if (exact(await connection.getBalance(authority, "confirmed")) < remainingDeploymentBalance(quote, exact(info!.lamports), pending.length)) throw new Error("Insufficient SOL remains for deployment. The admin can close the saved buffer to recover its rent.");
  progress("writing");
  // Small automatic groups keep mobile wallet approval/fee estimation bounded. A larger
  // group is opt-in; every group uses fresh hashes and is validated before any broadcast.
  for (let start = 0; start < pending.length; start += batchSize) {
    const chunks = pending.slice(start, start + batchSize);
    // Test the exact write and its compute limit against the real buffer before approval.
    // This is read-only: it neither funds the buffer again nor submits an unsigned write.
    await simulate(connection, await prepare(connection, authority, createBufferWriteTransaction(buffer, authority, chunks[0].offset, chunks[0].bytes)));
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const transactions = chunks.map((chunk) => {
      const tx = createBufferWriteTransaction(buffer!, authority, chunk.offset, chunk.bytes);
      tx.feePayer = authority;
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      return tx;
    });
    const messages = transactions.map((transaction) => transaction.serializeMessage());
    const signed: Transaction[] = [];
    const approval = { approvalTransactions: chunks.length, approvalBatch: Math.floor(start / batchSize) + 1, approvalBatches: Math.ceil(pending.length / batchSize) };
    progress("awaiting-upload-approval", approval);
    if (batchSize > 1 && wallet.signAllTransactions) signed.push(...await wallet.signAllTransactions(transactions));
    else for (const transaction of transactions) signed.push(await wallet.signTransaction(transaction));
    if (signed.length !== transactions.length) throw new Error("The wallet returned an incomplete deployment batch.");
    // Validate the ENTIRE batch before sending any of it, including every admin signature.
    const verified = signed.map((transaction, i) => checkedDeploymentSignature(messages[i], transaction, lastValidBlockHeight));
    progress("writing", approval);
    await sendUploadQueue(verified, async (transaction, i) => {
      await broadcast(connection, transaction, options.onTransaction);
      writtenBytes += chunks[i].bytes.length;
      progress("writing", approval);
    });
  }
  if (!(await inspectDeploymentBuffer(connection, buffer, artifact)).complete) throw new Error("Program buffer readback failed. Resume the saved buffer before deployment.");
  const program = Keypair.generate();
  const transaction = await prepare(connection, authority, createProgramTransaction(authority, program.publicKey, buffer, quote.maxDataLen, Number(quote.programRentLamports)));
  const finalFee = await fee(connection, authority, transaction);
  const finalBuffer = await connection.getAccountInfo(buffer, "confirmed");
  bufferBytes(finalBuffer, authority, artifact.bytes.length);
  if (exact(await connection.getBalance(authority, "confirmed")) < remainingDeploymentBalance({ ...quote, deployFeeLamports: finalFee }, exact(finalBuffer!.lamports), 0)) throw new Error("Insufficient SOL remains to deploy. Buffer rent can be recovered by the admin.");
  progress("simulating", { programId: program.publicKey.toBase58() });
  await simulate(connection, transaction);
  transaction.partialSign(program);
  const expectedMessage = transaction.serializeMessage();
  const expectedHeight = transaction.lastValidBlockHeight;
  const signed = checkedDeploymentSignature(expectedMessage, await wallet.signTransaction(transaction), expectedHeight, [program]);
  progress("deploying", { programId: program.publicKey.toBase58() });
  let signature = "";
  try {
    signature = await broadcast(connection, signed, (sig) => { signature = sig; options.onTransaction?.(sig); progress("deploying", { programId: program.publicKey.toBase58(), signature: sig }); });
  } catch (error) {
    // A lost RPC confirmation can still mean a successful deployment. Check it.
    if (!signature || !await inspectDeployedProgram(connection, program.publicKey, artifact)) throw error;
  }
  if (!await inspectDeployedProgram(connection, program.publicKey, artifact)) throw new Error(`Deployment could not be verified. Preserve program ${program.publicKey.toBase58()} and signature ${signature}.`);
  progress("complete", { programId: program.publicKey.toBase58(), signature });
  return { programId: program.publicKey.toBase58(), buffer: buffer.toBase58(), signature };
}

/** Refunds a verified loader Buffer only, never a deployed Program/ProgramData. */
export async function closeDeploymentBuffer(options: { connection: Connection; wallet: DeployWallet; buffer: PublicKey }): Promise<string> {
  const { connection, wallet, buffer } = options;
  const authority = admin(wallet);
  await assertDeploymentNetwork(connection);
  const info = await connection.getAccountInfo(buffer, "confirmed");
  if (!info || info.data.length < BUFFER_HEADER_SIZE || info.data.length > BUFFER_HEADER_SIZE + MAX_ARTIFACT_BYTES) throw new Error("Deployment buffer is missing or invalid.");
  bufferBytes(info, authority, info.data.length - BUFFER_HEADER_SIZE);
  const transaction = await prepare(connection, authority, new Transaction().add(closeBufferInstruction(buffer, authority)));
  await simulate(connection, transaction);
  const expected = transaction.serializeMessage();
  const expectedHeight = transaction.lastValidBlockHeight;
  const signed = checkedDeploymentSignature(expected, await wallet.signTransaction(transaction), expectedHeight);
  return broadcast(connection, signed);
}
