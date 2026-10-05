import { PublicKey } from "@solana/web3.js";
import settings from "../../splidev.json";

/**
 * Splidev's settings (src/splidev.json, overridable with NEXT_PUBLIC_* variables for tests):
 * - treasury: Splidev's wallet. It is the first shareholder of every Splidev coin's pump.fun fee
 *   sharing, receives the launch fee, and is how the site finds Splidev coins on chain.
 * - platformBps: Splidev's share of a new coin's creator fees (the GitHub accounts share the rest).
 * - launchFeeSol: what a launch pays Splidev, in SOL.
 */
type Settings = { treasury: string; platformBps: number; launchFeeSol: string; hidden: string[]; officialToken: string };
const s = settings as Settings;

function key(value: string | undefined): PublicKey | null {
  try {
    return value?.trim() ? new PublicKey(value.trim()) : null;
  } catch {
    return null;
  }
}

export const TREASURY = key(process.env.NEXT_PUBLIC_SPLIDEV_TREASURY || s.treasury);
export const PLATFORM_BPS = Number(process.env.NEXT_PUBLIC_SPLIDEV_PLATFORM_BPS || s.platformBps);
/** Launch fee in lamports. */
export const LAUNCH_FEE_LAMPORTS = BigInt(Math.round(Number(process.env.NEXT_PUBLIC_SPLIDEV_LAUNCH_FEE_SOL ?? s.launchFeeSol) * 1e9));
export const HIDDEN = new Set(s.hidden.map((m) => m.trim()).filter(Boolean));
export const OFFICIAL_TOKEN = key(s.officialToken);

/** Whether launches can happen: Splidev's treasury is set. */
export const isLive = () => Boolean(TREASURY);

/** RPC endpoints, tried in order: NEXT_PUBLIC_SOLANA_RPC_URL (comma list), then the public one. */
export function rpcUrls(): string[] {
  const own = (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (own.some((u) => /^https?:\/\/(127\.0\.0\.1|localhost)/.test(u))) return own;
  return [...own, "https://api.mainnet-beta.solana.com"];
}

/** Each GitHub account can hold at most this many shares: pump.fun allows 10 shareholders and Splidev is one. */
export const MAX_RECIPIENTS = 9;
export const SHARES_TOTAL = 10_000;
