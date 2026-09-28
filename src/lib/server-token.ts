import "server-only";
import { createPublicClient, getAddress, http, isAddress, zeroAddress } from "viem";
import { launchpadAbi } from "./abi";
import { activeChain, rpcUrl } from "./chains";
import { LAUNCHPAD_ADDRESS } from "./config";
import type { TokenView } from "./types";

/**
 * Server-side token read for metadata and share images. Returns null on any failure.
 * `no-store` keeps these RPC calls out of Next's fetch cache (each has a unique JSON-RPC id, so
 * caching them only fills the disk and could serve stale chain data after a restart).
 */
export async function fetchToken(address: string): Promise<TokenView | null> {
  if (!LAUNCHPAD_ADDRESS || !isAddress(address)) return null;
  try {
    const client = createPublicClient({ chain: activeChain, transport: http(rpcUrl, { timeout: 5_000, fetchOptions: { cache: "no-store" } }) });
    const t = await client.readContract({ address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "getToken", args: [getAddress(address)] });
    return t.token === zeroAddress ? null : t;
  } catch {
    return null;
  }
}
