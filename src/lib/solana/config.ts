import { PublicKey } from "@solana/web3.js";
import settings from "../../splidev.json";
import { publicRpcEndpoint } from "./rpc";

/**
 * Splitdev's settings (src/splidev.json, overridable with NEXT_PUBLIC_* variables for tests):
 * - treasury: Splitdev's wallet. It is the first shareholder of every Splitdev coin's pump.fun fee
 *   sharing, receives the launch fee, and is how the site finds Splitdev coins on chain.
 * - platformBps: Splitdev's share of a new coin's creator fees (the GitHub accounts share the rest).
 * - launchFeeSol: what a launch pays Splitdev, in SOL.
 */
type Settings = { treasury: string; platformBps: number; pastPlatformBps?: number[]; launchFeeSol: string; hidden: string[]; officialToken: string };
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
/**
 * Splitdev shares a listed coin may carry: today's, plus any earlier value (add the old one to
 * `pastPlatformBps` when changing `platformBps`, or coins launched before the change drop off the site).
 */
export const ALLOWED_PLATFORM_BPS = new Set([PLATFORM_BPS, ...(s.pastPlatformBps ?? [])]);
/** Launch fee in lamports. */
export const LAUNCH_FEE_LAMPORTS = BigInt(Math.round(Number(process.env.NEXT_PUBLIC_SPLIDEV_LAUNCH_FEE_SOL ?? s.launchFeeSol) * 1e9));
export const HIDDEN = new Set(s.hidden.map((m) => m.trim()).filter(Boolean));
export const OFFICIAL_TOKEN = key(s.officialToken);

/** Whether launches can happen: Splitdev's treasury is set. */
export const isLive = () => Boolean(TREASURY);

/** Public mainnet RPC; only the explicit local-validator override is configurable. */
export function rpcUrls(): string[] {
  return [publicRpcEndpoint(process.env.NEXT_PUBLIC_SOLANA_LOCAL_RPC_URL)];
}

/** Each GitHub account can hold at most this many shares: pump.fun allows 10 shareholders and Splitdev is one. */
export const MAX_RECIPIENTS = 9;
export const SHARES_TOTAL = 10_000;
