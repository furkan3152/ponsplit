"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { NetworkProvider } from "@/lib/network-context";
import { NETWORKS, type NetworkId } from "@/lib/networks";
import { useTheme } from "@/lib/theme";
import { wagmiConfig } from "@/lib/wagmi";

// The wallet modal follows the site's theme (not the OS) and uses the house neon.
const walletThemes = {
  dark: darkTheme({ accentColor: "#ccff00", accentColorForeground: "#0b0b0d", borderRadius: "large", fontStack: "system", overlayBlur: "small" }),
  light: lightTheme({ accentColor: "#0b0b0d", accentColorForeground: "#ccff00", borderRadius: "large", fontStack: "system", overlayBlur: "small" }),
};

export function Providers({ network, children }: { network: NetworkId; children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 4_000 } } }));
  const [theme] = useTheme();
  return (
    <NetworkProvider network={network}>
      <SessionProvider>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            {/* Connecting asks the wallet for the network the visitor picked. */}
            <RainbowKitProvider theme={walletThemes[theme]} modalSize="compact" initialChain={NETWORKS[network].chain}>
              {children}
            </RainbowKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </SessionProvider>
    </NetworkProvider>
  );
}
