import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { robinhood, robinhoodTestnet } from "./chains";
import { NETWORKS } from "./networks";
import { rpcTransport } from "./rpc";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
// On phones RainbowKit's MetaMask option opens the app through the MetaMask SDK, which needs no
// WalletConnect id; on desktop without the extension it would show a WalletConnect QR instead.
// iPadOS reports a desktop Mac user agent, so it is recognised by touch, as RainbowKit does.
const mobile =
  typeof navigator !== "undefined" &&
  (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/**
 * Both networks are configured at once; the one the visitor picked (NetworkProvider) decides which
 * chain every read and transaction goes to, and the wallet is asked to switch before sending.
 */
export const wagmiConfig = getDefaultConfig({
  appName: "SplitEarn",
  // A placeholder id still lets browser wallets connect; WalletConnect needs a real one.
  projectId: projectId || "00000000000000000000000000000000",
  chains: [robinhood, robinhoodTestnet],
  // Batch concurrent reads into one JSON-RPC request; fall back to the next RPC if one fails.
  transports: {
    [robinhood.id]: rpcTransport(NETWORKS.mainnet.rpcUrls, { batch: { batchSize: 50 } }),
    [robinhoodTestnet.id]: rpcTransport(NETWORKS.testnet.rpcUrls, { batch: { batchSize: 50 } }),
  },
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
