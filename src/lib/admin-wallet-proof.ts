import { PublicKey } from "@solana/web3.js";
import { ADMIN_WALLET } from "./admin-config";

export const ADMIN_WALLET_PROOF_MILLISECONDS = 15 * 60_000;
export type AdminWalletChallenge = Readonly<{ message: string; nonce: string; origin: string; wallet: string; issuedAt: number; expiresAt: number }>;
export type AdminWalletProof = Readonly<{ nonce: string; origin: string; wallet: string; issuedAt: number; expiresAt: number }>;
const challenges = new WeakMap<AdminWalletChallenge, { consumed: boolean }>();
const verifiedProofs = new WeakSet<AdminWalletProof>();

function browserOrigin(): string {
  if (typeof window === "undefined") throw new Error("A browser origin is required for local admin controls.");
  return window.location.origin;
}

function trustedOrigin(input: string): string {
  const url = new URL(input);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local && url.protocol === "http:"))) {
    throw new Error("Local admin controls require HTTPS or a development localhost origin.");
  }
  return url.origin;
}

function exactAdmin(wallet: PublicKey | string | null | undefined): boolean {
  try { return !!wallet && new PublicKey(wallet).equals(ADMIN_WALLET); } catch { return false; }
}

/** Local UI unlock only. Native transactions and optional server sessions enforce their own auth. */
export function createAdminWalletChallenge(origin = browserOrigin()): AdminWalletChallenge {
  const domain = trustedOrigin(origin);
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ADMIN_WALLET_PROOF_MILLISECONDS;
  const wallet = ADMIN_WALLET.toBase58();
  const message = [
    "TikSplit local admin controls v1",
    `Site: ${domain}`,
    `Admin wallet: ${wallet}`,
    `Local challenge: ${nonce}`,
    `Issued at: ${new Date(issuedAt).toISOString()}`,
    `Expires at: ${new Date(expiresAt).toISOString()}`,
    "I unlock admin controls in this browser for 15 minutes.",
    "This proof grants no server session and does not transfer funds. Every on-chain action requires a separate wallet transaction signature.",
  ].join("\n");
  const challenge = Object.freeze({ message, nonce, origin: domain, wallet, issuedAt, expiresAt });
  challenges.set(challenge, { consumed: false });
  return challenge;
}

export async function verifyAdminWalletProof(challenge: AdminWalletChallenge, wallet: PublicKey | string, signature: Uint8Array, origin = browserOrigin()): Promise<AdminWalletProof> {
  const domain = trustedOrigin(origin);
  if (!exactAdmin(wallet) || challenge.wallet !== ADMIN_WALLET.toBase58()) throw new Error("Connect the exact configured admin wallet.");
  const state = challenges.get(challenge);
  if (!state || state.consumed || challenge.origin !== domain || challenge.expiresAt <= Date.now() || challenge.issuedAt > Date.now() + 30_000) throw new Error("Request a fresh local admin challenge.");
  // Consume before the async verification, so concurrent requests cannot reuse this challenge.
  state.consumed = true;
  if (!(signature instanceof Uint8Array) || signature.length !== 64) throw new Error("The admin wallet signature is invalid.");
  const publicKey = await crypto.subtle.importKey("raw", Uint8Array.from(ADMIN_WALLET.toBytes()).buffer, { name: "Ed25519" }, false, ["verify"]);
  const verified = await crypto.subtle.verify({ name: "Ed25519" }, publicKey, Uint8Array.from(signature).buffer, new TextEncoder().encode(challenge.message));
  if (!verified || challenge.expiresAt <= Date.now()) throw new Error("The admin wallet signature could not be verified. Request a fresh challenge.");
  const proof = Object.freeze({ nonce: challenge.nonce, origin: domain, wallet: challenge.wallet, issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt });
  verifiedProofs.add(proof);
  return proof;
}

export function isAdminWalletProofValid(proof: AdminWalletProof | null | undefined, wallet: PublicKey | string | null | undefined, origin = browserOrigin()): boolean {
  try {
    return !!proof && verifiedProofs.has(proof) && exactAdmin(wallet) && proof.wallet === ADMIN_WALLET.toBase58()
      && proof.origin === trustedOrigin(origin) && proof.expiresAt > Date.now() && proof.issuedAt <= Date.now() + 30_000;
  } catch { return false; }
}
