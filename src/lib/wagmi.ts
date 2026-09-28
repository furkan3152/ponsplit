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

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
// On phones RainbowKit's MetaMask option opens the app through the MetaMask SDK, which needs no
// WalletConnect id; on desktop without the extension it would show a WalletConnect QR instead.
const mobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export const wagmiConfig = getDefaultConfig({
  appName: "PonSplit",
  // A placeholder id still lets browser wallets connect; WalletConnect needs a real one.
  projectId: projectId || "00000000000000000000000000000000",
  chains: [activeChain],
  // Batch concurrent reads into one JSON-RPC request (covers chains without Multicall3, e.g. local).
  transports: { [activeChain.id]: http(rpcUrl, { batch: { batchSize: 50 } }) },
  // Wallets that can add a custom EVM chain such as Robinhood Chain. Without a WalletConnect
  // project id, options that would open a broken QR code or deep link are left out: what remains
  // is in-browser wallets (an extension, or a wallet app's own browser) and MetaMask on phones.
  wallets: projectId
    ? [
        { groupName: "Popular", wallets: [metaMaskWallet, rabbyWallet, rainbowWallet, walletConnectWallet] },
        { groupName: "Other", wallets: [injectedWallet] },
      ]
    : [{ groupName: "Wallets", wallets: mobile ? [metaMaskWallet, injectedWallet, rabbyWallet] : [injectedWallet, rabbyWallet] }],
  ssr: true,
});
