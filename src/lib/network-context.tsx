"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { NETWORK_COOKIE, NETWORKS, type Network, type NetworkId } from "./networks";

const NetworkContext = createContext<NetworkId>("mainnet");

/** The network this visitor is on, chosen server-side from their cookie (see middleware.ts). */
export function NetworkProvider({ network, children }: { network: NetworkId; children: ReactNode }) {
  return <NetworkContext.Provider value={network}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): Network {
  return NETWORKS[useContext(NetworkContext)];
}

/**
 * Switches network. The whole app reloads on the new one: every query, cache and wallet check
 * starts clean, so nothing from one network can leak into the other. `path` opens another page.
 */
export function useSwitchNetwork() {
  return useCallback((id: NetworkId, path?: string) => {
    document.cookie = `${NETWORK_COOKIE}=${id}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    const url = new URL(path ?? window.location.href, window.location.href);
    url.searchParams.delete("network");
    window.location.assign(url.toString());
  }, []);
}
