import { defineChain } from "viem";

/** Deployed on both Robinhood networks (checked by the Probe workflow); lets many reads share one call. */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" } },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

/** Local Hardhat node for development (`npx hardhat node` in contracts/). */
export const localDev = defineChain({
  id: 31337,
  name: "Hardhat Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  blockExplorers: { default: { name: "None", url: "http://127.0.0.1:8545" } },
  testnet: true,
});

const CHAINS = { mainnet: robinhood, testnet: robinhoodTestnet, local: localDev } as const;

export const activeChain = CHAINS[(process.env.NEXT_PUBLIC_CHAIN || "testnet") as keyof typeof CHAINS] ?? robinhoodTestnet;
export const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || activeChain.rpcUrls.default.http[0];

export const explorerUrl = (kind: "address" | "tx" | "token", value: string) =>
  `${activeChain.blockExplorers.default.url}/${kind}/${value}`;
