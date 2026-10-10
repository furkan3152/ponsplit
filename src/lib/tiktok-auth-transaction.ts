import "server-only";
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { ESCROW_PROGRAM_ID, VERIFIER } from "./tiktok-config";
import { bindCreatorInstruction, creatorVault, decodeCreatorVault, initCreatorVaultInstruction } from "./solana/tiktok-escrow";
import { serverConnection } from "./solana/server";
import { configuredProgramStatus } from "./admin-setup";
import { getAttestationConfig, tiktokIdentityHash, TikTokAuthError, validateAttestedTransaction, type TikTokSession } from "./tiktok-auth";

export function tikTokVerificationConfigured(): boolean {
  return Boolean(ESCROW_PROGRAM_ID && VERIFIER && !ESCROW_PROGRAM_ID.equals(PublicKey.default) && !VERIFIER.equals(PublicKey.default) && PublicKey.isOnCurve(VERIFIER.toBytes()) && getAttestationConfig());
}

export async function buildAttestedCreatorBind(session: TikTokSession, wallet: PublicKey, walletProof: { message: string; signature: string }) {
  const attestation = getAttestationConfig();
  if (!tikTokVerificationConfigured() || !attestation || !ESCROW_PROGRAM_ID || !VERIFIER) {
    throw new TikTokAuthError("verification_unavailable", "Creator verification is not configured. Please try again after setup.", 503);
  }
  if (wallet.equals(VERIFIER)) throw new TikTokAuthError("invalid_wallet", "The verification authority cannot be used as a creator wallet.");
  const connection = serverConnection();
  const vault = creatorVault(session.handle);
  const [programStatus, info] = await Promise.all([
    configuredProgramStatus(ESCROW_PROGRAM_ID).catch(() => { throw new TikTokAuthError("program_unavailable", "The reviewed creator vault program could not be confirmed on Solana mainnet.", 503); }),
    connection.getAccountInfo(vault, "confirmed"),
  ]);
  if (!programStatus.deployed || !programStatus.artifactMatches) throw new TikTokAuthError("unsafe_program", "The creator vault code or upgrade authority does not match the reviewed deployment.", 503);
  const decoded = decodeCreatorVault(info, vault);
  const prefunded = info?.owner.equals(SystemProgram.programId) && !info.executable && info.data.length === 0;
  if (info && !decoded && !prefunded) throw new TikTokAuthError("invalid_vault", "The creator vault could not be validated.", 409);
  if (decoded?.beneficiary) {
    const sameWallet = decoded.beneficiary.equals(wallet);
    throw new TikTokAuthError(sameWallet ? "already_verified" : "wallet_already_bound", sameWallet ? "This wallet is already verified. You can claim its creator fees." : "This TikTok account is already bound to another wallet.", 409);
  }
  const instructions = [
    ...(!decoded ? [initCreatorVaultInstruction(wallet, session.handle)] : []),
    bindCreatorInstruction(session.handle, wallet, tiktokIdentityHash(session.openId)),
  ];
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: blockhash, instructions }).compileToV0Message());
  const response = await fetch(attestation.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${attestation.token}` },
    body: JSON.stringify({
      transaction: Buffer.from(transaction.serialize()).toString("base64"),
      evidence: { handle: session.handle, openId: session.openId, wallet: wallet.toBase58(), verifiedAt: new Date().toISOString(), expiresAt: new Date(session.expiresAt).toISOString() },
      walletProof,
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new TikTokAuthError("attestation_unavailable", "The verification signer is unavailable. Please try again.", 502);
  const reader = response.body?.getReader();
  if (!reader) throw new TikTokAuthError("invalid_attestation", "The verification signer returned an invalid response.", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8 * 1024) {
      await reader.cancel();
      throw new TikTokAuthError("invalid_attestation", "The verification signer returned an invalid response.", 502);
    }
    chunks.push(value);
  }
  let bytes: Uint8Array;
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { transaction?: unknown };
    if (typeof payload.transaction !== "string" || payload.transaction.length > 1700 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.transaction)) throw new Error("Invalid transaction");
    bytes = Buffer.from(payload.transaction, "base64");
  } catch {
    throw new TikTokAuthError("invalid_attestation", "The verification signer returned an invalid response.", 502);
  }
  const signed = validateAttestedTransaction(transaction, bytes, VERIFIER);
  // A slow signing service must not turn an expired OAuth proof into a usable result.
  if (session.expiresAt <= Date.now()) throw new TikTokAuthError("session_expired", "Your TikTok session expired. Please reconnect.", 401);
  return { transaction: Buffer.from(signed.serialize()).toString("base64"), blockhash, lastValidBlockHeight, vault: vault.toBase58() };
}
