import { getAddress, type Address } from "viem";

function addressFromEnv(value: string | undefined): Address | undefined {
  try {
    return value ? getAddress(value) : undefined;
  } catch {
    return undefined;
  }
}

// NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them.
export const LAUNCHPAD_ADDRESS = addressFromEnv(process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS);
export const FEE_VAULT_ADDRESS = addressFromEnv(process.env.NEXT_PUBLIC_FEE_VAULT_ADDRESS);
export const isConfigured = Boolean(LAUNCHPAD_ADDRESS && FEE_VAULT_ADDRESS);

export const MAX_RECIPIENTS = 10;
export const BPS = 10_000;
export const FAUCET_URL = "https://faucet.testnet.chain.robinhood.com";
