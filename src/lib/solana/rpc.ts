/** No API key or paid provider: shared mainnet endpoint, also supports WebSocket subscriptions. */
export const PUBLIC_INDEX_RPC = "https://api.mainnet-beta.solana.com";
export const PUBLIC_MAINNET_RPC = "https://solana-rpc.publicnode.com";

/** Local validator tests opt in separately; legacy hosted RPC variables are intentionally unused. */
export function publicRpcEndpoint(localOverride?: string): string {
  if (!localOverride?.trim()) return PUBLIC_MAINNET_RPC;
  const url = new URL(localOverride.trim());
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("NEXT_PUBLIC_SOLANA_LOCAL_RPC_URL must be a loopback validator URL.");
  }
  return url.toString();
}
