import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { http } from "wagmi";
import { activeChain, rpcUrl } from "./chains";

export const wagmiConfig = getDefaultConfig({
  appName: "PonSplit",
  // A placeholder id still lets browser wallets (MetaMask, Rabby…) connect; WalletConnect needs a real one.
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "00000000000000000000000000000000",
  chains: [activeChain],
  transports: { [activeChain.id]: http(rpcUrl) },
  // Wallets that can add a custom EVM chain such as Robinhood Chain.
  wallets: [
    { groupName: "Popular", wallets: [metaMaskWallet, rabbyWallet, rainbowWallet, walletConnectWallet] },
    { groupName: "Other", wallets: [injectedWallet] },
  ],
  ssr: true,
});
