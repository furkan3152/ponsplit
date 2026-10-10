import { PublicKey, SystemProgram, TransactionInstruction, type AccountInfo, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { ESCROW_PROGRAM_ID, VERIFIER } from "../tiktok-config";
import { normalizeCreatorHandle, type EscrowConfig } from "./tiktok-escrow";

export const CREATOR_PROOF_SIZE = 143;
export const CREATOR_PROOF_REQUEST_SIZE = CREATOR_PROOF_SIZE;
export const CREATOR_PROOF_LIFETIME_SECONDS = 172_800n;
const MAGIC = Buffer.from("TIKPROOF");
const SEED = Buffer.from("proof");
const VIDEO_ID = /^[1-9][0-9]{0,19}$/;
const I64_MAX = (1n << 63n) - 1n;

export type CreatorProof = Readonly<{
  account: string;
  handle: string;
  verifier: PublicKey;
  beneficiary: PublicKey;
  nonce: Uint8Array;
  createdAt: bigint;
  expiresAt: bigint;
  videoId: string | null;
  expired: boolean;
  data: Uint8Array;
}>;

function settings(config?: EscrowConfig): EscrowConfig {
  const program = config?.program ?? ESCROW_PROGRAM_ID;
  const verifier = config?.verifier ?? VERIFIER;
  if (!program || !verifier || program.equals(PublicKey.default) || verifier.equals(PublicKey.default)) throw new Error("Creator proof program and verifier are not configured.");
  return { program, verifier };
}

function validBeneficiary(beneficiary: PublicKey, verifier: PublicKey): void {
  if (beneficiary.equals(PublicKey.default) || beneficiary.equals(verifier)) throw new Error("Use a creator wallet distinct from the verification authority.");
}

function validNonce(nonce: Uint8Array): void {
  if (nonce.length !== 16 || !nonce.some((byte) => byte !== 0)) throw new Error("A nonzero 16-byte proof nonce is required.");
}

export function generateCreatorProofNonce(): Uint8Array {
  let nonce: Uint8Array;
  do { nonce = crypto.getRandomValues(new Uint8Array(16)); } while (!nonce.some((byte) => byte !== 0));
  return nonce;
}

export function proofChallenge(proof: Pick<CreatorProof, "handle" | "beneficiary" | "nonce">): string {
  validNonce(proof.nonce);
  const handle = normalizeCreatorHandle(proof.handle);
  if (proof.beneficiary.equals(PublicKey.default)) throw new Error("A creator wallet is required for the video challenge.");
  // Full wallet and handle prevent copying a public nonce onto a different beneficiary's request.
  return `TIK-${handle}-${proof.beneficiary.toBase58()}-${Array.from(proof.nonce, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Exact account/video paths are checked, then ordinary share tracking is discarded. */
export function parseTikTokProofVideo(input: string, handle: string): { videoId: string; url: string } {
  const creator = normalizeCreatorHandle(handle);
  const url = new URL(input.trim());
  const match = /^\/@([a-z0-9_.]{1,24})\/video\/([1-9][0-9]{0,19})$/i.exec(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "www.tiktok.com" || url.port || url.username || url.password || url.hash
    || !match || match[1].toLowerCase() !== creator) throw new Error("Use the original HTTPS TikTok video URL for this exact creator, without fragments.");
  return { videoId: match[2], url: `https://www.tiktok.com/@${creator}/video/${match[2]}` };
}

export function creatorProof(handle: string, beneficiary: PublicKey, program: PublicKey | null = ESCROW_PROGRAM_ID, verifier: PublicKey | null = VERIFIER): PublicKey {
  if (!program || !verifier) throw new Error("Creator proof program and verifier are not configured.");
  const config = settings({ program, verifier });
  validBeneficiary(beneficiary, config.verifier);
  return PublicKey.findProgramAddressSync([SEED, config.verifier.toBuffer(), Buffer.from(normalizeCreatorHandle(handle)), beneficiary.toBuffer()], config.program)[0];
}

export function requestCreatorProofInstruction(handle: string, beneficiary: PublicKey, nonce: Uint8Array, config?: EscrowConfig): TransactionInstruction {
  const current = settings(config);
  validNonce(nonce);
  const name = Buffer.from(normalizeCreatorHandle(handle));
  // The vault must already exist; this request does not initialize a fee recipient implicitly.
  const vault = PublicKey.findProgramAddressSync([Buffer.from("creator"), current.verifier.toBuffer(), name], current.program)[0];
  return new TransactionInstruction({ programId: current.program, keys: [
    { pubkey: beneficiary, isSigner: true, isWritable: true },
    { pubkey: creatorProof(handle, beneficiary, current.program, current.verifier), isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: current.verifier, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data: Buffer.concat([Buffer.from([3, name.length]), name, Buffer.from(nonce)]) });
}

export function attachCreatorProofVideoInstruction(handle: string, beneficiary: PublicKey, videoId: string, config?: EscrowConfig): TransactionInstruction {
  const current = settings(config);
  if (!VIDEO_ID.test(videoId)) throw new Error("A canonical TikTok video ID of 1–20 digits is required.");
  return new TransactionInstruction({ programId: current.program, keys: [
    { pubkey: beneficiary, isSigner: true, isWritable: false },
    { pubkey: creatorProof(handle, beneficiary, current.program, current.verifier), isSigner: false, isWritable: true },
  ], data: Buffer.concat([Buffer.from([4, videoId.length]), Buffer.from(videoId)]) });
}

/** Hash the reviewed snapshot, not a later mutable request. Rust compares it at execution. */
export async function creatorProofHash(proof: CreatorProof): Promise<Uint8Array> {
  if (proof.data.length !== CREATOR_PROOF_SIZE) throw new Error("The reviewed proof snapshot is invalid.");
  return new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(proof.data).buffer));
}

export function approveCreatorProofInstruction(handle: string, beneficiary: PublicKey, expectedHash: Uint8Array, config?: EscrowConfig): TransactionInstruction {
  const current = settings(config);
  if (expectedHash.length !== 32 || !expectedHash.some((byte) => byte !== 0)) throw new Error("The SHA256 hash of the reviewed proof snapshot is required.");
  const name = Buffer.from(normalizeCreatorHandle(handle));
  const vault = PublicKey.findProgramAddressSync([Buffer.from("creator"), current.verifier.toBuffer(), name], current.program)[0];
  return new TransactionInstruction({ programId: current.program, keys: [
    { pubkey: current.verifier, isSigner: true, isWritable: false },
    { pubkey: creatorProof(handle, beneficiary, current.program, current.verifier), isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: beneficiary, isSigner: false, isWritable: true },
  ], data: Buffer.concat([Buffer.from([5]), Buffer.from(expectedHash)]) });
}

export function cancelCreatorProofInstruction(handle: string, beneficiary: PublicKey, config?: EscrowConfig): TransactionInstruction {
  const current = settings(config);
  return new TransactionInstruction({ programId: current.program, keys: [
    { pubkey: beneficiary, isSigner: true, isWritable: true },
    { pubkey: creatorProof(handle, beneficiary, current.program, current.verifier), isSigner: false, isWritable: true },
  ], data: Buffer.from([6]) });
}

export function decodeCreatorProof(info: AccountInfo<Buffer> | null, address: PublicKey, config?: EscrowConfig): CreatorProof | null {
  let current: EscrowConfig;
  try { current = settings(config); } catch { return null; }
  if (!info || info.executable || !info.owner.equals(current.program) || info.data.length !== CREATOR_PROOF_SIZE) return null;
  const data = info.data;
  if (!data.subarray(0, 8).equals(MAGIC)) return null;
  const length = data[9];
  if (!length || length > 24 || data.subarray(10 + length, 34).some((byte) => byte !== 0)) return null;
  const bytes = data.subarray(10, 10 + length);
  const handle = bytes.toString("ascii");
  try { if (normalizeCreatorHandle(handle) !== handle || !Buffer.from(handle).equals(bytes)) return null; } catch { return null; }
  const verifier = new PublicKey(data.subarray(34, 66));
  const beneficiary = new PublicKey(data.subarray(66, 98));
  if (!verifier.equals(current.verifier)) return null;
  try { validBeneficiary(beneficiary, verifier); } catch { return null; }
  const [canonical, bump] = PublicKey.findProgramAddressSync([SEED, verifier.toBuffer(), bytes, beneficiary.toBuffer()], current.program);
  if (!address.equals(canonical) || bump !== data[8]) return null;
  const nonce = Uint8Array.from(data.subarray(98, 114));
  try { validNonce(nonce); } catch { return null; }
  const createdAt = data.readBigInt64LE(114);
  if (createdAt < 0n || createdAt > I64_MAX - CREATOR_PROOF_LIFETIME_SECONDS) return null;
  const videoLength = data[122];
  if (videoLength > 20 || data.subarray(123 + videoLength, 143).some((byte) => byte !== 0)) return null;
  const videoBytes = data.subarray(123, 123 + videoLength);
  const videoId = videoLength ? videoBytes.toString("ascii") : null;
  if (videoId && (!VIDEO_ID.test(videoId) || !Buffer.from(videoId).equals(videoBytes))) return null;
  const expiresAt = createdAt + CREATOR_PROOF_LIFETIME_SECONDS;
  return Object.freeze({ account: address.toBase58(), handle, verifier, beneficiary, nonce, createdAt, expiresAt, videoId, expired: expiresAt <= BigInt(Math.floor(Date.now() / 1000)), data: Uint8Array.from(data) });
}

export async function readCreatorProof(connection: Pick<Connection, "getAccountInfo">, handle: string, beneficiary: PublicKey, config?: EscrowConfig): Promise<CreatorProof | null> {
  const current = settings(config);
  const address = creatorProof(handle, beneficiary, current.program, current.verifier);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return null;
  // A third party may transfer SOL to the PDA before the creator requests it.
  // Native initialization can safely allocate this exact empty system account.
  if (info.owner.equals(SystemProgram.programId) && !info.executable && info.data.length === 0) return null;
  const proof = decodeCreatorProof(info, address, current);
  if (!proof) throw new Error("The creator proof account could not be validated.");
  return proof;
}

export async function listCreatorProofs(connection: Pick<Connection, "getProgramAccounts">, config?: EscrowConfig): Promise<CreatorProof[]> {
  const current = settings(config);
  const accounts = await connection.getProgramAccounts(current.program, { commitment: "confirmed", filters: [
    { dataSize: CREATOR_PROOF_SIZE },
    { memcmp: { offset: 0, bytes: bs58.encode(MAGIC) } },
    { memcmp: { offset: 34, bytes: current.verifier.toBase58() } },
  ] });
  return accounts.map(({ pubkey, account }) => {
    const proof = decodeCreatorProof(account, pubkey, current);
    if (!proof) throw new Error("A listed creator proof account could not be validated.");
    return proof;
  }).sort((a, b) => a.createdAt === b.createdAt ? a.account.localeCompare(b.account) : a.createdAt > b.createdAt ? -1 : 1);
}
