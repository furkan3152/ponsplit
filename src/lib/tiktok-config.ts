import { PublicKey } from "@solana/web3.js";
import { TREASURY } from "./solana/config";
import { ADMIN_WALLET } from "./admin-config";

function publicKey(value: string | undefined): PublicKey | null {
  try { return value?.trim() ? new PublicKey(value.trim()) : null; } catch { return null; }
}

/** Real deployed accounts only. An empty configuration keeps launches disabled. */
export const ESCROW_PROGRAM_ID = publicKey(process.env.NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID);
/** Manual video review uses the admin's native wallet; OAuth can use a separate managed signer later. */
export const VERIFIER = publicKey(process.env.NEXT_PUBLIC_TIKSPLIT_VERIFIER || ADMIN_WALLET.toBase58());
export const usesManualCreatorProof = () => Boolean(VERIFIER?.equals(ADMIN_WALLET));
export const isTikTokLaunchReady = () => Boolean(TREASURY && ESCROW_PROGRAM_ID && VERIFIER && !ESCROW_PROGRAM_ID.equals(PublicKey.default) && !VERIFIER.equals(PublicKey.default) && PublicKey.isOnCurve(VERIFIER.toBytes()));

export function normalizeTikTokHandle(input: string): string {
  const value = input.trim();
  if (/^(?:https?:\/\/)?(?:www\.)?tiktok\.com\//i.test(value)) {
    const path = value.replace(/^(?:https?:\/\/)?(?:www\.)?tiktok\.com\//i, "");
    return (path.split(/[/?#]/)[0] || "").replace(/^@/, "").toLowerCase();
  }
  return value.replace(/^@/, "").toLowerCase();
}

/** TikTok usernames contain letters, numbers, underscores and periods, with no trailing period. */
export const isValidTikTokHandle = (handle: string) => /^[a-z0-9_.]{1,24}$/.test(handle) && !handle.endsWith(".");
export const tikTokProfileUrl = (handle: string) => `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
