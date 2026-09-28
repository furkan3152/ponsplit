import { getAddress, type Address } from "viem";
import deployment from "../deployment.json";

function address(value: string | undefined): Address | undefined {
  try {
    return value ? getAddress(value) : undefined;
  } catch {
    return undefined;
  }
}

export const CHAIN_NAME = process.env.NEXT_PUBLIC_CHAIN || "testnet";

// Environment variables win; otherwise the addresses committed to src/deployment.json for this
// network (never another network's). When neither exists, next.config.mjs predicts them from the
// admin key and sets NEXT_PUBLIC_ADDRESSES_PREDICTED.
// NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them.
const committed: { launchpad?: string; feeVault?: string; hidden?: string[] } =
  (deployment as Record<string, { launchpad?: string; feeVault?: string; hidden?: string[] }>)[CHAIN_NAME] ?? {};
export const LAUNCHPAD_ADDRESS = address(process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS || committed.launchpad);
export const FEE_VAULT_ADDRESS = address(process.env.NEXT_PUBLIC_FEE_VAULT_ADDRESS || committed.feeVault);
export const isConfigured = Boolean(LAUNCHPAD_ADDRESS && FEE_VAULT_ADDRESS);

/**
 * Coins the site doesn't list: src/deployment.json's "hidden" for this network (e.g. the owner's
 * test coins) plus NEXT_PUBLIC_HIDDEN_COINS (comma-separated, so a spam coin can be hidden from the
 * host's settings with a redeploy). They stay on-chain; the site leaves them out of every list,
 * search, stat and the ticker, and their page says they aren't listed.
 */
export const HIDDEN_COINS: readonly Address[] = [
  ...(committed.hidden ?? []),
  ...(process.env.NEXT_PUBLIC_HIDDEN_COINS || "").split(",").map((a) => a.trim()).filter(Boolean),
].map((a) => getAddress(a));
const hiddenSet = new Set(HIDDEN_COINS.map((a) => a.toLowerCase()));
export const isHiddenCoin = (token: string) => hiddenSet.has(token.toLowerCase());
/**
 * True when the addresses were set explicitly (env or committed file) instead of being derived
 * from the admin key. Pinned addresses keep working after the signing key is rotated.
 */
export const ADDRESSES_PINNED = isConfigured && process.env.NEXT_PUBLIC_ADDRESSES_PREDICTED !== "1";

/**
 * How /setup deploys the contracts:
 * - "wallet": from the owner's own wallet, in the browser. The owner holds the contracts from the
 *   start and the server key only signs (it never holds funds). Default on mainnet.
 * - "server": from the server's admin key, which then hands ownership to OWNER_ADDRESS. Default on
 *   testnet and locally (a faucet-funded key makes setup one tap).
 * The contract addresses of a wallet deployment can't be derived from the server key, so they
 * must be pinned (NEXT_PUBLIC_*_ADDRESS or src/deployment.json) before the site can use them.
 */
export const SETUP_MODE: "wallet" | "server" =
  process.env.NEXT_PUBLIC_SETUP_MODE === "wallet" || process.env.NEXT_PUBLIC_SETUP_MODE === "server"
    ? process.env.NEXT_PUBLIC_SETUP_MODE
    : CHAIN_NAME === "mainnet"
      ? "wallet"
      : "server";

export const MAX_RECIPIENTS = 10;
export const BPS = 10_000;
export const FAUCET_URL = "https://faucet.testnet.chain.robinhood.com";
