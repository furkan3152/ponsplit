import { getAddress, type Address } from "viem";
import deployment from "../deployment.json";

function address(value: string | undefined): Address | undefined {
  try {
    return value ? getAddress(value) : undefined;
  } catch {
    return undefined;
  }
}

// Environment variables win; otherwise the addresses the deploy workflow committed to src/deployment.json.
// NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them.
export const CHAIN_NAME = process.env.NEXT_PUBLIC_CHAIN || deployment.chain;
// Committed addresses only count for the network they were deployed to, so a mainnet build can
// never pick up testnet contracts.
const committed = deployment.chain === CHAIN_NAME ? deployment : { launchpad: "", feeVault: "" };
export const LAUNCHPAD_ADDRESS = address(process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS || committed.launchpad);
export const FEE_VAULT_ADDRESS = address(process.env.NEXT_PUBLIC_FEE_VAULT_ADDRESS || committed.feeVault);
export const isConfigured = Boolean(LAUNCHPAD_ADDRESS && FEE_VAULT_ADDRESS);

export const MAX_RECIPIENTS = 10;
export const BPS = 10_000;
export const FAUCET_URL = "https://faucet.testnet.chain.robinhood.com";
