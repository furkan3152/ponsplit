import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";
import { ESCROW_PROGRAM_ID, VERIFIER, isValidTikTokHandle, normalizeTikTokHandle } from "../tiktok-config";

export const CREATOR_VAULT_SIZE = 138;
const MAGIC = Buffer.from("TIKVAULT");
const APPROVED_MAGIC = Buffer.from("TIKAPPRV");
const SEED = Buffer.from("creator");
const ZERO = new PublicKey(new Uint8Array(32));

export type EscrowConfig = { program: PublicKey; verifier: PublicKey };
export type CreatorVault = {
  handle: string;
  verifier: PublicKey;
  beneficiary: PublicKey | null;
  identityHash: Uint8Array;
  totalClaimed: bigint;
  approved: boolean;
  verified: boolean;
};
export type CreatorVaultBalance = {
  account: string;
  claimable: bigint;
  exists: boolean;
  beneficiary: string | null;
  totalClaimed: bigint;
  identityHash: Uint8Array;
  approved: boolean;
  verified: boolean;
};

/** TikTok handles are case insensitive, ASCII and at most 24 bytes. */
export function normalizeCreatorHandle(value: string): string {
  const handle = normalizeTikTokHandle(value);
  if (!isValidTikTokHandle(handle)) {
    throw new Error("A valid TikTok username is required (1–24 characters).");
  }
  return handle;
}

function requireConfig(config?: EscrowConfig): EscrowConfig {
  const program = config?.program ?? ESCROW_PROGRAM_ID;
  const verifier = config?.verifier ?? VERIFIER;
  if (!program || !verifier || program.equals(ZERO) || verifier.equals(ZERO)) {
    throw new Error("TikTok escrow program and verification authority are not configured.");
  }
  return { program, verifier };
}

/** Immutable verifier in the seeds prevents another initializer choosing an authority. */
export function creatorVault(
  handle: string,
  program: PublicKey | null = ESCROW_PROGRAM_ID,
  verifier: PublicKey | null = VERIFIER,
): PublicKey {
  if (!program || !verifier) throw new Error("TikTok escrow program and verification authority are not configured.");
  const config = requireConfig({ program, verifier });
  return PublicKey.findProgramAddressSync(
    [SEED, config.verifier.toBuffer(), Buffer.from(normalizeCreatorHandle(handle))],
    config.program,
  )[0];
}

export function initCreatorVaultInstruction(
  payer: PublicKey,
  handle: string,
  config?: EscrowConfig,
): TransactionInstruction {
  const { program, verifier } = requireConfig(config);
  const name = Buffer.from(normalizeCreatorHandle(handle));
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: creatorVault(handle, program, verifier), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([0, name.length]), name, verifier.toBuffer()]),
  });
}

export function bindCreatorInstruction(
  handle: string,
  beneficiary: PublicKey,
  identityHash: Uint8Array,
  config?: EscrowConfig,
): TransactionInstruction {
  const { program, verifier } = requireConfig(config);
  if (identityHash.length !== 32 || !identityHash.some((byte) => byte !== 0) || beneficiary.equals(ZERO) || beneficiary.equals(verifier)) {
    throw new Error("An independent beneficiary and nonzero 32-byte TikTok identity hash are required.");
  }
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: verifier, isSigner: true, isWritable: false },
      { pubkey: beneficiary, isSigner: true, isWritable: false },
      { pubkey: creatorVault(handle, program, verifier), isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([Buffer.from([1]), Buffer.from(identityHash)]),
  });
}

export function claimCreatorInstruction(
  handle: string,
  beneficiary: PublicKey,
  config?: EscrowConfig,
): TransactionInstruction {
  const { program, verifier } = requireConfig(config);
  if (beneficiary.equals(ZERO) || beneficiary.equals(verifier)) throw new Error("An independent beneficiary wallet is required.");
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: beneficiary, isSigner: true, isWritable: true },
      { pubkey: creatorVault(handle, program, verifier), isSigner: false, isWritable: true },
    ],
    data: Buffer.from([2]),
  });
}

/** Activates an admin-approved manual proof; only the creator signs. */
export function activateCreatorInstruction(
  handle: string,
  beneficiary: PublicKey,
  identityHash: Uint8Array,
  config?: EscrowConfig,
): TransactionInstruction {
  const instruction = bindCreatorInstruction(handle, beneficiary, identityHash, config);
  instruction.keys[0].isSigner = false;
  return instruction;
}

/** Decode only canonical, program-owned accounts belonging to this site's verifier. */
export function decodeCreatorVault(
  info: AccountInfo<Buffer> | null,
  address: PublicKey,
  config?: EscrowConfig,
): CreatorVault | null {
  let settings: EscrowConfig;
  try { settings = requireConfig(config); } catch { return null; }
  if (!info || info.executable || !info.owner.equals(settings.program)) return null;
  const data = info.data;
  if (data.length !== CREATOR_VAULT_SIZE) return null;
  const approved = data.subarray(0, 8).equals(APPROVED_MAGIC);
  if (!approved && !data.subarray(0, 8).equals(MAGIC)) return null;
  const handleLength = data[9];
  if (!handleLength || handleLength > 24 || data.subarray(10 + handleLength, 34).some((byte) => byte !== 0)) return null;
  const handleBytes = data.subarray(10, 10 + handleLength);
  const handle = handleBytes.toString("ascii");
  try {
    if (normalizeCreatorHandle(handle) !== handle || !Buffer.from(handle).equals(handleBytes)) return null;
  } catch { return null; }
  const verifier = new PublicKey(data.subarray(34, 66));
  if (!verifier.equals(settings.verifier)) return null;
  const [canonical, bump] = PublicKey.findProgramAddressSync([SEED, verifier.toBuffer(), handleBytes], settings.program);
  if (!address.equals(canonical) || bump !== data[8]) return null;
  const beneficiary = new PublicKey(data.subarray(66, 98));
  if (beneficiary.equals(verifier)) return null;
  const identityHash = Uint8Array.from(data.subarray(98, 130));
  const bound = !beneficiary.equals(ZERO);
  if (bound !== identityHash.some((byte) => byte !== 0)) return null;
  const totalClaimed = data.readBigUInt64LE(130);
  if ((!bound || approved) && totalClaimed !== BigInt(0)) return null;
  if (approved && !bound) return null;
  return { handle, verifier, beneficiary: bound ? beneficiary : null, identityHash, totalClaimed, approved, verified: bound && !approved };
}

function exactLamports(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("RPC returned an unsafe lamport balance.");
  return BigInt(value);
}

export async function creatorVaultClaimable(
  connection: Pick<Connection, "getAccountInfo" | "getMinimumBalanceForRentExemption">,
  handle: string,
  config?: EscrowConfig,
): Promise<CreatorVaultBalance> {
  const settings = requireConfig(config);
  const address = creatorVault(handle, settings.program, settings.verifier);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return { account: address.toBase58(), claimable: BigInt(0), exists: false, beneficiary: null, totalClaimed: BigInt(0), identityHash: new Uint8Array(32), approved: false, verified: false };
  const state = decodeCreatorVault(info, address, settings);
  // A system-owned empty PDA may be prefunded before its initialization. Report
  // its balance, but keep exists=false until its program state is established.
  const prefunded = info.owner.equals(SystemProgram.programId) && !info.executable && info.data.length === 0;
  if (!state && !prefunded) throw new Error("The TikTok creator vault account is invalid.");
  const rent = exactLamports(await connection.getMinimumBalanceForRentExemption(CREATOR_VAULT_SIZE, "confirmed"));
  const lamports = exactLamports(info.lamports);
  return {
    account: address.toBase58(),
    claimable: lamports > rent ? lamports - rent : BigInt(0),
    exists: Boolean(state),
    beneficiary: state?.beneficiary?.toBase58() ?? null,
    totalClaimed: state?.totalClaimed ?? BigInt(0),
    identityHash: state?.identityHash ?? new Uint8Array(32),
    approved: state?.approved ?? false,
    verified: state?.verified ?? false,
  };
}
