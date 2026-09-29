import "server-only";
import { cookies } from "next/headers";
import { createPublicClient, type PublicClient } from "viem";
import { DEFAULT_NETWORK, NETWORK_COOKIE, NETWORKS, parseNetwork, type Network, type NetworkId } from "./networks";
import { rpcList, rpcTransport } from "./rpc";

/** The network this visitor browses (their cookie, see middleware.ts), for server components. */
export function visitorNetworkId(): NetworkId {
  return parseNetwork(cookies().get(NETWORK_COOKIE)?.value) ?? DEFAULT_NETWORK;
}

/**
 * The network an API request is about. The app names it in every request body; a request that
 * doesn't falls back to the visitor's cookie. Anything else is refused rather than guessed.
 */
export function requestNetwork(named: unknown): Network | undefined {
  if (named === undefined || named === null || named === "") return NETWORKS[visitorNetworkId()];
  const id = parseNetwork(named);
  return id ? NETWORKS[id] : undefined;
}

const clients = new Map<NetworkId, PublicClient>();

/**
 * A server-side client for one network. `no-store` keeps these RPC calls out of Next's fetch cache
 * (each has a unique JSON-RPC id, so caching them only fills the disk and could serve stale chain
 * data after a restart). A server-only MAINNET_RPC_URL / TESTNET_RPC_URL (a paid provider's
 * secret URL, never sent to browsers) goes first, then the endpoints the browsers use.
 */
export function serverClient(n: Network): PublicClient {
  let c = clients.get(n.id);
  if (!c) {
    const secret = n.id === "mainnet" ? process.env.MAINNET_RPC_URL : process.env.TESTNET_RPC_URL;
    const urls = secret ? [...new Set([...rpcList(secret, n.rpcUrls[0]), ...n.rpcUrls])] : n.rpcUrls;
    c = createPublicClient({
      chain: n.chain,
      transport: rpcTransport(urls, { timeout: 8_000, fetchOptions: { cache: "no-store" } }),
    }) as PublicClient;
    clients.set(n.id, c);
  }
  return c;
}
