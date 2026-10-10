import bs58 from "bs58";
import {
  Keypair, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY,
  Transaction, TransactionInstruction, VersionedTransaction,
  type AccountInfo, type Connection,
} from "@solana/web3.js";
import { ADMIN_WALLET, MAINNET_GENESIS_HASH } from "../admin-config";
import { ESCROW_PROGRAM_ID } from "../tiktok-config";
import artifactManifest from "../../../public/programs/tiktok-escrow.manifest.json";

const manifest = Object.freeze({ ...artifactManifest, sourceFiles: Object.freeze([...artifactManifest.sourceFiles]) });

export const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export const BUFFER_HEADER_SIZE = 37;
export const PROGRAM_ACCOUNT_SIZE = 36;
export const PROGRAM_DATA_HEADER_SIZE = 45;
export const WRITE_CHUNK_SIZE = 900;
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
  walletRentLamports: bigint; bufferRentLamports: bigint; programRentLamports: bigint; programDataRentLamports: bigint;
  lockedRentLamports: bigint; transactionFeesLamports: bigint; recoveryFeeLamports: bigint;
  createFeeLamports: bigint; writeFeeLamports: bigint; deployFeeLamports: bigint;
  requiredLamports: bigint; finalCostLamports: bigint; balanceLamports: bigint; sufficientBalance: boolean;
};
export type DeployProgress = {
  phase: "checking" | "creating-buffer" | "writing" | "simulating" | "deploying" | "complete";
  buffer: string | null; writtenBytes: number; totalBytes: number; programId?: string; signature?: string;
};
export type DeploymentBuffer = { buffer: string; writtenBytes: number; complete: boolean; lamports: bigint; remainingChunks: number };
export type DeployResult = { programId: string; buffer: string; signature: string };
export type ProgramRefundQuote = {
  programId: string; programData: string; refundLamports: bigint;
  retainedProgramLamports: bigint; feeLamports: bigint;
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
  return { programId: program.toBase58(), programData: programData.toBase58(), refundLamports: exact(data.lamports), retainedProgramLamports: exact(info.lamports), feeLamports: closeFee };
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
  const signed = await wallet.signTransaction(transaction);
  if (!equal(expected, signed.serializeMessage())) throw new Error("The wallet changed the program refund transaction.");
  // Reject accounts created or a program configured/upgraded while the wallet prompt was open.
  await quoteUnusedProgramRefund(connection, program, artifact);
  return broadcast(connection, checkedSigned(transaction, signed), options.onSent);
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
    fee(connection, authority, new Transaction().add(writeBufferInstruction(buffer, authority, 0, artifact.bytes.subarray(0, WRITE_CHUNK_SIZE)))),
    fee(connection, authority, createProgramTransaction(authority, program, buffer, maxDataLen, programRent)),
    fee(connection, authority, new Transaction().add(closeBufferInstruction(buffer, authority))),
  ]);
  const writeTransactions = Math.ceil(artifact.bytes.length / WRITE_CHUNK_SIZE);
  const transactionFeesLamports = createFee + writeFee * BigInt(writeTransactions) + deployFee;
  const lockedRentLamports = exact(programRent) + exact(programDataRent);
  const finalCostLamports = lockedRentLamports + transactionFeesLamports;
  // Loader v3 drains the buffer into the payer BEFORE funding ProgramData.
  // Count that SOL once and retain a rent-exempt payer balance plus a recovery fee.
  const requiredLamports = finalCostLamports + exact(walletRent) + recoveryFeeLamports;
  return { binaryBytes: artifact.bytes.length, maxDataLen, writeTransactions, totalTransactions: writeTransactions + 2,
    walletRentLamports: exact(walletRent), bufferRentLamports: exact(bufferRent), programRentLamports: exact(programRent), programDataRentLamports: exact(programDataRent),
    lockedRentLamports, transactionFeesLamports, recoveryFeeLamports, requiredLamports, finalCostLamports,
    createFeeLamports: createFee, writeFeeLamports: writeFee, deployFeeLamports: deployFee,
    balanceLamports: exact(balance), sufficientBalance: exact(balance) >= requiredLamports };
}

/** Required wallet balance when an authenticated upload buffer is already funded. */
export function remainingDeploymentBalance(quote: DeploymentQuote, bufferLamports: bigint, remainingChunks: number): bigint {
  if (bufferLamports < 0n || !Number.isSafeInteger(remainingChunks) || remainingChunks < 0 || remainingChunks > quote.writeTransactions) throw new Error("Invalid deployment balance inputs.");
  const dataTopUp = quote.programDataRentLamports > bufferLamports ? quote.programDataRentLamports - bufferLamports : 0n;
  // The Program account is created before the loader releases buffer SOL.
  return quote.programRentLamports + dataTopUp + quote.writeFeeLamports * BigInt(remainingChunks) + quote.deployFeeLamports + quote.walletRentLamports + quote.recoveryFeeLamports;
}

async function simulate(connection: Connection, transaction: Transaction): Promise<void> {
  const response = await connection.simulateTransaction(new VersionedTransaction(transaction.compileMessage()), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  if (response.value.err) throw new Error(`Program transaction simulation failed: ${JSON.stringify(response.value.err)}. ${(response.value.logs || []).slice(-4).join(" ")}`);
}

function checkedSigned(expected: Transaction, returned: Transaction): Transaction {
  if (!equal(expected.serializeMessage(), returned.serializeMessage())) throw new Error("The wallet changed the deployment transaction.");
  // Verifies all signatures, including ephemeral buffer/program signatures.
  returned.serialize({ requireAllSignatures: true, verifySignatures: true });
  // Wallet adapters often deserialize a new Transaction; block height is not
  // serialized into it. Preserve our confirmation lifetime separately.
  returned.lastValidBlockHeight = expected.lastValidBlockHeight;
  return returned;
}

async function broadcast(connection: Connection, transaction: Transaction, onSent?: (signature: string) => void): Promise<string> {
  const bytes = transaction.serialize();
  if (!transaction.signature) throw new Error("Missing deployment transaction signature.");
  const signature = bs58.encode(transaction.signature);
  // Save the signed transaction ID BEFORE submission: a lost HTTP response must not hide it.
  onSent?.(signature);
  try {
    const returned = await connection.sendRawTransaction(bytes, { skipPreflight: false, maxRetries: 3, preflightCommitment: "confirmed" });
    if (returned !== signature) throw new Error("RPC returned a different transaction signature.");
    const response = await connection.confirmTransaction({ signature, blockhash: transaction.recentBlockhash!, lastValidBlockHeight: transaction.lastValidBlockHeight! }, "confirmed");
    if (response.value.err) throw new Error(`Program transaction failed: ${JSON.stringify(response.value.err)}`);
  } catch (error) {
    // Mobile/websocket disconnects may happen AFTER a successful payment or write.
    // Read the exact signed transaction; never start a second payment to resolve uncertainty.
    const status = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true }).catch(() => null);
    const value = status?.value[0];
    if (value?.err) throw new Error(`Program transaction failed: ${JSON.stringify(value.err)}. Transaction: ${signature}`);
    if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") return signature;
    throw new Error(`${error instanceof Error ? error.message : String(error)} Transaction: ${signature}. Check its status and resume the saved buffer; do not create another upload.`);
  }
  return signature;
}

export async function inspectDeployedProgram(connection: Connection, program: PublicKey, artifact: ProgramArtifact): Promise<boolean> {
  await assertDeploymentNetwork(connection);
  await validateEscrowArtifact(artifact);
  const address = programDataAddress(program);
  const [info, data] = await Promise.all([connection.getAccountInfo(program, "confirmed"), connection.getAccountInfo(address, "confirmed")]);
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
  const requestedBatchSize = options.writeBatchSize ?? 4;
  if (!Number.isInteger(requestedBatchSize) || requestedBatchSize < 1 || requestedBatchSize > 16) throw new Error("Invalid upload signing batch size.");
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
    const signed = await wallet.signTransaction(transaction);
    if (!equal(expectedMessage, signed.serializeMessage())) throw new Error("The wallet changed the buffer creation transaction.");
    checkedSigned(transaction, signed);
    // Store the public buffer key before sending: uncertain confirmation must not lose it.
    options.onBufferCreated?.(buffer.toBase58());
    await broadcast(connection, signed, options.onTransaction);
  }
  const info = await connection.getAccountInfo(buffer, "confirmed");
  const pending = pendingChunks(bufferBytes(info, authority, artifact.bytes.length), artifact);
  writtenBytes = artifact.bytes.length - pending.reduce((sum, chunk) => sum + chunk.bytes.length, 0);
  if (exact(await connection.getBalance(authority, "confirmed")) < remainingDeploymentBalance(quote, exact(info!.lamports), pending.length)) throw new Error("Insufficient SOL remains for deployment. The admin can close the saved buffer to recover its rent.");
  progress("writing");
  // Batches keep blockhashes fresh and work with wallets that sign all at once.
  for (let start = 0; start < pending.length; start += batchSize) {
    const chunks = pending.slice(start, start + batchSize);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const transactions = chunks.map((chunk) => {
      const tx = new Transaction({ feePayer: authority, blockhash, lastValidBlockHeight });
      tx.add(writeBufferInstruction(buffer!, authority, chunk.offset, chunk.bytes));
      return tx;
    });
    const messages = transactions.map((transaction) => transaction.serializeMessage());
    const signed: Transaction[] = [];
    if (batchSize > 1 && wallet.signAllTransactions) signed.push(...await wallet.signAllTransactions(transactions));
    else for (const transaction of transactions) signed.push(await wallet.signTransaction(transaction));
    if (signed.length !== transactions.length) throw new Error("The wallet returned an incomplete deployment batch.");
    for (let i = 0; i < signed.length; i++) {
      if (!equal(messages[i], signed[i].serializeMessage())) throw new Error("The wallet changed a program write transaction.");
      checkedSigned(transactions[i], signed[i]);
      await broadcast(connection, signed[i], options.onTransaction);
      writtenBytes += chunks[i].bytes.length;
      progress("writing");
    }
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
  const signed = await wallet.signTransaction(transaction);
  if (!equal(expectedMessage, signed.serializeMessage())) throw new Error("The wallet changed the program deployment transaction.");
  checkedSigned(transaction, signed);
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
  const signed = await wallet.signTransaction(transaction);
  if (!equal(expected, signed.serializeMessage())) throw new Error("The wallet changed the buffer refund transaction.");
  return broadcast(connection, checkedSigned(transaction, signed));
}
