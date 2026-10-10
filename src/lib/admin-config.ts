import { PublicKey } from "@solana/web3.js";
import settings from "../splidev.json";

/** Public, exact wallet identity. A client-provided address never grants admin privileges. */
export const ADMIN_WALLET = new PublicKey(process.env.NEXT_PUBLIC_TIKSPLIT_ADMIN_WALLET || settings.treasury);
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const isAdminWallet = (wallet: PublicKey | string | null | undefined) => {
  try { return Boolean(wallet && new PublicKey(wallet).equals(ADMIN_WALLET)); } catch { return false; }
};
