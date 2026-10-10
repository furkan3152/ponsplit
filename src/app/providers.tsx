"use client";

import "@solana/wallet-adapter-react-ui/styles.css";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { rpcUrls } from "@/lib/solana/config";
import { browserRpcFetch } from "@/lib/solana/browser-rpc";
const connectionConfig = { commitment: "confirmed" as const, fetch: browserRpcFetch };

/**
 * Solana wallets through the Wallet Standard: Phantom, Solflare, Backpack and the others register
 * themselves, so no wallet list is bundled. The modal is restyled in globals.css.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 4_000 } } }));
  return (
    <ConnectionProvider endpoint={rpcUrls()[0]} config={connectionConfig}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
