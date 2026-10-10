import { PUBLIC_MAINNET_RPC } from "./rpc";

/** PublicNode serves wallet traffic; restricted indexed reads use the site's public-RPC route. */
export const browserRpcFetch: typeof fetch = (input, init) => {
  if (typeof window !== "undefined" && String(input) === PUBLIC_MAINNET_RPC && typeof init?.body === "string") {
    try {
      const request = JSON.parse(init.body);
      if (request.method === "getProgramAccounts") return fetch("/api/solana/accounts", { ...init, cache: "no-store" });
    } catch { /* Let the normal transport report malformed requests. */ }
  }
  return fetch(input, init);
};
